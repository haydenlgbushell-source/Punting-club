// ============================================================
//  src/supabase.js
//  Supabase client + all database operations for Punting Club
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Helpers ──────────────────────────────────────────────────
const handleError = (error, context) => {
  console.error(`Supabase error [${context}]:`, error);
  throw new Error(error.message || `Database error in ${context}`);
};

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════

// Sign up — creates auth user then inserts profile row
export const signUp = async ({ phone, password, firstName, lastName, email, dob, postcode }) => {
  // Use phone as the email for Supabase Auth (adds @puntingclub.app suffix)
  const authEmail = `${phone.replace(/\s+/g, '')}@puntingclub.app`;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: authEmail,
    password,
    options: { data: { phone, first_name: firstName, last_name: lastName } },
  });
  if (authError) handleError(authError, 'signUp');

  // Insert profile into users table
  const { data, error } = await supabase.from('users').insert({
    id:            authData.user.id,
    phone:         phone.trim().replace(/\s+/g, ''),
    first_name:    firstName,
    last_name:     lastName,
    email:         email || null,
    password_hash: 'managed_by_supabase_auth',
    dob:           dob || null,
    postcode:      postcode || null,
    role:          'member',
    kyc_status:    'pending',
    active:        true,
  }).select().single();

  if (error) handleError(error, 'signUp:profile');
  return { user: data, session: authData.session };
};

// Login with phone number
export const signIn = async (phone, password) => {
  const authEmail = `${phone.trim().replace(/\s+/g, '')}@puntingclub.app`;
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
  if (error) handleError(error, 'signIn');

  // Fetch full profile
  const profile = await getUserByPhone(phone);
  return { session: data.session, user: profile };
};

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

// ════════════════════════════════════════════════════════════
//  USERS
// ════════════════════════════════════════════════════════════

export const getUserByPhone = async (phone) => {
  const key = phone.trim().replace(/\s+/g, '');
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', key)
    .single();
  if (error) handleError(error, 'getUserByPhone');
  return data;
};

export const getUserById = async (id) => {
  const { data, error } = await supabase
    .from('users').select('*').eq('id', id).single();
  if (error) handleError(error, 'getUserById');
  return data;
};

export const updateUser = async (id, updates) => {
  const { data, error } = await supabase
    .from('users').update(updates).eq('id', id).select().single();
  if (error) handleError(error, 'updateUser');
  return data;
};

export const getAllUsers = async () => {
  const { data, error } = await supabase
    .from('users').select('*').order('created_at', { ascending: false });
  if (error) handleError(error, 'getAllUsers');
  return data;
};

// ════════════════════════════════════════════════════════════
//  COMPETITIONS
// ════════════════════════════════════════════════════════════

export const getActiveCompetitions = async () => {
  const { data, error } = await supabase
    .from('competitions')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) handleError(error, 'getActiveCompetitions');
  return data;
};

export const getAllCompetitions = async () => {
  const { data, error } = await supabase
    .from('competitions').select('*').order('created_at', { ascending: false });
  if (error) handleError(error, 'getAllCompetitions');
  return data;
};

export const createCompetition = async (comp) => {
  const code = generateCode(6);
  const { data, error } = await supabase.from('competitions').insert({
    code,
    name:       comp.name,
    pub:        comp.pub,
    status:     comp.status || 'pending',
    weeks:      parseInt(comp.weeks) || 8,
    buy_in:     parseInt((comp.buyIn || '1000').replace(/[^0-9]/g, '')) || 1000,
    max_teams:  parseInt(comp.maxTeams) || 20,
    start_date: comp.startDate || null,
    end_date:   comp.endDate   || null,
    jackpot:    0,
  }).select().single();
  if (error) handleError(error, 'createCompetition');
  return data;
};

export const updateCompetitionStatus = async (id, status) => {
  const { data, error } = await supabase
    .from('competitions').update({ status }).eq('id', id).select().single();
  if (error) handleError(error, 'updateCompetitionStatus');
  return data;
};

// ════════════════════════════════════════════════════════════
//  TEAMS
// ════════════════════════════════════════════════════════════

export const createTeam = async ({ teamName, captainId, competitionId, buyInMode }) => {
  const teamCode = generateCode(6);
  const { data, error } = await supabase.from('teams').insert({
    team_code:      teamCode,
    team_name:      teamName,
    captain_id:     captainId,
    competition_id: competitionId || null,
    buy_in_mode:    buyInMode || 'split',
    status:         'pending',
    finalised:      false,
  }).select().single();
  if (error) handleError(error, 'createTeam');

  // Add captain as first team member
  await addTeamMember({ teamId: data.id, userId: captainId, role: 'captain', canBet: true, depositPaid: false, bettingOrder: 1 });
  return data;
};

export const getTeamByCode = async (code) => {
  const { data, error } = await supabase
    .from('teams')
    .select(`*, competitions(*), team_members(*, users(*))`)
    .eq('team_code', code.toUpperCase())
    .single();
  if (error) handleError(error, 'getTeamByCode');
  return data;
};

