// netlify/functions/lib/settle.js — results settlement engine (CommonJS)
//
// Design (v10):
//   1. Group unsettled legs by EVENT (match / race), not by selection.
//   2. For each event, look up FACTS once: final score + scorers (team sports) or
//      finishing order + scratchings (racing). Facts come from the event_results
//      cache when available, otherwise from one Claude web-search call restricted
//      to trusted results sites and an Australian location.
//   3. Settle each leg INDIVIDUALLY. Head-to-head, line, total, scorer, win and
//      place markets are settled by code from the facts (no AI maths). Anything
//      else uses the model's per-selection verdict, but only with high confidence.
//   4. Every automatic result needs evidence: a quote, a source URL on a trusted
//      domain, and a match date that matches the leg. Otherwise the leg stays
//      pending, is retried on a back-off schedule, and is finally flagged for an
//      admin to decide.
//
// The code tolerates the v2 migration (20261108000000) not being applied yet.

'use strict';

const API_URL   = 'https://api.anthropic.com/v1/messages';
const MODEL     = process.env.SETTLER_MODEL || 'claude-haiku-4-5-20251001';
const TZ        = process.env.APP_TIMEZONE || 'Australia/Sydney';
const UNSETTLED = ['pending', 'in_progress'];
const SETTLED   = ['won', 'lost', 'void'];
const VERSION   = 'v10-facts-evidence';

const MAX_ATTEMPTS        = 3;   // automatic tries per leg before an admin is asked
const MAX_EVENTS_PER_RUN  = 40;  // cost guard per run
const SLEEP_BETWEEN_MS    = 2500;
const CACHE_MAX_AGE_MS    = 14 * 24 * 60 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
// Delay after the scheduled start before each attempt (index = attempts so far).
const DELAYS = {
  racing:  [0.75 * HOUR, 6 * HOUR, 24 * HOUR],
  default: [3 * HOUR, 12 * HOUR, 24 * HOUR],
};

// ── Time helpers (DST-correct via Intl) ─────────────────────────────────────

