// Tests for the rules shared by the app and the server (src/lib). Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { betStatus, betReturn, storedOverallStatus } = require('../../../src/lib/betMath.js');
const { weekAt, zonedToUtcMs, nextCutoff } = require('../../../src/lib/auTime.js');

test('betStatus: one lost leg busts the multi even while others are pending', () => {
  assert.equal(betStatus([{ status: 'lost' }, { status: 'pending' }]), 'lost');
  assert.equal(betStatus([{ status: 'won' }, { status: 'pending' }]), 'pending');
  assert.equal(betStatus([{ status: 'won' }, { status: 'in_progress' }]), 'in_progress');
  assert.equal(betStatus([{ status: 'won' }, { status: 'void' }]), 'won');
  assert.equal(betStatus([{ status: 'void' }, { status: 'void' }]), 'void');
  assert.equal(betStatus([], 'rejected'), 'rejected');
  assert.equal(storedOverallStatus([{ status: 'void' }]), 'partial');
});

test('betReturn: void legs reduce the odds; all-void refunds the stake; losses pay 0', () => {
  const legs = [{ status: 'won', odds: '2.00' }, { status: 'won', odds: '1.50' }, { status: 'void', odds: '3.00' }];
  // $50 stake × 2.00 × 1.50 = $150 (not the $450 estimated return)
  assert.deepEqual(betReturn({ stake: 5000, estimated_return: 45000, bet_legs: legs }).returnCents, 15000);
  assert.equal(betReturn({ stake: 5000, estimated_return: 45000, bet_legs: legs.map(l => ({ ...l, status: 'won' })) }).returnCents, 45000);
  assert.equal(betReturn({ stake: 5000, estimated_return: 45000, bet_legs: legs.map(l => ({ ...l, status: 'void' })) }).returnCents, 5000);
  assert.equal(betReturn({ stake: 5000, estimated_return: 45000, bet_legs: [{ status: 'lost' }, { status: 'won' }] }).returnCents, 0);
  // Missing winning-leg odds → fall back to dividing out the void leg's odds
  assert.equal(betReturn({ stake: 5000, estimated_return: 45000, bet_legs: [{ status: 'won' }, { status: 'void', odds: '3.00' }] }).returnCents, 15000);
});

test('weekAt: weeks roll over at Wednesday 12:00 midday Sydney time, across daylight saving', () => {
  const start = '2026-10-01'; // a Thursday; DST starts Sun 4 Oct 2026
  const at = (d, t) => zonedToUtcMs(d, t);
  assert.equal(weekAt(at('2026-10-07', '11:59'), start), 1);
  assert.equal(weekAt(at('2026-10-07', '12:00'), start), 2);
  assert.equal(weekAt(at('2026-10-14', '11:59'), start), 2);  // AEDT now — still exactly midday local
  assert.equal(weekAt(at('2026-10-14', '12:00'), start), 3);
  assert.equal(weekAt(at('2027-04-07', '12:30'), start), 28); // after DST ends (5 Apr 2027)
});

test('nextCutoff is the coming Wednesday midday', () => {
  const sun = new Date(zonedToUtcMs('2026-11-08', '10:00'));
  assert.equal(nextCutoff(sun).toISOString(), new Date(zonedToUtcMs('2026-11-11', '12:00')).toISOString());
  const wedAfter = new Date(zonedToUtcMs('2026-11-11', '12:00'));
  assert.equal(nextCutoff(wedAfter).toISOString(), new Date(zonedToUtcMs('2026-11-18', '12:00')).toISOString());
});
