// netlify/functions/admin-assistant.js
// Admin AI assistant — fetches live Supabase data, sends to Claude with context
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { createHmac } = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(data) });
const err  = (msg, status = 400) => json({ error: msg }, status);

const verifyAdminToken = (token) => {
  if (!token) throw Object.assign(new Error('Admin token required'), { status: 401 });
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw Object.assign(new Error('Admin auth not configured'), { status: 500 });
  const dot = String(token).lastIndexOf('.');
  if (dot < 0) throw Object.assign(new Error('Invalid token format'), { status: 401 });
  const payloadB64 = String(token).slice(0, dot);
  const sig = String(token).slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payloadB64).digest('hex');
  if (sig !== expected) throw Object.assign(new Error('Invalid admin token'), { status: 401 });
  let claims;
  try { claims = JSON.parse(Buffer.from(payloadB64, 'base64').toString()); }
  catch { throw Object.assign(new Error('Invalid token payload'), { status: 401 }); }
  if (!claims.exp || Date.now() > claims.exp) throw Object.assign(new Error('Session expired'), { status: 401 });
  return claims;
};

const AEST = 10 * 60 * 60 * 1000;

const calcWeekFromTimestamp = (submittedAt, compStartDate) => {
  if (!submittedAt || !compStartDate) return null;
  const submittedAEST = new Date(submittedAt).getTime() + AEST;
  const startAEST = new Date(compStartDate).getTime() + AEST;
  let boundary = new Date(startAEST);
  boundary.setUTCHours(12, 0, 0, 0);
  const daysToWed = (3 - boundary.getUTCDay() + 7) % 7;
  boundary = new Date(boundary.getTime() + daysToWed * 86400000);
  if (boundary.getTime() <= startAEST) boundary = new Date(boundary.getTime() + 7 * 86400000);
  if (submittedAEST < boundary.getTime()) return 1;
  return Math.floor((submittedAEST - boundary.getTime()) / (7 * 86400000)) + 2;
};

const calcCurrentWeek = (startDate) => {
  if (!startDate) return 1;
  const now = new Date(Date.now() + AEST);
  const start = new Date(new Date(startDate).getTime() + AEST);
  let boundary = new Date(start);
  boundary.setUTCHours(12, 0, 0, 0);
  const daysToWed = (3 - boundary.getUTCDay() + 7) % 7;
  boundary = new Date(boundary.getTime() + daysToWed * 86400000);
  if (boundary.getTime() <= start.getTime()) boundary = new Date(boundary.getTime() + 7 * 86400000);
  if (now.getTime() < boundary.getTime()) return 1;
  return Math.floor((now.getTime() - boundary.getTime()) / (7 * 86400000)) + 2;
};

