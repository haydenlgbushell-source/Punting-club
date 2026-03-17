// Run with: node scripts/check-and-report.mjs
// Reads every bet + leg from Supabase, triggers a result check via the
// background function, then polls until results land and prints a summary.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lrqqcakgwahwtmhtkoiy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // required — set in env
const SITE_URL     = process.env.SITE_URL || 'https://your-netlify-site.netlify.app'; // ← set this

if (!SUPABASE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required');
  console.error('Run: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/check-and-report.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchBets() {
  const { data, error } = await supabase
    .from('bets')
    .select(`
      id, overall_status, submitted_at, week_number,
      teams(team_name),
      bet_legs(leg_number, selection, event, market, odds, status, result_note, event_date)
    `)
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

function printBets(bets, label) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(` ${label}`);
  console.log(`${'═'.repeat(72)}`);
  for (const bet of bets) {
    const team = bet.teams?.team_name || bet.team_id;
    const legs = (bet.bet_legs || []).sort((a,b) => a.leg_number - b.leg_number);
    const icon = { won:'✅', lost:'❌', partial:'⚡', in_progress:'🔴', pending:'⏳', rejected:'🚫' }[bet.overall_status] || '❓';
    console.log(`\n${icon}  ${team}  |  Week ${bet.week_number ?? '?'}  |  ${bet.overall_status?.toUpperCase()}  |  ${new Date(bet.submitted_at).toLocaleDateString('en-AU')}`);
    for (const l of legs) {
      const s = { won:'✓', lost:'✗', in_progress:'◉', pending:'⏳', void:'—' }[l.status] || '?';
      console.log(`   Leg ${l.leg_number}: [${s}] ${l.selection}  ·  ${l.event}  ·  ${l.market}  @${l.odds}`);
      if (l.result_note) console.log(`          → ${l.result_note}`);
    }
  }
  console.log('');
}

(async () => {
  console.log('Fetching current bets…');
  const before = await fetchBets();
  printBets(before, 'CURRENT STATE');

  const pending = before.filter(b =>
    (b.bet_legs || []).some(l => ['pending','in_progress'].includes(l.status))
  );
  if (!pending.length) {
    console.log('All legs already settled — nothing to check.');
    process.exit(0);
  }
  console.log(`${pending.length} bet(s) have unsettled legs. Triggering result check…`);

  // Fire the background function — replace SITE_URL with your Netlify URL
  try {
    const r = await fetch(`${SITE_URL}/.netlify/functions/check-results-background`, { method: 'POST' });
    console.log(`Background function fired (${r.status}). Polling for changes…`);
  } catch(e) {
    console.warn('Could not reach Netlify function:', e.message);
    console.log('Showing current DB state only (above).');
    process.exit(0);
  }

  // Poll for up to 3 minutes
  const snapshot = {};
  before.forEach(b => (b.bet_legs||[]).forEach(l => { snapshot[l.id] = l.status; }));
  let changed = false;
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    process.stdout.write(`\r  Polling… ${(i+1)*5}s elapsed`);
    const fresh = await fetchBets();
    const anyChanged = fresh.some(b => (b.bet_legs||[]).some(l => snapshot[l.id] && snapshot[l.id] !== l.status));
    if (anyChanged) { changed = true; printBets(fresh, 'UPDATED RESULTS'); break; }
    if (i === 35) printBets(fresh, 'FINAL STATE (no changes detected)');
  }

  if (!changed) console.log('No leg changes detected in 3 minutes — events may still be in progress.');
  process.exit(0);
})();
