// netlify/functions/generate-recap-scheduled.js
// Scheduled trigger (cron in netlify.toml) that fires the long-running
// generate-recap-background function with the internal token. Scheduled and
// -background functions are mutually exclusive on Netlify, so this short-lived
// function just kicks off the background worker.

const { triggerInternal } = require('./security');

exports.handler = async () => {
  try {
    const status = await triggerInternal('generate-recap-background', {});
    console.log(`[generate-recap-scheduled] Triggered background recap → HTTP ${status}`);
  } catch (e) {
    console.error('[generate-recap-scheduled] Trigger failed:', e.message);
    return { statusCode: 500 };
  }
  return { statusCode: 200 };
};
