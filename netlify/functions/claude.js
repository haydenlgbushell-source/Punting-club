// netlify/functions/claude.js — Node.js proxy for Anthropic API
'use strict';

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
]);

const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// 5 MB in base64 ≈ 6.8 MB of chars; add a small buffer
const MAX_IMAGE_B64_CHARS = 7 * 1024 * 1024;
const MAX_IMAGES_PER_REQUEST = 2;

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const err = (msg, status = 400) => ({
  statusCode: status,
  headers: HEADERS,
  body: JSON.stringify({ error: msg }),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return err('Method not allowed', 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err('ANTHROPIC_API_KEY not configured', 500);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err('Invalid JSON');
  }

  // ── Model allowlist ────────────────────────────────────────────────────────
  if (!body.model || !ALLOWED_MODELS.has(body.model)) {
    return err(`Invalid model. Allowed: ${[...ALLOWED_MODELS].join(', ')}`);
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

  try {
    const headers = {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'web-search-2025-03-05',
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return { statusCode: response.status, headers: HEADERS, body: JSON.stringify(data) };
  } catch (e) {
    console.error('Claude proxy error:', e);
    return err(e.message, 500);
  }
};
