// Australian time helpers shared by the browser and the Netlify functions.
// Uses Intl so daylight saving (AEDT, Oct–Apr) is handled correctly.
// Competition time zone: Australia/Sydney (NSW/VIC/ACT/TAS). Override on the
// server with APP_TIMEZONE if a competition runs elsewhere.

const envTz = typeof process !== 'undefined' && process.env && process.env.APP_TIMEZONE;
export const APP_TZ = envTz || 'Australia/Sydney';

const DAY = 24 * 60 * 60 * 1000;

export function tzOffsetMinutes(utcMs, timeZone = APP_TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

// Local wall-clock date + time in `timeZone` → UTC epoch ms.
export function zonedToUtcMs(dateStr, timeStr, timeZone = APP_TZ) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!d) return NaN;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '')) || [null, '0', '0'];
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const off1 = tzOffsetMinutes(guess, timeZone);
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(utc, timeZone);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return utc;
}

// YYYY-MM-DD for "now" in the competition time zone.
export function todayInTz(now = new Date(), timeZone = APP_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun … 3=Wed

// ── Competition weeks ───────────────────────────────────────────────────────
// Betting weeks roll over every WEDNESDAY at 12:00 MIDDAY local time.
// Week 1 runs from the start date until the first Wednesday-midday cutoff after it.
export const CUTOFF_WEEKDAY = 3;   // Wednesday
export const CUTOFF_TIME    = '12:00';
// Wording used everywhere the rule is explained to users.
export const CUTOFF_TEXT    = 'Wednesday 12:00 pm (midday) Sydney time';

function firstCutoffDate(startDate) {
  const s = String(startDate).slice(0, 10);
  return addDays(s, (CUTOFF_WEEKDAY - weekday(s) + 7) % 7); // same day if start is a Wednesday
}

// Competition week (1-based) that the instant `atMs` falls in.
export function weekAt(atMs, startDate, timeZone = APP_TZ) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}/.test(String(startDate))) return 1;
  const first = firstCutoffDate(startDate);
  const cutoff = (k) => zonedToUtcMs(addDays(first, 7 * k), CUTOFF_TIME, timeZone);
  if (atMs < cutoff(0)) return 1;
  let k = Math.floor((atMs - cutoff(0)) / (7 * DAY));
  while (k > 0 && atMs < cutoff(k)) k--;          // DST shifts can put us an hour either side
  while (atMs >= cutoff(k + 1)) k++;
  return k + 2;
}

export const calcCurrentWeek = (startDate) => weekAt(Date.now(), startDate);

// Next Wednesday-midday cutoff after `now` (a Date in real UTC).
export function nextCutoff(now = new Date(), timeZone = APP_TZ) {
  let d = todayInTz(now, timeZone);
  d = addDays(d, (CUTOFF_WEEKDAY - weekday(d) + 7) % 7);
  let ms = zonedToUtcMs(d, CUTOFF_TIME, timeZone);
  if (ms <= now.getTime()) ms = zonedToUtcMs(addDays(d, 7), CUTOFF_TIME, timeZone);
  return new Date(ms);
}

// Human label for a cutoff, e.g. "Wed 12 Nov, 12:00 pm AEDT".
export function formatCutoff(date, timeZone = APP_TZ) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

// Whole years between a YYYY-MM-DD birth date and today in Australia.
export function ageOn(dobStr, now = new Date(), timeZone = APP_TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dobStr || ''));
  if (!m) return null;
  const [y, mo, d] = todayInTz(now, timeZone).split('-').map(Number);
  let age = y - Number(m[1]);
  if (mo < Number(m[2]) || (mo === Number(m[2]) && d < Number(m[3]))) age--;
  return age;
}
