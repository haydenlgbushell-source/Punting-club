// netlify/functions/check-results-background.js
// Background worker (15-min budget; Netlify returns 202 immediately).
// Only accepts internal calls (scheduled trigger / admin trigger) carrying the
// x-internal-token header, so the public can't start paid AI searches.
// All settlement logic lives in ./lib/settle.js.

const { createClient } = require('@supabase/supabase-js');
const { isInternalCall } = require('./security');
const { settleRun } = require('./lib/settle');

exports.handler = async (event) => {
  if (!isInternalCall(event)) {
    console.warn('[check-results-bg] Rejected call without a valid internal token');
    return { statusCode: 401 };
  }

  let bodyStr = event?.body || '';
  if (event?.isBase64Encoded) bodyStr = Buffer.from(bodyStr, 'base64').toString('utf-8');
  let betId = null;
  try { betId = bodyStr ? JSON.parse(bodyStr)?.betId || null : null; } catch (_) {}

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[check-results-bg] Missing Supabase env vars'); return { statusCode: 500 };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[check-results-bg] Missing ANTHROPIC_API_KEY'); return { statusCode: 500 }; }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    await settleRun({ supabase, apiKey, betId, log: (m) => console.log(`[check-results-bg] ${m}`) });
  } catch (err) {
    console.error('[check-results-bg] Unexpected error:', err.stack || err);
  }
  return { statusCode: 200 };
};
