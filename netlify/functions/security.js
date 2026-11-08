// netlify/functions/security.js — shared CORS + rate-limiting helpers (CommonJS)
'use strict';

// Origins allowed to call the API from a browser. Same-origin requests (the real
// app) never trigger CORS checks, so tightening this only blocks cross-origin abuse.
// Configure extra origins via ALLOWED_ORIGINS (comma-separated) in the Netlify env.
const allowedOrigins = () => {
  const list = [];
  if (process.env.URL) list.push(process.env.URL);
  if (process.env.DEPLOY_PRIME_URL) list.push(process.env.DEPLOY_PRIME_URL);
  if (process.env.ALLOWED_ORIGINS) {
    for (const o of process.env.ALLOWED_ORIGINS.split(',')) {
      const t = o.trim();
      if (t) list.push(t);
    }
  }
  return list;
};

// Build response headers with a correctly-scoped Access-Control-Allow-Origin.
// Falls back to the site's own URL (or '*' only when no origins are configured,
// preserving current behaviour in unconfigured/preview environments).
const corsHeaders = (event = {}) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = allowedOrigins();
  let allowOrigin;
  if (allowed.length === 0) {
    allowOrigin = '*';
  } else if (origin && allowed.includes(origin)) {
    allowOrigin = origin;
  } else {
    allowOrigin = allowed[0];
  }
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
};

// Best-effort in-memory sliding-window rate limiter. Serverless instances don't
// share memory and reset on cold start, so this throttles bursts on a warm
// instance rather than providing hard global limits — a durable store (Supabase
// table / Upstash) is recommended for production-grade protection.
const buckets = new Map();

const clientIp = (event = {}) => {
  const h = event.headers || {};
  return (
    h['x-nf-client-connection-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
};

// Returns { ok: true } if under the limit, or { ok: false, retryAfter } if over.
const rateLimit = (event, key, { max = 10, windowMs = 60_000 } = {}) => {
  const id = `${key}:${clientIp(event)}`;
  const now = Date.now();
  const hits = (buckets.get(id) || []).filter(ts => now - ts < windowMs);
  if (hits.length >= max) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    return { ok: false, retryAfter };
  }
  hits.push(now);
  buckets.set(id, hits);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.some(ts => now - ts < windowMs)) buckets.delete(k);
    }
  }
  return { ok: true };
};

// Extract a bearer token from the Authorization header, or '' if absent.
const bearerToken = (event = {}) => {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : '';
};

const { createHmac, timingSafeEqual } = require('crypto');

// Constant-time string comparison (avoids leaking how many leading chars match).
const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
};

// Verify a signed admin session token (issued by auth.js admin_login).
// Returns the claims or throws an Error with a .status.
const verifyAdminToken = (token) => {
  const fail = (msg, status = 401) => { const e = new Error(msg); e.status = status; throw e; };
  if (!token) fail('Admin token required');
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) fail('Admin auth not configured', 500);
  const dot = String(token).lastIndexOf('.');
  if (dot < 0) fail('Invalid token format');
  const payloadB64 = String(token).slice(0, dot);
  const sig        = String(token).slice(dot + 1);
  const expected   = createHmac('sha256', secret).update(payloadB64).digest('hex');
  if (!safeEqual(sig, expected)) fail('Invalid admin token');
  let claims;
  try { claims = JSON.parse(Buffer.from(payloadB64, 'base64').toString()); }
  catch (_) { fail('Invalid token payload'); }
  if (!claims.exp || Date.now() > claims.exp) fail('Admin session expired, please log in again');
  return claims;
};

// Server-to-server token used when one function triggers another (scheduled →
// background workers). Derived from ADMIN_JWT_SECRET so no extra env var is
// needed. Background workers reject calls without it, so the public internet
// can't trigger paid AI runs.
const INTERNAL_HEADER = 'x-internal-token';
const internalToken = () => {
  const secret = process.env.ADMIN_JWT_SECRET;
  return secret ? createHmac('sha256', secret).update('internal-trigger-v1').digest('hex') : '';
};
const isInternalCall = (event = {}) => {
  const h = event.headers || {};
  const got = h[INTERNAL_HEADER] || h['X-Internal-Token'] || '';
  const want = internalToken();
  return !!want && safeEqual(got, want);
};

// Fire a background function with the internal token. Background functions
// return 202 immediately, so awaiting only waits for the accept — but the await
// matters: an un-awaited fetch can be dropped when the runtime freezes.
const triggerInternal = async (fnName, body = {}) => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) throw new Error('Cannot determine site URL for background trigger');
  const res = await fetch(`${base}/.netlify/functions/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_HEADER]: internalToken() },
    body: JSON.stringify(body),
  });
  return res.status;
};

module.exports = { corsHeaders, rateLimit, clientIp, bearerToken, safeEqual, verifyAdminToken, internalToken, isInternalCall, triggerInternal, INTERNAL_HEADER };
