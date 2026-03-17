// Minimal test — no imports, no API calls
// If this returns 202 from /.netlify/functions/check-results-background
// then the issue is in the function code, not the Netlify background function setup.
exports.handler = async () => {
  console.log('[check-results-background] ping OK');
};