async function fetchDataSnapshot() {
  const [compsRes, teamsRes, betsRes, usersRes] = await Promise.all([
    supabase.from('competitions').select('*').order('created_at', { ascending: false }),
    supabase.from('teams').select('id, team_name, team_code, status, finalised, competition_id, captain_id, buy_in_mode, team_members(user_id, role, deposit_paid, can_bet, users(first_name, last_name))').order('created_at', { ascending: false }),
    supabase.from('bets').select('id, team_id, week_number, overall_status, stake, estimated_return, combined_odds, bet_type, submitted_at, submitted_by, flagged, rejection_reason, bet_legs(id, leg_number, event, selection, market, odds, status, result_note), teams(team_name, competition_id)').order('submitted_at', { ascending: false }).limit(500),
    supabase.from('users').select('id, first_name, last_name, phone, kyc_status, created_at').order('created_at', { ascending: false }),
  ]);

  const comps = compsRes.data || [];
  const teams = teamsRes.data || [];
  const bets = betsRes.data || [];
  const users = usersRes.data || [];

  const activeComps = comps.filter(c => c.status === 'active');

  const compSummaries = activeComps.map(c => {
    const currentWeek = calcCurrentWeek(c.start_date);
    const compTeams = teams.filter(t => t.competition_id === c.id);
    const compBets = bets.filter(b => b.teams?.competition_id === c.id);

    const currentWeekBets = compBets.filter(b => {
      const bw = c.start_date && b.submitted_at ? calcWeekFromTimestamp(b.submitted_at, c.start_date) : b.week_number;
      return bw === currentWeek;
    });

    const teamsSubmitted = new Set(currentWeekBets.map(b => b.team_id));
    const finalisedTeams = compTeams.filter(t => t.finalised);
    const teamsNotSubmitted = finalisedTeams.filter(t => !teamsSubmitted.has(t.id));

    const standings = compTeams.map(t => {
      const teamBets = compBets.filter(b => b.team_id === t.id);
      const wonBets = teamBets.filter(b => b.overall_status === 'won');
      const totalWon = wonBets.reduce((s, b) => s + (b.estimated_return || 0), 0);
      const totalBets = teamBets.length;
      const pendingBets = teamBets.filter(b => b.overall_status === 'pending').length;
      const memberCount = t.team_members?.length || 0;
      return {
        name: t.team_name,
        code: t.team_code,
        finalised: t.finalised,
        status: t.status,
        memberCount,
        totalBets,
        wonBets: wonBets.length,
        lostBets: teamBets.filter(b => b.overall_status === 'lost').length,
        pendingBets,
        totalWinnings: totalWon,
        totalWinningsFormatted: `$${(totalWon / 100).toFixed(2)}`,
      };
    }).sort((a, b) => b.totalWinnings - a.totalWinnings);

    return {
      name: c.name,
      venue: c.pub,
      code: c.code,
      status: c.status,
      weeks: c.weeks,
      currentWeek,
      buyIn: c.buy_in,
      buyInFormatted: `$${(c.buy_in / 100).toFixed(2)}`,
      maxTeams: c.max_teams,
      startDate: c.start_date,
      endDate: c.end_date,
      totalTeams: compTeams.length,
      finalisedTeams: finalisedTeams.length,
      teamsSubmittedThisWeek: teamsSubmitted.size,
      teamsNotSubmittedThisWeek: teamsNotSubmitted.map(t => t.team_name),
      totalBetsThisWeek: currentWeekBets.length,
      pendingBetsThisWeek: currentWeekBets.filter(b => b.overall_status === 'pending').length,
      flaggedBetsThisWeek: currentWeekBets.filter(b => b.flagged).length,
      standings,
    };
  });

  const recentBets = bets.slice(0, 30).map(b => ({
    id: b.id.slice(0, 8),
    team: b.teams?.team_name || 'Unknown',
    week: b.week_number,
    status: b.overall_status,
    stake: b.stake,
    stakeFormatted: b.stake ? `$${(b.stake / 100).toFixed(2)}` : null,
    odds: b.combined_odds,
    estimatedReturn: b.estimated_return ? `$${(b.estimated_return / 100).toFixed(2)}` : null,
    betType: b.bet_type,
    flagged: b.flagged,
    rejectionReason: b.rejection_reason,
    submittedAt: b.submitted_at,
    legs: (b.bet_legs || []).map(l => ({
      event: l.event,
      selection: l.selection,
      market: l.market,
      odds: l.odds,
      status: l.status,
      resultNote: l.result_note,
    })),
  }));

  const userStats = {
    total: users.length,
    verified: users.filter(u => u.kyc_status === 'verified').length,
    pending: users.filter(u => u.kyc_status === 'pending' || !u.kyc_status).length,
    rejected: users.filter(u => u.kyc_status === 'rejected').length,
  };

  const allComps = comps.map(c => ({ name: c.name, status: c.status, code: c.code, weeks: c.weeks }));

  return { activeCompetitions: compSummaries, allCompetitions: allComps, recentBets, userStats, totalTeams: teams.length };
}

const SYSTEM_PROMPT = `You are the Punting Club Admin Assistant — an AI helper for competition administrators. You have access to LIVE DATA from the platform and can answer questions about competitions, teams, bets, and users.

ABOUT PUNTING CLUB:
- Australian pub sports betting competition platform
- Teams compete across a season (8, 16, or 32 weeks)
- Each week, teams place multi-bets up to a weekly limit ($50 default)
- Bets are uploaded as screenshots, AI reads and tracks them
- Team with highest total winnings at season end wins the jackpot
- Week runs Wednesday 12:00 AM to Tuesday 11:59 PM AEST
- Money values in the data are stored in CENTS — always convert to dollars for display (divide by 100)

YOUR CAPABILITIES:
1. Answer questions about competition stats, standings, and progress
2. Identify teams that haven't submitted bets this week
3. Generate weekly standing reports and summaries
4. Draft notification/announcement messages for teams
5. Help with dispute resolution by analysing bet and result history
6. Provide insights on participation trends and engagement
7. Suggest actions for common admin scenarios

RESPONSE STYLE:
- Professional but friendly Australian English
- Use tables (markdown) for standings and stats when appropriate
- Be specific with numbers — always reference the actual data
- When drafting messages for teams, make them engaging and on-brand
- If data is insufficient to answer, say so clearly
- Format currency as AUD with $ sign (e.g. $50.00, not 5000 cents)

BOUNDARIES:
- Never reveal raw user IDs, passwords, or sensitive auth details
- Never modify data — you can only read and report
- For actions that change data (suspend teams, reject bets), recommend the admin do it manually via the admin panel
- If asked about something outside the platform, politely redirect`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err('ANTHROPIC_API_KEY not configured', 500);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err('Invalid JSON'); }

  const { adminToken, messages } = body;
  if (!adminToken) return err('Admin token required', 401);
  if (!Array.isArray(messages) || messages.length === 0) return err('Messages array required');

  try {
    verifyAdminToken(adminToken);
  } catch (e) {
    return err(e.message, e.status || 401);
  }

  try {
    const snapshot = await fetchDataSnapshot();

    const dataContext = `\n\n=== LIVE PLATFORM DATA (as of ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}) ===\n\n${JSON.stringify(snapshot, null, 2)}\n\n=== END DATA ===`;

    const enrichedMessages = messages.map((m, i) => {
      if (i === 0 && m.role === 'user') {
        return { ...m, content: m.content + dataContext };
      }
      return m;
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: enrichedMessages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return err(data.error?.message || 'Claude API error', response.status);
    }

    const reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return json({ reply });
  } catch (e) {
    console.error('Admin assistant error:', e);
    return err(e.message, 500);
  }
};
