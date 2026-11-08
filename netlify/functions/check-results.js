// netlify/functions/check-results.js
// POST /api/check-results — ADMIN ONLY. Starts a background settlement run
// (optionally for a single bet) and returns immediately. The actual work runs in
// check-results-background (15-min budget) so it never hits the 26s limit here.

const { corsHeaders, rateLimit, verifyAdminToken, triggerInternal } = require('./security');

exports.handler = async (event) => {
  const HEADERS = corsHeaders(event || {});
  const json = (data, status = 200) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(data) });
  if (event?.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event?.httpMethod !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const rl = rateLimit(event, 'check-results', { max: 10, windowMs: 60_000 });
  if (!rl.ok) return { statusCode: 429, headers: { ...HEADERS, 'Retry-After': String(rl.retryAfter) }, body: JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json({ error: 'Invalid JSON' }, 400); }

  try { verifyAdminToken(body.adminToken); }
  catch (err) { return json({ error: err.message }, err.status || 401); }

  try {
    const status = await triggerInternal('check-results-background', { betId: body.betId || null });
    return json({ started: true, bgStatus: status });
  } catch (e) {
    return json({ error: `Could not start results check: ${e.message}` }, 502);
  }
};
