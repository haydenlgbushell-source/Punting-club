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

module.exports = { corsHeaders, rateLimit, clientIp };
