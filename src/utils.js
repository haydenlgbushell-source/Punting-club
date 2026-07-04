// Shared utility functions and constants

export const WEEK_BUDGET = 50;

export const genCode = (len = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const result = [];
  while (result.length < len) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0];
    // Reject values >= 252 to avoid modulo bias (256 % 36 = 4)
    if (byte < 252) result.push(chars[byte % 36]);
  }
  return result.join('');
};

export const parseAnalysisJSON = (text) => {
  if (!text) return null;
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  // Fast path: the response is pure JSON.
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // Fallback: pull out the outermost { … } object even if the model wrapped it
  // in explanatory prose. Guards against parse failures from stray leading text.
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* give up */ }
  }
  return null;
};

// Validate and normalise Australian mobile numbers
// Accepts: 04XX XXX XXX, +614XX XXX XXX, 614XX XXX XXX
export const validatePhone = (raw) => {
  const digits = raw.replace(/\D/g, '');
  if (/^04\d{8}$/.test(digits))  return { valid: true, normalised: '0' + digits.slice(1) };
  if (/^614\d{8}$/.test(digits)) return { valid: true, normalised: '0' + digits.slice(2) };
  if (/^4\d{8}$/.test(digits))   return { valid: true, normalised: '0' + digits };
  return { valid: false, normalised: null };
};

// Calculate which competition week we are in.
// Week boundaries are Wednesday 12:00 AEST — same logic used on frontend and backend.
export const calcCurrentWeek = (startDate) => {
  if (!startDate) return 1;
  const AEST = 10 * 60 * 60 * 1000; // UTC+10 in ms
  const nowAEST   = Date.now() + AEST;
  const startAEST = new Date(startDate).getTime() + AEST;

  // First Wednesday 12:00 AEST strictly after startAEST
  let boundary = new Date(startAEST);
  boundary.setUTCHours(12, 0, 0, 0);
  const daysToWed = (3 - boundary.getUTCDay() + 7) % 7;
  boundary = new Date(boundary.getTime() + daysToWed * 86400000);
  if (boundary.getTime() <= startAEST) boundary = new Date(boundary.getTime() + 7 * 86400000);

  if (nowAEST < boundary.getTime()) return 1;
  return Math.floor((nowAEST - boundary.getTime()) / (7 * 86400000)) + 2;
};
