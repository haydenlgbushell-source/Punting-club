// netlify/functions/check-results-scheduled.js
// Lightweight SCHEDULED function (cron in netlify.toml). Scheduled functions have
// a short execution limit and can't also be background functions, so this only
// fires check-results-background (with the internal token) and returns.

const { triggerInternal } = require('./security');

exports.handler = async () => {
  try {
    const status = await triggerInternal('check-results-background', {});
    console.log(`[check-results-scheduled] Triggered background settlement → HTTP ${status}`);
  } catch (e) {
    console.error('[check-results-scheduled] Trigger failed:', e.message);
    return { statusCode: 500 };
  }
  return { statusCode: 200 };
};
