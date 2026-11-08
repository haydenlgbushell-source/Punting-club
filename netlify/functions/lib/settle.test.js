// Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./settle');

const nrlFacts = {
  finished: true, match_date: '2026-11-07', home_team: 'Melbourne Storm', away_team: 'Penrith Panthers',
  home_score: 24, away_score: 18, scorers: [{ name: 'Ryan Papenhuyzen' }, { name: 'Xavier Coates' }, { name: 'Brian To\'o' }],
  scorers_complete: true, first_scorer: 'Xavier Coates', legs: [], evidence_quote: 'Storm 24 def Panthers 18',
  source_url: 'https://www.nrl.com/draw/nrl-premiership/2026/round-1/storm-v-panthers/', confidence: 'high',
};

test('time: Sydney DST is handled (AEDT in November, AEST in July)', () => {
  assert.equal(new Date(S.zonedToUtcMs('2026-11-07', '19:30')).toISOString(), '2026-11-07T08:30:00.000Z'); // UTC+11
  assert.equal(new Date(S.zonedToUtcMs('2026-07-04', '19:30')).toISOString(), '2026-07-04T09:30:00.000Z'); // UTC+10
});

test('head to head: each selection settles on its own (the old shared-result bug)', () => {
  const storm = { selection: 'Melbourne Storm', market: 'Head to Head' };
  const panthers = { selection: 'Penrith Panthers', market: 'Head to Head' };
  assert.equal(S.settleFromFacts(storm, nrlFacts, 'rugby_league').status, 'won');
  assert.equal(S.settleFromFacts(panthers, nrlFacts, 'rugby_league').status, 'lost');
});

test('line and total markets', () => {
  const line = (sel) => S.settleFromFacts({ selection: sel, market: 'Line' }, nrlFacts, 'rugby_league')?.status;
  assert.equal(line('Penrith Panthers +6.5'), 'won');   // 18 + 6.5 > 24
  assert.equal(line('Melbourne Storm -6.5'), 'lost');
  assert.equal(line('Melbourne Storm -6'), 'void');      // push
  const total = (sel) => S.settleFromFacts({ selection: sel, market: 'Total Points' }, nrlFacts, 'rugby_league')?.status;
  assert.equal(total('Over 40.5'), 'won');
  assert.equal(total('Under 40.5'), 'lost');
});

test('scorer markets match on surname + initial; incomplete lists stay unresolved', () => {
  const any = (p, f = nrlFacts) => S.settleFromFacts({ selection: p, market: 'Anytime Try Scorer', player: p }, f, 'rugby_league')?.status;
  assert.equal(any('R. Papenhuyzen'), 'won');
  assert.equal(any('Nathan Cleary'), 'lost');
  assert.equal(any('Nathan Cleary', { ...nrlFacts, scorers_complete: false }), undefined);
  const first = S.settleFromFacts({ selection: 'Xavier Coates', market: 'First Try Scorer', player: 'Xavier Coates' }, nrlFacts, 'rugby_league');
  assert.equal(first.status, 'won');
});

test('draws in head to head go to review, not guessed', () => {
  const draw = { ...nrlFacts, home_score: 20, away_score: 20 };
  assert.equal(S.settleFromFacts({ selection: 'Melbourne Storm', market: 'Head to Head' }, draw, 'rugby_league'), null);
  assert.equal(S.settleFromFacts({ selection: 'Draw', market: 'Head to Head' }, draw, 'rugby_league').status, 'won');
});

test('racing: win, place by field size, scratchings, dead heat', () => {
  const race = { finished: true, placings: [{ position: 1, runner_number: 4, name: 'Fast Horse' }, { position: 2, runner_number: 9, name: 'Second Go' }, { position: 3, runner_number: 1, name: 'Third Time' }],
    field_size: 10, scratchings: ['7. Late Scratch'], dead_heat: false };
  const r = (leg, f = race) => S.settleFromFacts(leg, f, 'horse_racing')?.status;
  assert.equal(r({ selection: 'Fast Horse', market: 'Win', runner_number: 4 }), 'won');
  assert.equal(r({ selection: 'Second Go', market: 'Win', runner_number: 9 }), 'lost');
  assert.equal(r({ selection: 'Third Time', market: 'Place', runner_number: 1 }), 'won');
  assert.equal(r({ selection: 'Third Time', market: 'Place', runner_number: 1 }, { ...race, field_size: 6 }), 'lost'); // 2 places
  assert.equal(r({ selection: 'Late Scratch', market: 'Win', runner_number: 7 }), 'void');
  assert.equal(r({ selection: 'Fast Horse', market: 'Win', runner_number: 4 }, { ...race, dead_heat: true }), undefined);
});

test('evidence gate: trusted domain, quote and matching date are required', () => {
  const ev = { sport: 'rugby_league', event_date: '2026-11-07' };
  assert.equal(S.evidenceProblem(nrlFacts, ev), null);
  assert.match(S.evidenceProblem({ ...nrlFacts, source_url: 'https://random-tipster-blog.com/x' }, ev), /trusted/);
  assert.match(S.evidenceProblem({ ...nrlFacts, match_date: '2026-10-31' }, ev), /date mismatch/);
  assert.match(S.evidenceProblem({ ...nrlFacts, evidence_quote: '' }, ev), /quote/);
});