function tzOffsetMinutes(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

// "2026-11-08" + "19:30" in Australia/Sydney → UTC epoch ms (handles AEDT/AEST).
function zonedToUtcMs(dateStr, timeStr, timeZone = TZ) {
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

function todayInTz(now = new Date(), timeZone = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function daysApart(a, b) {
  const ta = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (isNaN(ta) || isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / (24 * HOUR);
}

// ── Text helpers ────────────────────────────────────────────────────────────

const norm = (s) => String(s || '')
  .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const GENERIC_WORDS = new Set(['the', 'fc', 'afc', 'club', 'city', 'united', 'win', 'to', 'vs', 'v', 'and', 'of', 'over', 'under', 'line', 'draw']);

function nameScore(text, team) {
  const a = norm(text), b = norm(team);
  if (!a || !b) return 0;
  if (a.includes(b)) return 3;
  const aw = new Set(a.split(' '));
  const hits = b.split(' ').filter(w => w.length > 2 && !GENERIC_WORDS.has(w) && aw.has(w)).length;
  return hits;
}

// Which side of the match does this selection refer to? 'home' | 'away' | null.
function pickSide(selection, home, away) {
  const h = nameScore(selection, home), a = nameScore(selection, away);
  if (h > a && h > 0) return 'home';
  if (a > h && a > 0) return 'away';
  return null;
}

function playerMatches(want, got) {
  const w = norm(want).split(' ').filter(Boolean);
  const g = norm(got).split(' ').filter(Boolean);
  if (!w.length || !g.length) return false;
  if (w[w.length - 1] !== g[g.length - 1]) return false;          // surname must match
  if (w.length > 1 && g.length > 1 && w[0][0] !== g[0][0]) return false; // first initial if both given
  return true;
}

const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);

// ── Sport / market classification ───────────────────────────────────────────

function classifySport(leg) {
  const t = `${leg.sport || ''} ${leg.competition || ''} ${leg.event || ''} ${leg.market || ''}`.toLowerCase();
  if (/greyhound|\bgrv\b|the dogs/.test(t)) return 'greyhounds';
  if (/harness|trot|pacing|pacer/.test(t)) return 'harness';
  if (/horse|thoroughbred|gallop|\brace \d+\b|\br\d+\b|racing/.test(t)) return 'horse_racing';
  if (/rugby league|\bnrl\b|state of origin|super league/.test(t)) return 'rugby_league';
  if (/\bafl\b|aussie rules|australian rules/.test(t)) return 'afl';
  if (/cricket|\bbbl\b|big bash|\bodi\b|\bt20\b|test match|sheffield shield|\bipl\b/.test(t)) return 'cricket';
  if (/rugby union|super rugby|wallabies|all blacks|rugby championship|six nations/.test(t)) return 'rugby_union';
  if (/\bnfl\b|american football/.test(t)) return 'nfl';
  if (/basketball|\bnba\b|\bnbl\b|wnba/.test(t)) return 'basketball';
  if (/tennis|\batp\b|\bwta\b/.test(t)) return 'tennis';
  if (/\bufc\b|\bmma\b|boxing/.test(t)) return 'combat';
  if (/soccer|premier league|\bepl\b|a-league|a league|uefa|champions league|fifa|la liga|serie a|bundesliga/.test(t)) return 'soccer';
  const s = norm(leg.sport);
  return s ? s.replace(/ /g, '_') : 'other';
}

const isRacing = (sport) => ['horse_racing', 'harness', 'greyhounds'].includes(sport);

const MARKET_TYPES = new Set(['head_to_head', 'line', 'total', 'anytime_scorer', 'first_scorer', 'win', 'place', 'other']);

function classifyMarket(leg, sport) {
  const given = String(leg.market_type || leg.marketType || '').toLowerCase();
  if (MARKET_TYPES.has(given) && given !== 'other') return given;
  const m = `${leg.market || ''} ${leg.selection || ''}`.toLowerCase();
  if (isRacing(sport)) {
    if (/\bplace\b|\bplc\b/.test(m)) return 'place';
    if (/\bwin\b|fixed win|winner/.test(m) || !/each way|quinella|trifecta|exacta|first four/.test(m)) return 'win';
    return 'other';
  }
  if (/first (try|goal|scorer|touchdown)|1st (try|goal|scorer)/.test(m)) return 'first_scorer';
  if (/anytime|to score|try ?scorer|goal ?scorer|goalscorer|touchdown scorer/.test(m)) return 'anytime_scorer';
  if (/\bover\b|\bunder\b|total points|total goals|total runs|\btotal\b/.test(m)) return 'total';
  if (/\bline\b|handicap|spread|margin|[+-]\d+(\.\d+)?/.test(m)) return 'line';
  if (/head to head|\bh2h\b|match result|to win|winner|money ?line|1x2|match betting|\bwin\b/.test(m)) return 'head_to_head';
  return 'other';
}

function parseLine(leg) {
  const given = num(leg.line);
  if (given !== null) return given;
  const m = /([+-]\s?\d+(?:\.\d+)?)/.exec(`${leg.selection || ''} ${leg.market || ''}`);
  return m ? Number(m[1].replace(/\s/g, '')) : null;
}

function parseTotal(leg) {
  const text = `${leg.selection || ''} ${leg.market || ''}`.toLowerCase();
  const m = /\b(over|under)\b\s*\(?\s*(\d+(?:\.\d+)?)/.exec(text);
  const dir = m ? m[1] : /\bunder\b/.test(text) ? 'under' : /\bover\b/.test(text) ? 'over' : null;
  const given = num(leg.line);
  const val = given !== null ? Math.abs(given) : (m ? Number(m[2]) : null);
  return dir && val !== null ? { dir, val } : null;
}

// ── Trusted results sources (no bookmakers) ─────────────────────────────────

const GENERAL_DOMAINS = [
  'espn.com.au', 'espn.com', 'foxsports.com.au', 'abc.net.au', 'sbs.com.au', 'smh.com.au',
  'theage.com.au', 'news.com.au', 'theguardian.com', 'bbc.com', 'bbc.co.uk', 'reuters.com',
  'wikipedia.org', 'flashscore.com.au', 'sofascore.com',
];
const SPORT_DOMAINS = {
  rugby_league: ['nrl.com', 'rugbyleagueproject.org', 'zerotackle.com', 'superleague.co.uk'],
  afl:          ['afl.com.au', 'afltables.com', 'squiggle.com.au', 'footywire.com', 'aflw.com.au'],
  cricket:      ['espncricinfo.com', 'cricket.com.au', 'cricbuzz.com', 'icc-cricket.com'],
  rugby_union:  ['rugby.com.au', 'super.rugby', 'world.rugby', 'allblacks.com', 'sixnationsrugby.com'],
  soccer:       ['premierleague.com', 'keepup.com.au', 'aleagues.com.au', 'uefa.com', 'fifa.com', 'socceroos.com.au'],
  basketball:   ['nba.com', 'nbl.com.au', 'basketball-reference.com'],
  tennis:       ['atptour.com', 'wtatennis.com', 'ausopen.com', 'tennis.com.au'],
  nfl:          ['nfl.com', 'pro-football-reference.com'],
  combat:       ['ufc.com', 'sherdog.com', 'tapology.com'],
  horse_racing: ['racingaustralia.horse', 'racing.com', 'racenet.com.au', 'punters.com.au', 'racingnsw.com.au',
                 'racingvictoria.com.au', 'racingqueensland.com.au', 'rwwa.com.au', 'theracingpaper.com.au'],
  harness:      ['harness.org.au', 'hrv.org.au', 'racenet.com.au', 'punters.com.au', 'racingqueensland.com.au', 'rwwa.com.au'],
  greyhounds:   ['thegreyhoundrecorder.com.au', 'grv.org.au', 'thedogs.com.au', 'grnsw.com.au', 'punters.com.au', 'racingqueensland.com.au'],
};
const RACING_GENERAL = ['abc.net.au', 'news.com.au', 'smh.com.au', 'theage.com.au', 'foxsports.com.au', 'wikipedia.org'];

function domainsFor(sport) {
  const own = SPORT_DOMAINS[sport] || [];
  const general = isRacing(sport) ? RACING_GENERAL : GENERAL_DOMAINS;
  return [...new Set([...own, ...general])];
}

function isTrustedUrl(url, sport) {
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return false; }
  return domainsFor(sport).some(d => host === d || host.endsWith(`.${d}`));
}

// ── Event grouping ──────────────────────────────────────────────────────────

function eventKeyFor(leg, sport) {
  const date = leg.event_date || '';
  if (isRacing(sport) && leg.venue && leg.race_number) {
    return `race|${norm(leg.venue)}|r${leg.race_number}|${date}`;
  }
  if (leg.home_team && leg.away_team) {
    const teams = [norm(leg.home_team), norm(leg.away_team)].sort().join('~');
    return `${sport}|${teams}|${date}`;
  }
  return `${sport}|${norm(leg.event)}|${date}`;
}

// ── Code settlement from facts ──────────────────────────────────────────────

// Returns { status, note } or null if code can't settle this market from facts.
function settleFromFacts(leg, facts, sport) {
  if (!facts || facts.finished !== true) return null;
  const market = classifyMarket(leg, sport);

  if (isRacing(sport)) {
    const placings = Array.isArray(facts.placings) ? facts.placings : [];
    if (!placings.length) return null;
    const want = { no: num(leg.runner_number), name: leg.selection };
    const isMe = (r) => (want.no !== null && num(r.runner_number) === want.no) ||
                        (r.name && want.name && norm(want.name).includes(norm(r.name)) && norm(r.name).length > 2);
    const scratched = (facts.scratchings || []).some(s =>
      (want.no !== null && new RegExp(`(^|\\D)${want.no}(\\D|$)`).test(String(s))) ||
      (want.name && norm(String(s)).length > 2 && norm(want.name).includes(norm(String(s)))));
    if (scratched) return { status: 'void', note: 'Scratched' };
    if (facts.dead_heat) return null; // dividends reduced — admin decides
    const mine = placings.find(isMe);
    const pos = mine ? num(mine.position) : null;
    if (market === 'win') return pos === 1 ? { status: 'won', note: 'Won the race' } : { status: 'lost', note: pos ? `Finished ${pos}` : 'Unplaced' };
    if (market === 'place') {
      const field = num(facts.field_size);
      if (field === null) return pos === 1 || pos === 2 ? { status: 'won', note: `Finished ${pos}` } : null;
      const places = field >= 8 ? 3 : field >= 5 ? 2 : 0;
      if (!places) return null; // no place betting / special rules
      return pos !== null && pos <= places ? { status: 'won', note: `Placed ${pos} of ${field}` } : { status: 'lost', note: pos ? `Finished ${pos}` : 'Unplaced' };
    }
    return null;
  }

  const hs = num(facts.home_score), as = num(facts.away_score);
  const haveScore = hs !== null && as !== null;
  const scoreNote = haveScore ? `${facts.home_team} ${hs} – ${as} ${facts.away_team}` : '';

  if (market === 'head_to_head') {
    if (!haveScore) return null;
    if (/\bdraw\b|\btie\b/i.test(leg.selection || '')) return { status: hs === as ? 'won' : 'lost', note: scoreNote };
    if (hs === as) return null; // draw rules differ by market/bookmaker
    const side = pickSide(leg.selection, facts.home_team, facts.away_team);
    if (!side) return null;
    const won = side === 'home' ? hs > as : as > hs;
    return { status: won ? 'won' : 'lost', note: scoreNote };
  }
  if (market === 'line') {
    if (!haveScore) return null;
    const line = parseLine(leg);
    const side = pickSide(leg.selection, facts.home_team, facts.away_team);
    if (line === null || !side) return null;
    const margin = (side === 'home' ? hs - as : as - hs) + line;
    return { status: margin > 0 ? 'won' : margin < 0 ? 'lost' : 'void', note: `${scoreNote} (line ${line > 0 ? '+' : ''}${line})` };
  }
  if (market === 'total') {
    if (!haveScore) return null;
    const t = parseTotal(leg);
    if (!t) return null;
    const total = hs + as;
    if (total === t.val) return { status: 'void', note: `Total ${total}` };
    const won = t.dir === 'over' ? total > t.val : total < t.val;
    return { status: won ? 'won' : 'lost', note: `Total ${total} (${t.dir} ${t.val})` };
  }
  if (market === 'anytime_scorer' || market === 'first_scorer') {
    const player = leg.player || String(leg.selection || '').replace(/\b(anytime|to score|first|1st|try|goal|scorer|tryscorer|goalscorer)\b/gi, ' ');
    if (!norm(player)) return null;
    if (market === 'first_scorer') {
      if (!facts.first_scorer) return null;
      return playerMatches(player, facts.first_scorer)
        ? { status: 'won', note: `First scorer: ${facts.first_scorer}` }
        : { status: 'lost', note: `First scorer: ${facts.first_scorer}` };
    }
    const scorers = Array.isArray(facts.scorers) ? facts.scorers : [];
    if (scorers.some(s => playerMatches(player, s?.name || s))) return { status: 'won', note: `${player.trim()} scored` };
    if (facts.scorers_complete === true) return { status: 'lost', note: `${player.trim()} not among scorers` };
    return null;
  }
  return null;
}

// Evidence gate for any automatic settlement.
function evidenceProblem(facts, ev) {
  if (!facts) return 'no facts';
  if (!facts.source_url || !isTrustedUrl(facts.source_url, ev.sport)) return 'source not on trusted list';
  if (!facts.evidence_quote || String(facts.evidence_quote).trim().length < 8) return 'no evidence quote';
  if (ev.event_date) {
    if (!facts.match_date) return 'no match date';
    if (daysApart(facts.match_date, ev.event_date) > 1) return `date mismatch (${facts.match_date} vs ${ev.event_date})`;
  }
  return null;
}

// ── Claude: look up one event's facts ───────────────────────────────────────

const RECORD_TOOL = {
  name: 'record_event_result',
  description: 'Record the verified result of ONE match or race, with evidence. Call this exactly once, after searching.',
  input_schema: {
    type: 'object',
    properties: {
      finished:        { type: 'boolean', description: 'true only if the event has finished and a final result is published' },
      match_date:      { type: ['string', 'null'], description: 'Date the event was played, YYYY-MM-DD, Australian local date' },
      home_team:       { type: ['string', 'null'] },
      away_team:       { type: ['string', 'null'] },
      home_score:      { type: ['number', 'null'] },
      away_score:      { type: ['number', 'null'] },
      scorers:         { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, team: { type: ['string', 'null'] } }, required: ['name'] },
                         description: 'Every try/goal/touchdown scorer (one entry per player)' },
      scorers_complete:{ type: 'boolean', description: 'true only if the source lists the FULL scorer list' },
      first_scorer:    { type: ['string', 'null'] },
      placings:        { type: 'array', items: { type: 'object', properties: { position: { type: 'integer' }, runner_number: { type: ['integer', 'null'] }, name: { type: 'string' } }, required: ['position', 'name'] },
                         description: 'Racing only: finishing order, at least the first 4' },
      field_size:      { type: ['integer', 'null'], description: 'Racing only: number of starters (excluding scratchings)' },
      scratchings:     { type: 'array', items: { type: 'string' }, description: 'Racing only: scratched runner numbers/names' },
      dead_heat:       { type: 'boolean' },
      legs:            { type: 'array', description: 'Your verdict for EACH listed selection',
                         items: { type: 'object', properties: {
                           index:  { type: 'integer' },
                           status: { type: 'string', enum: ['won', 'lost', 'void', 'pending', 'unsure'] },
                           reason: { type: 'string' },
                         }, required: ['index', 'status', 'reason'] } },
      evidence_quote:  { type: 'string', description: 'Short exact quote from the source showing the result' },
      source_url:      { type: 'string', description: 'URL of the page the quote comes from' },
      confidence:      { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['finished', 'match_date', 'legs', 'evidence_quote', 'source_url', 'confidence'],
  },
};

function buildPrompt(ev, today) {
  const racing = isRacing(ev.sport);
  const legLines = ev.legs.map((l, i) => {
    const bits = [`Selection ${i + 1}: "${l.selection}"`, `market: ${l.market || l.market_type || '?'}`];
    if (l.player) bits.push(`player: ${l.player}`);
    if (l.line !== null && l.line !== undefined) bits.push(`line: ${l.line}`);
    if (l.runner_number) bits.push(`runner #${l.runner_number}`);
    return bits.join(' | ');
  }).join('\n');

  const what = racing
    ? `Race: ${ev.venue || ''}${ev.race_number ? ` Race ${ev.race_number}` : ''} — ${ev.event || ''}`
    : `Match: ${ev.home_team && ev.away_team ? `${ev.home_team} vs ${ev.away_team}` : ev.event}`;

  return `Today is ${today} (Australian time). Find the OFFICIAL FINAL result of this ${racing ? 'race' : 'match'}.

${what}
Sport: ${ev.sport.replace(/_/g, ' ')}${ev.competition ? ` | Competition: ${ev.competition}` : ''}
Scheduled date: ${ev.event_date || 'unknown'}${ev.start_time ? ` at ${ev.start_time} (${TZ})` : ''}

Selections to settle:
${legLines}

Instructions:
- Search for the result. Make sure the result you use is for THIS event on the scheduled date — not an earlier or later meeting of the same teams/horses.
- If it has not finished, or you cannot find a published final result, set finished=false.
- ${racing
    ? 'Record the finishing order (at least the first 4, with runner numbers), the number of starters, any scratchings, and whether there was a dead heat.'
    : 'Record the final score, and the full list of try/goal/touchdown scorers if the source has it (set scorers_complete accordingly).'}
- Give your verdict for every selection (index = selection number). Use "unsure" rather than guessing.
- evidence_quote must be copied from the source page, and source_url must be that page.
- Then call record_event_result exactly once.`;
}

async function callMessages(apiKey, body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function lookupEventFacts(apiKey, ev, today, log) {
  let restrictDomains = true;
  let messages = [{ role: 'user', content: buildPrompt(ev, today) }];
  let forceRecord = false;

  for (let turn = 0; turn < 6; turn++) {
    const webSearch = {
      type: 'web_search_20250305', name: 'web_search', max_uses: 4,
      user_location: { type: 'approximate', country: 'AU', timezone: TZ },
      ...(restrictDomains ? { allowed_domains: domainsFor(ev.sport) } : {}),
    };
    const body = {
      model: MODEL,
      max_tokens: 2048,
      tools: [webSearch, RECORD_TOOL],
      messages,
      ...(forceRecord ? { tool_choice: { type: 'tool', name: RECORD_TOOL.name } } : {}),
    };
    const { ok, status, data } = await callMessages(apiKey, body);
    if (!ok) {
      const msg = data?.error?.message || `Anthropic API ${status}`;
      // If the domain allowlist itself is rejected, retry once without it
      // (the evidence gate still enforces trusted sources afterwards).
      if (status === 400 && restrictDomains && /domain/i.test(msg)) { restrictDomains = false; log(`allowed_domains rejected (${msg}); retrying unrestricted`); continue; }
      throw new Error(msg);
    }

    const content = data.content || [];
    const record = content.find(b => b.type === 'tool_use' && b.name === RECORD_TOOL.name);
    if (record) return record.input || null;

    if (data.stop_reason === 'refusal') return null;
    messages = [...messages, { role: 'assistant', content }];
    // pause_turn: the server-side search loop paused — re-send as-is to resume.
    if (data.stop_reason === 'pause_turn') continue;
    // Finished talking without recording: ask for the record (forced) next turn.
    messages.push({ role: 'user', content: 'Now call record_event_result with what you found. If you could not confirm a final result, set finished=false and confidence="low".' });
    forceRecord = true;
  }
  return null;
}

// Decide one leg from an event's facts. Returns one of:
//   { status, note }   settle automatically
//   { review }         conflict — send straight to an admin
//   { retry }          not resolvable yet — try again later
function decideLeg(leg, facts, problem, sport, selIndex) {
  if (facts?.finished && !problem) {
    const code = settleFromFacts(leg, facts, sport);
    const verdict = (facts.legs || []).find(v => Number(v.index) === selIndex);
    const modelStatus = verdict && SETTLED.includes(verdict.status) ? verdict.status : null;
    if (code) {
      if (modelStatus && modelStatus !== code.status) {
        return { review: `Code says ${code.status} (${code.note}); AI says ${modelStatus} (${verdict.reason})` };
      }
      return { status: code.status, note: code.note };
    }
    if (modelStatus && facts.confidence === 'high') return { status: modelStatus, note: verdict.reason || '' };
    return { retry: verdict?.reason || 'market needs manual check' };
  }
  if (facts && facts.finished === false && !problem) return { retry: 'not finished yet' };
  return { retry: problem || 'no result found' };
}

// ── DB helpers (tolerant of the v2 migration not being applied) ─────────────

function makeDb(supabase, log) {
  let v2 = true;
  const BASE_LEG_FIELDS = ['status', 'result_note', 'updated_at'];

  const updateLeg = async (id, fields) => {
    if (v2) {
      const { error } = await supabase.from('bet_legs').update(fields).eq('id', id);
      if (!error) return true;
      if (!/column|schema cache/i.test(error.message || '')) { log(`DB error leg ${id}: ${error.message}`); return false; }
      v2 = false;
      log('v2 bet_legs columns missing — apply migration 20261108000000; continuing with base columns');
    }
    const base = Object.fromEntries(Object.entries(fields).filter(([k]) => BASE_LEG_FIELDS.includes(k)));
    if (!Object.keys(base).length) return true;
    const { error } = await supabase.from('bet_legs').update(base).eq('id', id);
    if (error) { log(`DB error leg ${id}: ${error.message}`); return false; }
    return true;
  };

  let cacheOk = true;
  const getCached = async (key) => {
    if (!cacheOk) return null;
    const { data, error } = await supabase.from('event_results').select('*').eq('event_key', key).maybeSingle();
    if (error) { cacheOk = false; return null; }
    if (!data || !data.finished) return null;
    if (Date.now() - new Date(data.fetched_at).getTime() > CACHE_MAX_AGE_MS) return null;
    return data.facts || null;
  };
  const putCached = async (key, ev, facts) => {
    if (!cacheOk) return;
    const { error } = await supabase.from('event_results').upsert({
      event_key: key, sport: ev.sport, event: ev.event || null, event_date: ev.event_date || null,
      finished: !!facts.finished, facts, source_url: facts.source_url || null,
      evidence: facts.evidence_quote || null, fetched_at: new Date().toISOString(),
    }, { onConflict: 'event_key' });
    if (error) cacheOk = false;
  };

  return { updateLeg, getCached, putCached };
}

function overallFromLegs(legs) {
  if (!legs.length) return 'pending';
  const allDone = legs.every(l => SETTLED.includes(l.status));
  if (allDone) {
    if (legs.every(l => l.status === 'won')) return 'won';
    if (legs.some(l => l.status === 'lost')) return 'lost';
    return 'partial';
  }
  if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
  return 'pending';
}

// ── Main entry point ────────────────────────────────────────────────────────

async function settleRun({ supabase, apiKey, betId = null, log = console.log }) {
  const L = (m) => log(`[settle ${VERSION}] ${m}`);
  const db = makeDb(supabase, L);
  const now = new Date();
  const nowMs = now.getTime();
  const today = todayInTz(now);
  const summary = { version: VERSION, model: MODEL, events: 0, searches: 0, cacheHits: 0, legsSettled: 0, legsFlagged: 0, betsUpdated: 0 };

  let q = supabase.from('bets').select('id, overall_status, team_id, bet_legs(*)');
  q = betId ? q.eq('id', betId) : q.in('overall_status', UNSETTLED).order('submitted_at', { ascending: false });
  const { data: bets, error } = await q;
  if (error) throw new Error(error.message);
  if (!bets?.length) { L('no unsettled bets'); return summary; }

  // Collect due legs, grouped by event.
  const events = new Map(); // key → ev
  const betLegs = new Map(); // betId → legs[] (live objects, mutated as we settle)
  for (const bet of bets) {
    const legs = bet.bet_legs || [];
    betLegs.set(bet.id, { bet, legs });
    for (const leg of legs) {
      if (!UNSETTLED.includes(leg.status)) continue;
      if (leg.needs_review && !betId) continue; // waiting on an admin
      const sport = classifySport(leg);
      const start = leg.event_date ? zonedToUtcMs(leg.event_date, leg.start_time || (isRacing(sport) ? '12:00' : '00:00')) : NaN;
      const attempts = leg.check_attempts || 0;
      if (!betId) {
        if (attempts >= MAX_ATTEMPTS) continue;
        if (!isNaN(start)) {
          const delays = isRacing(sport) ? DELAYS.racing : DELAYS.default;
          if (nowMs < start + delays[Math.min(attempts, delays.length - 1)]) continue;
        }
      } else if (!isNaN(start) && nowMs < start) {
        continue; // even a manual check can't settle an event that hasn't started
      }
      const key = eventKeyFor(leg, sport);
      if (!events.has(key)) {
        events.set(key, {
          key, sport, event: leg.event, event_date: leg.event_date, start_time: leg.start_time,
          competition: leg.competition, home_team: leg.home_team, away_team: leg.away_team,
          venue: leg.venue, race_number: leg.race_number, legs: [], refs: [],
        });
      }
      const ev = events.get(key);
      // One prompt line per distinct selection; every leg keeps its own ref.
      const selKey = `${norm(leg.selection)}|${classifyMarket(leg, sport)}|${leg.line ?? ''}|${norm(leg.player)}|${leg.runner_number ?? ''}`;
      let idx = ev.legs.findIndex(l => l._selKey === selKey);
      if (idx < 0) { ev.legs.push({ ...leg, _selKey: selKey }); idx = ev.legs.length - 1; }
      ev.refs.push({ betId: bet.id, leg, selIndex: idx + 1 });
    }
  }
  if (!events.size) { L('no legs due for checking'); return summary; }

  const evList = [...events.values()].slice(0, MAX_EVENTS_PER_RUN);
  L(`${evList.length} event(s) to check (${events.size} due) across ${bets.length} bet(s)`);
  const touchedBets = new Set();
  const flagged = [];

  for (const ev of evList) {
    summary.events++;
    let facts = await db.getCached(ev.key);
    if (facts) {
      summary.cacheHits++;
    } else {
      if (summary.searches > 0) await new Promise(r => setTimeout(r, SLEEP_BETWEEN_MS));
      summary.searches++;
      try { facts = await lookupEventFacts(apiKey, ev, today, L); }
      catch (e) { L(`lookup error for "${ev.event}": ${e.message}`); facts = null; }
    }
    const problem = facts ? evidenceProblem(facts, ev) : 'lookup failed';
    if (facts?.finished && !problem) await db.putCached(ev.key, ev, facts);
    L(`"${ev.event}" (${ev.event_date || 'no date'}): finished=${facts?.finished} confidence=${facts?.confidence} ${problem ? `problem=${problem}` : 'evidence ok'}`);

    for (const ref of ev.refs) {
      const { leg } = ref;
      const base = { updated_at: now.toISOString(), last_checked_at: now.toISOString() };
      const decision = decideLeg(leg, facts, problem, ev.sport, ref.selIndex);

      if (decision.status) {
        const ok = await db.updateLeg(leg.id, {
          ...base, status: decision.status, result_note: decision.note || '',
          result_source_url: facts.source_url, result_evidence: String(facts.evidence_quote).slice(0, 500),
          settled_by: 'auto', needs_review: false,
        });
        if (ok) { leg.status = decision.status; summary.legsSettled++; touchedBets.add(ref.betId); }
        continue;
      }

      const attempts = (leg.check_attempts || 0) + 1;
      const giveUp = !!decision.review || attempts >= MAX_ATTEMPTS;
      const note = decision.review || decision.retry;
      await db.updateLeg(leg.id, {
        ...base, check_attempts: attempts,
        needs_review: giveUp,
        result_note: giveUp ? `Needs admin review: ${note}` : (leg.result_note || ''),
        ...(facts?.source_url ? { result_source_url: facts.source_url } : {}),
      });
      leg.check_attempts = attempts;
      if (giveUp) { summary.legsFlagged++; flagged.push(`${leg.selection} (${leg.event}): ${note}`); }
    }
  }

  for (const bid of touchedBets) {
    const { bet, legs } = betLegs.get(bid);
    const next = overallFromLegs(legs);
    if (next !== bet.overall_status) {
      const { error: e } = await supabase.from('bets').update({ overall_status: next }).eq('id', bid);
      if (!e) summary.betsUpdated++;
    }
  }

  if (flagged.length) {
    await supabase.from('admin_notifications').insert({
      type: 'results_review',
      title: `${flagged.length} bet leg(s) need a manual result`,
      message: flagged.slice(0, 10).join('\n'),
      data: { count: flagged.length },
    }).then(({ error: e }) => { if (e) L(`notify failed: ${e.message}`); });
  }

  L(`done: ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = {
  settleRun, overallFromLegs, decideLeg, lookupEventFacts, classifyMarketForLeg: classifyMarket,
  // exported for tests
  settleFromFacts, classifySport, classifyMarket, evidenceProblem, zonedToUtcMs, todayInTz, pickSide, playerMatches, eventKeyFor, domainsFor,
};