export const getTeamById = async (id) => {
  const { data, error } = await supabase
    .from('teams')
    .select(`*, competitions(*), team_members(*, users(*))`)
    .eq('id', id)
    .single();
  if (error) handleError(error, 'getTeamById');
  return data;
};

export const getUserTeams = async (userId) => {
  const { data, error } = await supabase
    .from('team_members')
    .select(`*, teams(*, competitions(*))`)
    .eq('user_id', userId);
  if (error) handleError(error, 'getUserTeams');
  return data.map(tm => ({ ...tm.teams, myRole: tm.role, myCanBet: tm.can_bet }));
};

export const getAllTeams = async () => {
  const { data, error } = await supabase
    .from('teams')
    .select(`*, competitions(*), team_members(count)`)
    .order('created_at', { ascending: false });
  if (error) handleError(error, 'getAllTeams');
  return data;
};

export const updateTeam = async (id, updates) => {
  const { data, error } = await supabase
    .from('teams').update(updates).eq('id', id).select().single();
  if (error) handleError(error, 'updateTeam');
  return data;
};

export const finaliseTeam = async (teamId, depositPerMember) => {
  const { data, error } = await supabase
    .from('teams')
    .update({ finalised: true, deposit_per_member: depositPerMember })
    .eq('id', teamId).select().single();
  if (error) handleError(error, 'finaliseTeam');
  return data;
};

// ════════════════════════════════════════════════════════════
//  TEAM MEMBERS
// ════════════════════════════════════════════════════════════

export const addTeamMember = async ({ teamId, userId, role = 'pending', canBet = false, depositPaid = false, bettingOrder = null }) => {
  const { data, error } = await supabase.from('team_members').insert({
    team_id:       teamId,
    user_id:       userId,
    role,
    can_bet:       canBet,
    deposit_paid:  depositPaid,
    betting_order: bettingOrder,
  }).select().single();
  if (error) handleError(error, 'addTeamMember');
  return data;
};

export const getTeamMembers = async (teamId) => {
  const { data, error } = await supabase
    .from('team_members')
    .select(`*, users(id, first_name, last_name, phone, kyc_status)`)
    .eq('team_id', teamId)
    .order('betting_order', { ascending: true });
  if (error) handleError(error, 'getTeamMembers');
  return data;
};

export const getPendingMembers = async (teamId) => {
  const { data, error } = await supabase
    .from('team_members')
    .select(`*, users(id, first_name, last_name, phone)`)
    .eq('team_id', teamId)
    .eq('role', 'pending');
  if (error) handleError(error, 'getPendingMembers');
  return data;
};

export const approveMember = async (teamId, userId) => {
  const { data, error } = await supabase
    .from('team_members')
    .update({ role: 'member', can_bet: false })
    .eq('team_id', teamId).eq('user_id', userId).select().single();
  if (error) handleError(error, 'approveMember');
  return data;
};

export const rejectMember = async (teamId, userId) => {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId).eq('user_id', userId);
  if (error) handleError(error, 'rejectMember');
};

export const updateMemberRole = async (teamId, userId, role) => {
  const canBet = role !== 'view-only';
  const { data, error } = await supabase
    .from('team_members')
    .update({ role, can_bet: canBet })
    .eq('team_id', teamId).eq('user_id', userId).select().single();
  if (error) handleError(error, 'updateMemberRole');
  return data;
};

export const updateDepositPaid = async (teamId, userId, depositPaid) => {
  const { data, error } = await supabase
    .from('team_members')
    .update({ deposit_paid: depositPaid })
    .eq('team_id', teamId).eq('user_id', userId).select().single();
  if (error) handleError(error, 'updateDepositPaid');
  return data;
};

export const saveBettingOrder = async (teamId, orderedUserIds) => {
  // Delete existing order then re-insert
  await supabase.from('betting_order').delete().eq('team_id', teamId);
  const rows = orderedUserIds.map((userId, i) => ({ team_id: teamId, user_id: userId, position: i + 1 }));
  const { error } = await supabase.from('betting_order').insert(rows);
  if (error) handleError(error, 'saveBettingOrder');
};

// ════════════════════════════════════════════════════════════
//  BETS
// ════════════════════════════════════════════════════════════

export const submitBet = async ({ teamId, weekNumber, betType, stake, combinedOdds, estimatedReturn, submissionValid, aiConfidence, legs, submittedBy }) => {
  // Insert bet
  const { data: bet, error: betError } = await supabase.from('bets').insert({
    team_id:          teamId,
    week_number:      weekNumber,
    bet_type:         betType,
    stake:            Math.round(parseFloat(String(stake).replace(/[^0-9.]/g, '')) * 100),
    combined_odds:    parseFloat(combinedOdds) || null,
    estimated_return: Math.round(parseFloat(String(estimatedReturn).replace(/[^0-9.]/g, '')) * 100),
    overall_status:   'pending',
    submission_valid: submissionValid,
    ai_confidence:    aiConfidence || null,
    submitted_by:     submittedBy,
  }).select().single();
  if (betError) handleError(betError, 'submitBet');

  // Insert legs
  if (legs?.length) {
    const legRows = legs.map(leg => ({
      bet_id:     bet.id,
      leg_number: leg.legNumber,
      event:      leg.event,
      selection:  leg.selection,
      market:     leg.market,
      odds:       parseFloat(leg.odds) || null,
      status:     leg.status || 'pending',
    }));
    const { error: legsError } = await supabase.from('bet_legs').insert(legRows);
    if (legsError) handleError(legsError, 'submitBet:legs');
  }

  return bet;
};

