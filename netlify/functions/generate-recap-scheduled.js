// netlify/functions/generate-recap-scheduled.js
// Scheduled trigger (cron in netlify.toml) that fires the long-running
// generate-recap-background function. Same reason as check-results-scheduled:
// scheduled and -background functions are mutually exclusive on Netlify, so the
// short-lived scheduled function just kicks off the background worker.

exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    console.error('[generate-recap-scheduled] No site URL env var; cannot trigger background function');
    return { statusCode: 500 };
  }
  const url = `${base}/.netlify/functions/generate-recap-background`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    console.log(`[generate-recap-scheduled] Triggered background recap → HTTP ${res.status}`);
  } catch (e) {
    console.error('[generate-recap-scheduled] Trigger failed:', e.message);
    return { statusCode: 500 };
  }
  return { statusCode: 200 };
};
