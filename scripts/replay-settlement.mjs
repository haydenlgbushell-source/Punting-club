// Accuracy check for the results settler — run BEFORE trusting it in production.
//
// Re-runs the settler (read-only, nothing is written) on legs that already have a
// known result (won/lost/void) and reports, per market type:
//   correct    — settler agrees with the stored result
//   wrong      — settler would have settled it differently  ← must be ~0
//   undecided  — settler would have left it for retry / admin review
//
// This makes real Anthropic API calls (one web search per event), so it costs
// money. It refuses to run without --yes.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
//     node scripts/replay-settlement.mjs --yes [--events 20] [--admin-only]

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../netlify/functions/lib/settle.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };

const MAX_EVENTS = parseInt(opt('--events', '20'), 10);
const ADMIN_ONLY = flag('--admin-only');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY.');
  process.exit(1);
}
if (!flag('--yes')) {
  console.error(`This will make up to ${MAX_EVENTS} paid web-search calls. Re-run with --yes to continue.`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let q = supabase.from('bet_legs').select('*')
  .in('status', ['won', 'lost', 'void'])
  .not('event_date', 'is', null)
  .order('event_date', { ascending: false })
  .limit(1000);
if (ADMIN_ONLY) q = q.eq('settled_by', 'admin');
const { data: legs, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!legs?.length) { console.log('No settled legs to replay.'); process.exit(0); }

// Group like the live settler does.
const events = new Map();
for (const leg of legs) {
  const sport = S.classifySport(leg);
  const key = S.eventKeyFor(leg, sport);
  if (!events.has(key)) {
    events.set(key, {
      key, sport, event: leg.event, event_date: leg.event_date, start_time: leg.start_time,
      competition: leg.competition, home_team: leg.home_team, away_team: leg.away_team,
      venue: leg.venue, race_number: leg.race_number, legs: [], refs: [],
    });
  }
  const ev = events.get(key);
  const selKey = `${leg.selection}|${leg.market}|${leg.line ?? ''}|${leg.player ?? ''}|${leg.runner_number ?? ''}`.toLowerCase();
  let idx = ev.legs.findIndex(l => l._selKey === selKey);
  if (idx < 0) { ev.legs.push({ ...leg, _selKey: selKey }); idx = ev.legs.length - 1; }
  ev.refs.push({ leg, selIndex: idx + 1 });
}

const stats = {}; // market → { correct, wrong, undecided }
const wrongCases = [];
const bump = (m, k) => { stats[m] = stats[m] || { correct: 0, wrong: 0, undecided: 0 }; stats[m][k]++; };
const today = S.todayInTz();

const list = [...events.values()].slice(0, MAX_EVENTS);
console.log(`Replaying ${list.length} event(s) covering ${list.reduce((n, e) => n + e.refs.length, 0)} leg(s)...\n`);

for (const ev of list) {
  let facts = null;
  try { facts = await S.lookupEventFacts(ANTHROPIC_API_KEY, ev, today, () => {}); }
  catch (e) { console.warn(`  lookup failed for ${ev.event}: ${e.message}`); }
  const problem = facts ? S.evidenceProblem(facts, ev) : 'lookup failed';
  for (const { leg, selIndex } of ev.refs) {
    const market = S.classifyMarketForLeg(leg, ev.sport);
    const d = S.decideLeg(leg, facts, problem, ev.sport, selIndex);
    if (!d.status) { bump(market, 'undecided'); continue; }
    if (d.status === leg.status) bump(market, 'correct');
    else {
      bump(market, 'wrong');
      wrongCases.push(`${leg.event} | ${leg.selection} (${market}) — stored ${leg.status}, settler ${d.status}: ${d.note} [${facts?.source_url}]`);
    }
  }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, 2500));
}

console.log('\n\nmarket            correct  wrong  undecided  accuracy  coverage');
let T = { correct: 0, wrong: 0, undecided: 0 };
for (const [m, s] of Object.entries(stats)) {
  const decided = s.correct + s.wrong, total = decided + s.undecided;
  console.log(`${m.padEnd(17)} ${String(s.correct).padStart(7)} ${String(s.wrong).padStart(6)} ${String(s.undecided).padStart(10)}  ${decided ? `${Math.round(100 * s.correct / decided)}%`.padStart(8) : '     n/a'}  ${`${Math.round(100 * decided / total)}%`.padStart(8)}`);
  T = { correct: T.correct + s.correct, wrong: T.wrong + s.wrong, undecided: T.undecided + s.undecided };
}
const decided = T.correct + T.wrong;
console.log(`\nOverall: ${T.correct}/${decided} correct when it decided (${decided ? Math.round(100 * T.correct / decided) : 0}%), decided ${decided} of ${decided + T.undecided} legs.`);
if (wrongCases.length) { console.log('\nDisagreements (check these — the stored result may also be wrong):'); wrongCases.forEach(w => console.log(' - ' + w)); }