export const getTeamBets = async (teamId, weekNumber = null) => {
  let query = supabase
    .from('bets')
    .select(`*, bet_legs(*)`)
    .eq('team_id', teamId)
    .order('submitted_at', { ascending: false });
  if (weekNumber) query = query.eq('week_number', weekNumber);
  const { data, error } = await query;
  if (error) handleError(error, 'getTeamBets');
  return data;
};

export const getAllBets = async (weekNumber = null) => {
  let query = supabase
    .from('bets')
    .select(`*, bet_legs(*), teams(team_name)`)
    .order('submitted_at', { ascending: false });
  if (weekNumber) query = query.eq('week_number', weekNumber);
  const { data, error } = await query;
  if (error) handleError(error, 'getAllBets');
  return data;
};

export const updateBetResult = async (betId, overallStatus) => {
  const { data, error } = await supabase
    .from('bets').update({ overall_status: overallStatus }).eq('id', betId).select().single();
  if (error) handleError(error, 'updateBetResult');
  return data;
};

export const updateBetLegResult = async (legId, status, resultNote) => {
  const { data, error } = await supabase
    .from('bet_legs')
    .update({ status, result_note: resultNote, updated_at: new Date().toISOString() })
    .eq('id', legId).select().single();
  if (error) handleError(error, 'updateBetLegResult');
  return data;
};

export const rejectBet = async (betId, reason) => {
  const { data, error } = await supabase
    .from('bets')
    .update({ overall_status: 'rejected', rejection_reason: reason })
    .eq('id', betId).select().single();
  if (error) handleError(error, 'rejectBet');
  return data;
};

export const getPendingBets = async () => {
  const { data, error } = await supabase
    .from('bets')
    .select(`*, bet_legs(*), teams(team_name)`)
    .eq('overall_status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) handleError(error, 'getPendingBets');
  return data;
};

// ════════════════════════════════════════════════════════════
//  LEADERBOARD
// ════════════════════════════════════════════════════════════

export const getLeaderboard = async (competitionId) => {
  // Get all teams in competition with their total winnings
  const { data, error } = await supabase
    .from('teams')
    .select(`
      id, team_name, team_code, status, finalised,
      team_members(count),
      bets(id, overall_status, stake, estimated_return, week_number, bet_type, combined_odds, bet_legs(*))
    `)
    .eq('competition_id', competitionId)
    .eq('status', 'verified');
  if (error) handleError(error, 'getLeaderboard');

  // Calculate total winnings per team and sort
  return data
    .map(team => {
      const wonBets = (team.bets || []).filter(b => b.overall_status === 'won');
      const totalWon = wonBets.reduce((sum, b) => sum + (b.estimated_return || 0), 0);
      const currentWeekBet = (team.bets || []).find(b => b.week_number === getCurrentWeek());
      return {
        ...team,
        totalWon,
        totalWonFormatted: `$${(totalWon / 100).toLocaleString()}`,
        memberCount: team.team_members?.[0]?.count || 0,
        currentWeekBet,
      };
    })
    .sort((a, b) => b.totalWon - a.totalWon)
    .map((team, i) => ({ ...team, rank: i + 1 }));
};

// ════════════════════════════════════════════════════════════
//  AUDIT LOG
// ════════════════════════════════════════════════════════════

export const addAuditEntry = async (adminRole, action, target, detail = '') => {
  const { error } = await supabase.from('audit_log').insert({
    admin_role: adminRole, action, target, detail,
  });
  if (error) console.error('Audit log error:', error);
};

export const getAuditLog = async (limit = 100) => {
  const { data, error } = await supabase
    .from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) handleError(error, 'getAuditLog');
  return data;
};

// ════════════════════════════════════════════════════════════
//  REAL-TIME SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════

// Subscribe to bet leg updates for live leaderboard
export const subscribeToLeaderboard = (competitionId, callback) => {
  return supabase
    .channel(`leaderboard:${competitionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, callback)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_legs' }, callback)
    .subscribe();
};

// Subscribe to pending member requests (captain dashboard)
export const subscribeToPendingMembers = (teamId, callback) => {
  return supabase
    .channel(`team_members:${teamId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_members', filter: `team_id=eq.${teamId}` }, callback)
    .subscribe();
};

export const unsubscribe = (channel) => supabase.removeChannel(channel);

// ════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════

export const generateCode = (len = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export const getCurrentWeek = () => {
  // Week 1 starts from competition start date — simplified to calendar week for now
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  return Math.ceil(((new Date() - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
};

export const formatMoney = (cents) => `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
