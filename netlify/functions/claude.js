// netlify/functions/claude.js — Node.js proxy for Anthropic API
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { corsHeaders, rateLimit, bearerToken } = require('./security');

// This is a constrained proxy, not an open one: only cheap models, capped output,
// no tools, and image (bet-slip) requests require a signed-in user.
// The SERVER picks the model (the client's "model" field is ignored), so it can
// be switched in Netlify env vars without a redeploy of the frontend:
//   SLIP_MODEL  — bet-slip reading (image requests)
//   CHAT_MODEL  — support chat (text-only requests)
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ALLOWED_MODELS = new Set([DEFAULT_MODEL, 'claude-haiku-5-5']);
const pickModel = (envName) => {
  const m = process.env[envName];
  return m && ALLOWED_MODELS.has(m) ? m : DEFAULT_MODEL;
};
// Haiku 4.5 rejects output_config.effort; newer models accept it.
const supportsEffort = (model) => !/claude-haiku-4-5/.test(model);
const MAX_TOKENS_AUTHED = 8192;  // bet-slip analysis scales with leg count
const MAX_TOKENS_ANON   = 600;   // support chat
const MAX_MESSAGES      = 30;
const MAX_TEXT_CHARS    = 20_000;
const MAX_SYSTEM_CHARS  = 8_000;

let supabase = null;
const getAuthUser = async (event) => {
  const token = bearerToken(event);
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  supabase = supabase || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data?.user ? null : data.user;
};

const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// 5 MB in base64 ≈ 6.8 MB of chars; add a small buffer
const MAX_IMAGE_B64_CHARS = 7 * 1024 * 1024;
const MAX_IMAGES_PER_REQUEST = 5;

exports.handler = async (event) => {
  const HEADERS = corsHeaders(event);
  const err = (msg, status = 400) => ({
    statusCode: status,
    headers: HEADERS,
    body: JSON.stringify({ error: msg }),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return err('Method not allowed', 405);

  // Cap calls per client to contain Anthropic cost abuse from the public proxy.
  const rl = rateLimit(event, 'claude', { max: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return { statusCode: 429, headers: { ...HEADERS, 'Retry-After': String(rl.retryAfter) }, body: JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err('ANTHROPIC_API_KEY not configured', 500);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err('Invalid JSON');
  }

  // ── Image validation ───────────────────────────────────────────────────────
  let imageCount = 0;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const msg of messages) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type !== 'image') continue;
      imageCount++;
      if (imageCount > MAX_IMAGES_PER_REQUEST) {
        return err(`Maximum ${MAX_IMAGES_PER_REQUEST} images allowed per request.`);
      }
      const src = block.source;
      if (!src || src.type !== 'base64') {
        return err('Image source must be base64.');
      }
      if (!ALLOWED_IMAGE_MEDIA_TYPES.has(src.media_type)) {
        return err(`Unsupported image type "${src.media_type}". Allowed: jpeg, png, webp, gif.`);
      }
      if (!src.data || typeof src.data !== 'string') {
        return err('Image data is missing.');
      }
      if (src.data.length > MAX_IMAGE_B64_CHARS) {
        return err('Image exceeds maximum allowed size (5 MB).');
      }
      // Basic base64 character check (allow standard + URL-safe + padding)
      if (!/^[A-Za-z0-9+/\-_]+=*$/.test(src.data)) {
        return err('Image data contains invalid characters.');
      }
    }
  }

  if (messages.length === 0 || messages.length > MAX_MESSAGES) return err(`Between 1 and ${MAX_MESSAGES} messages required.`);
  let textChars = 0;
  for (const msg of messages) {
    if (!['user', 'assistant'].includes(msg.role)) return err('Invalid message role.');
    const blocks = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : (Array.isArray(msg.content) ? msg.content : []);
    for (const b of blocks) {
      if (b.type === 'text') textChars += String(b.text || '').length;
      else if (b.type !== 'image') return err(`Content type "${b.type}" is not allowed.`);
    }
  }
  if (textChars > MAX_TEXT_CHARS) return err('Message too long.');
  if (body.system !== undefined && (typeof body.system !== 'string' || body.system.length > MAX_SYSTEM_CHARS)) return err('Invalid system prompt.');

  // Image analysis (bet slips) costs real money — signed-in users only.
  const user = imageCount > 0 || Number(body.max_tokens) > MAX_TOKENS_ANON ? await getAuthUser(event) : null;
  if (imageCount > 0 && !user) return err('Please log in to analyse a bet slip.', 401);
  const cap = user ? MAX_TOKENS_AUTHED : MAX_TOKENS_ANON;
  const maxTokens = Math.max(1, Math.min(parseInt(body.max_tokens, 10) || 512, cap));

  // Forward ONLY the fields we allow — tools, tool_choice, thinking, MCP servers
  // etc. from the client are dropped.
  const model = imageCount > 0 ? pickModel('SLIP_MODEL') : pickModel('CHAT_MODEL');
  const upstream = { model, max_tokens: maxTokens, messages };
  // Newer Haiku thinks by default; keep it light (and cheap) for these tasks.
  if (supportsEffort(model)) upstream.output_config = { effort: process.env.SLIP_EFFORT || 'low' };
  if (body.system) upstream.system = body.system;

  try {
    const headers = {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(upstream),
    });

    const data = await response.json();
    return { statusCode: response.status, headers: HEADERS, body: JSON.stringify(data) };
  } catch (e) {
    console.error('Claude proxy error:', e);
    return err(e.message, 500);
  }
};