test('classification', () => {
  assert.equal(S.classifySport({ event: 'Storm v Panthers', competition: 'NRL' }), 'rugby_league');
  assert.equal(S.classifySport({ event: 'Flemington R7', market: 'Win' }), 'horse_racing');
  assert.equal(S.classifySport({ event: 'Sydney Swans v Carlton', competition: 'AFL' }), 'afl');
  assert.equal(S.classifyMarket({ market: 'Line', selection: 'Storm -6.5' }, 'rugby_league'), 'line');
  assert.equal(S.classifyMarket({ market: 'To Score Anytime', selection: 'Munster' }, 'rugby_league'), 'anytime_scorer');
});

// ── End-to-end with a fake database and a fake Anthropic API ────────────────

function fakeSupabase(bets) {
  const updates = { bet_legs: [], bets: [], admin_notifications: [], event_results: [] };
  const builder = (table) => {
    const st = { table, op: 'select', filters: [], payload: null };
    const exec = async () => {
      if (st.op === 'update' || st.op === 'insert' || st.op === 'upsert') {
        updates[table]?.push({ payload: st.payload, filters: st.filters });
        if (table === 'bet_legs' && st.op === 'update') {
          const id = st.filters.find(f => f[0] === 'id')?.[1];
          for (const b of bets) for (const l of b.bet_legs) if (l.id === id) Object.assign(l, st.payload);
        }
        return { data: null, error: null };
      }
      if (table === 'bets') return { data: bets.filter(b => ['pending', 'in_progress'].includes(b.overall_status)), error: null };
      if (table === 'event_results') return { data: null, error: null };
      return { data: [], error: null };
    };
    const api = {
      select() { return api; }, eq(k, v) { st.filters.push([k, v]); return api; }, in() { return api; }, order() { return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; }, insert(p) { st.op = 'insert'; st.payload = p; return api; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
      maybeSingle: exec, single: exec, then: (res, rej) => exec().then(res, rej),
    };
    return api;
  };
  return { from: builder, updates };
}

test('settleRun: two bets on one match get their own results; pause_turn resumes; bad evidence retries', async () => {
  const legBase = { status: 'pending', event: 'Melbourne Storm vs Penrith Panthers', event_date: '2026-11-07', start_time: '19:30',
    sport: 'rugby_league', competition: 'NRL', home_team: 'Melbourne Storm', away_team: 'Penrith Panthers', check_attempts: 0 };
  const bets = [
    { id: 'b1', overall_status: 'pending', bet_legs: [{ ...legBase, id: 'l1', leg_number: 1, selection: 'Melbourne Storm', market: 'Head to Head', market_type: 'head_to_head' }] },
    { id: 'b2', overall_status: 'pending', bet_legs: [{ ...legBase, id: 'l2', leg_number: 1, selection: 'Penrith Panthers', market: 'Head to Head', market_type: 'head_to_head' }] },
    { id: 'b3', overall_status: 'pending', bet_legs: [{ ...legBase, id: 'l3', leg_number: 1, event: 'Roosters vs Rabbitohs', home_team: 'Sydney Roosters', away_team: 'South Sydney Rabbitohs', selection: 'Sydney Roosters', market: 'Head to Head', market_type: 'head_to_head' }] },
  ];
  const sb = fakeSupabase(bets);
  let calls = 0;
  const realFetch = global.fetch;
  global.fetch = async (_url, opts) => {
    calls++;
    const body = JSON.parse(opts.body);
    const prompt = body.messages[0].content;
    assert.ok(body.tools.find(t => t.name === 'web_search').allowed_domains.includes('nrl.com'));
    const reply = (obj) => ({ ok: true, status: 200, json: async () => obj });
    if (prompt.includes('Storm')) {
      if (body.messages.length === 1) return reply({ stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'storm panthers' } }] });
      return reply({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'record_event_result', input: {
        ...nrlFacts, legs: [{ index: 1, status: 'won', reason: 'Storm won' }, { index: 2, status: 'lost', reason: 'Panthers lost' }] } }] });
    }
    // Roosters game: result only from an untrusted site → must NOT settle.
    return reply({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'record_event_result', input: {
      finished: true, match_date: '2026-11-07', home_team: 'Sydney Roosters', away_team: 'South Sydney Rabbitohs', home_score: 30, away_score: 10,
      legs: [{ index: 1, status: 'won', reason: 'x' }], evidence_quote: 'Roosters won 30-10', source_url: 'https://some-tips-forum.net/thread', confidence: 'high' } }] });
  };
  try {
    const summary = await S.settleRun({ supabase: sb, apiKey: 'k', log: () => {} });
    assert.equal(bets[0].bet_legs[0].status, 'won');
    assert.equal(bets[1].bet_legs[0].status, 'lost');
    assert.equal(bets[2].bet_legs[0].status, 'pending');
    assert.equal(bets[2].bet_legs[0].check_attempts, 1);
    assert.equal(summary.searches, 2);   // one search per match, not per bet
    assert.equal(calls, 3);              // + one resume after pause_turn
    assert.equal(summary.legsSettled, 2);
  } finally {
    global.fetch = realFetch;
  }
});
