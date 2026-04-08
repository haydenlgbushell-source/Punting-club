// netlify/functions/claude.js — Node.js proxy for Anthropic API
const ALLOWED_ORIGIN = process.env.URL || process.env.ALLOWED_ORIGIN || '*';

// Whitelist of models the frontend is permitted to use
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
]);

// Maximum tokens the frontend may request per call
const MAX_TOKENS_LIMIT = 2048;

exports.handler = async (event) => {
  const HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: HEADERS, body: 'Method not allowed' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };

  try {
    const body = JSON.parse(event.body || '{}');

    // Enforce allowed models to prevent abuse with expensive models
    if (body.model && !ALLOWED_MODELS.has(body.model)) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Model not permitted.' }) };
    }

    // Cap max_tokens to prevent runaway costs
    if (body.max_tokens && body.max_tokens > MAX_TOKENS_LIMIT) {
      body.max_tokens = MAX_TOKENS_LIMIT;
    }

    // Build headers — always include the web-search beta so the web_search tool
    // is available when the frontend requests it (harmless if not used).
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
  } catch (err) {
    console.error('Claude proxy error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'An unexpected error occurred.' }) };
  }
};
