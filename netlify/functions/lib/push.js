// netlify/functions/lib/push.js — phone/browser push notifications for members.
//
// Two events:
//   • a team member places a bet  → the rest of that team is told
//   • a bet wins                  → every member in that competition is told
//                                   (the winning team gets "your team won" wording)
//
// Uses standard Web Push (free; no third-party service). Needs three Netlify
// env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto:).
// Subscriptions live in the push_subscriptions table. If the keys or the table
// are missing, every function here quietly does nothing, so bets and results
// are never blocked by a notification problem.
'use strict';

const webpush = require('web-push');
const { betReturn } = require('../../../src/lib/betMath.js');

const configured = () =>
  !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let vapidSet = false;
const ensureVapid = () => {
  if (vapidSet) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@puntingclub.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  vapidSet = true;
};

const dollars = (cents) => {
  const d = (Number(cents) || 0) / 100;
  return `$${d % 1 === 0 ? d.toFixed(0) : d.toFixed(2)}`;
};

// Active members (not pending) of the given teams, plus captains.
// Returns [{ user_id, team_id }].
async function membersOf(supabase, teamIds) {
  if (!teamIds.length) return [];
  const [{ data: mems }, { data: teams }] = await Promise.all([
    supabase.from('team_members').select('user_id, team_id, role').in('team_id', teamIds),
    supabase.from('teams').select('id, captain_id').in('id', teamIds),
  ]);
  const out = new Map();
  for (const m of mems || []) {
    if (m.user_id && m.role !== 'pending') out.set(`${m.user_id}:${m.team_id}`, { user_id: m.user_id, team_id: m.team_id });
  }
  for (const t of teams || []) {
    if (t.captain_id) out.set(`${t.captain_id}:${t.id}`, { user_id: t.captain_id, team_id: t.id });
  }
  return [...out.values()];
}

// Send one payload to every device of the given users. Expired devices
// (404/410 from the push service) are removed. Returns the number sent.
async function sendToUsers(supabase, userIds, payload, log = console.log) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length || !configured()) return 0;
  const { data: subs, error } = await supabase
    .from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids);
  if (error) { log(`[push] subscriptions lookup failed: ${error.message}`); return 0; }
  if (!subs?.length) return 0;
  ensureVapid();
  const body = JSON.stringify(payload);
  const gone = [];
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 6 * 60 * 60, urgency: 'normal' },
      );
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.id);
      else log(`[push] send failed (${e.statusCode || '?'}): ${e.body || e.message}`);
    }
  }));
  if (gone.length) await supabase.from('push_subscriptions').delete().in('id', gone);
  return sent;
}

// Group users by team so each gets the wording for their own team.
async function sendPerUser(supabase, recipients, payloadFor, log) {
  const byPayload = new Map();
  for (const r of recipients) {
    const p = payloadFor(r);
    if (!p) continue;
    const key = JSON.stringify(p);
    if (!byPayload.has(key)) byPayload.set(key, { p, users: [] });
    byPayload.get(key).users.push(r.user_id);
  }
  let sent = 0;
  for (const { p, users } of byPayload.values()) sent += await sendToUsers(supabase, users, p, log);
  return sent;
}

// A member placed a bet: tell their teammates (not the person who placed it).
async function notifyBetPlaced(supabase, bet, { log = console.log } = {}) {
  try {
    if (!configured() || !bet?.team_id) return 0;
    const [{ data: team }, { data: who }] = await Promise.all([
      supabase.from('teams').select('team_name').eq('id', bet.team_id).maybeSingle(),
      bet.submitted_by
        ? supabase.from('users').select('first_name').eq('id', bet.submitted_by).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const name = who?.first_name || 'A teammate';
    const kind = bet.bet_type === 'single' ? 'single' : 'multi';
    const odds = bet.combined_odds ? ` @ $${Number(bet.combined_odds).toFixed(2)}` : '';
    const recipients = (await membersOf(supabase, [bet.team_id])).filter(r => r.user_id !== bet.submitted_by);
    return await sendToUsers(supabase, recipients.map(r => r.user_id), {
      title: `${name} placed a bet`,
      body: `${dollars(bet.stake)} ${kind}${odds} for ${team?.team_name || 'your team'}`,
      tag: `bet-placed-${bet.id}`,
      url: '/?nav=team',
    }, log);
  } catch (e) {
    log(`[push] notifyBetPlaced failed: ${e.message}`);
    return 0;
  }
}

// One or more bets just turned to "won": tell everyone in that competition.
async function notifyBetsWon(supabase, betIds, { log = console.log } = {}) {
  try {
    const ids = [...new Set((betIds || []).filter(Boolean))];
    if (!configured() || !ids.length) return 0;
    const { data: bets } = await supabase
      .from('bets')
      .select('id, team_id, stake, estimated_return, overall_status, bet_legs(status, odds), teams(team_name, competition_id)')
      .in('id', ids);
    let sent = 0;
    for (const bet of bets || []) {
      if (bet.overall_status !== 'won') continue;
      const compId = bet.teams?.competition_id;
      if (!compId) continue;
      const { data: compTeams } = await supabase.from('teams').select('id').eq('competition_id', compId);
      // One message per person: someone in two teams here gets the "your team" one.
      const byUser = new Map();
      for (const r of await membersOf(supabase, (compTeams || []).map(t => t.id))) {
        if (!byUser.has(r.user_id) || r.team_id === bet.team_id) byUser.set(r.user_id, r);
      }
      const recipients = [...byUser.values()];
      const won = dollars(betReturn(bet).returnCents);
      const teamName = bet.teams?.team_name || 'A team';
      sent += await sendPerUser(supabase, recipients, (r) => (
        r.team_id === bet.team_id
          ? { title: 'Your team’s bet won! 🏆', body: `${teamName} collected ${won}`, tag: `bet-won-${bet.id}`, url: '/?nav=team' }
          : { title: `${teamName} just landed a winner`, body: `Their bet returned ${won}`, tag: `bet-won-${bet.id}`, url: '/?nav=leaderboard' }
      ), log);
    }
    return sent;
  } catch (e) {
    log(`[push] notifyBetsWon failed: ${e.message}`);
    return 0;
  }
}

module.exports = { configured, notifyBetPlaced, notifyBetsWon, sendToUsers, membersOf };
