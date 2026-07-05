// netlify/functions/check-results-scheduled.js
// Lightweight SCHEDULED function (cron configured in netlify.toml). Netlify
// scheduled functions run under a short (~10–30s) execution limit, and a
// function cannot be both "scheduled" and "-background" — so this does NOT do
// the settlement work itself. It simply fires the long-running
// check-results-background function (15-min budget) and returns immediately.

exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    console.error('[check-results-scheduled] No site URL env var; cannot trigger background function');
    return { statusCode: 500 };
  }
  const url = `${base}/.netlify/functions/check-results-background`;
  try {
    // Background functions return 202 immediately, so this awaits only the accept.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    console.log(`[check-results-scheduled] Triggered background settlement → HTTP ${res.status}`);
  } catch (e) {
    console.error('[check-results-scheduled] Trigger failed:', e.message);
    return { statusCode: 500 };
  }
  return { statusCode: 200 };
};
