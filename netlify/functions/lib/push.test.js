// Tests for who gets bet-placed / bet-won notifications. Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');

process.env.VAPID_PUBLIC_KEY = 'test-public';
process.env.VAPID_PRIVATE_KEY = 'test-private';
webpush.setVapidDetails = () => {};
const sent = [];
webpush.sendNotification = async (sub, body) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(body) }); };

const { notifyBetPlaced, notifyBetsWon } = require('./push');

// Minimal stand-in for the Supabase query builder over in-memory tables.
function fakeDb(tables) {
  const deleted = [];
  const from = (name) => {
    let rows = [...(tables[name] || [])];
    let op = 'select';
    const q = {
      select: () => q,
      delete: () => { op = 'delete'; return q; },
      eq: (k, v) => { rows = rows.filter(r => r[k] === v); return q; },
      in: (k, vs) => { rows = rows.filter(r => vs.includes(r[k])); if (op === 'delete') deleted.push(...rows); return q; },
      maybeSingle: async () => ({ data: rows[0] || null }),
      then: (res) => res({ data: rows, error: null }),
    };
    return q;
  };
  return { from, deleted };
}

const tables = {
  teams: [
    { id: 't1', team_name: 'Bush Gonna Win', captain_id: 'u1', competition_id: 'c1' },
    { id: 't2', team_name: 'Long Shots', captain_id: 'u3', competition_id: 'c1' },
    { id: 't3', team_name: 'Other Comp', captain_id: 'u5', competition_id: 'c2' },
  ],
  team_members: [
    { team_id: 't1', user_id: 'u1', role: 'captain' },
    { team_id: 't1', user_id: 'u2', role: 'member' },
    { team_id: 't1', user_id: 'u6', role: 'pending' },
    { team_id: 't2', user_id: 'u3', role: 'captain' },
    { team_id: 't2', user_id: 'u4', role: 'member' },
    { team_id: 't3', user_id: 'u5', role: 'captain' },
  ],
  users: [{ id: 'u2', first_name: 'Sam' }],
  push_subscriptions: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map(u => ({ id: `s-${u}`, user_id: u, endpoint: `https://push/${u}`, p256dh: 'k', auth: 'a' })),
  bets: [{
    id: 'b1', team_id: 't1', stake: 2000, estimated_return: 9000, overall_status: 'won',
    bet_legs: [{ status: 'won', odds: '3.00' }, { status: 'won', odds: '1.50' }],
    teams: { team_name: 'Bush Gonna Win', competition_id: 'c1' },
  }],
};

test('bet placed: teammates are told, not the person who bet or pending members', async () => {
  sent.length = 0;
  const n = await notifyBetPlaced(fakeDb(tables), { id: 'b9', team_id: 't1', submitted_by: 'u2', stake: 2000, bet_type: 'multi', combined_odds: 4.5 });
  assert.equal(n, 1);
  assert.deepEqual(sent.map(s => s.endpoint), ['https://push/u1']);
  assert.equal(sent[0].title, 'Sam placed a bet');
  assert.equal(sent[0].body, '$20 multi @ $4.50 for Bush Gonna Win');
});

test('bet won: whole competition is told, with "your team" wording for the winners', async () => {
  sent.length = 0;
  await notifyBetsWon(fakeDb(tables), ['b1']);
  const by = Object.fromEntries(sent.map(s => [s.endpoint.split('/').pop(), s]));
  assert.deepEqual(Object.keys(by).sort(), ['u1', 'u2', 'u3', 'u4']); // not u5 (other comp), not u6 (pending)
  assert.match(by.u1.title, /Your team/);
  assert.equal(by.u3.title, 'Bush Gonna Win just landed a winner');
  assert.equal(by.u3.body, 'Their bet returned $90');
});

test('no keys configured: nothing is sent and nothing throws', async () => {
  const saved = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  sent.length = 0;
  assert.equal(await notifyBetsWon(fakeDb(tables), ['b1']), 0);
  assert.equal(sent.length, 0);
  process.env.VAPID_PRIVATE_KEY = saved;
});
