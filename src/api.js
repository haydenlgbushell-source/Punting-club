// ============================================================
//  src/api.js
//  Frontend API client — calls Netlify edge functions
//  Import this into App.jsx to replace all in-memory operations
// ============================================================

const readSession = () => {
  try { return JSON.parse(localStorage.getItem('pc_session') || '{}'); }
  catch { return {}; }
};
const writeTokens = (access, refresh) => {
  try {
    const s = JSON.parse(localStorage.getItem('pc_session') || '{}');
    if (access) s.token = access;
    if (refresh) s.refreshToken = refresh;
    localStorage.setItem('pc_session', JSON.stringify(s));
  } catch { /* ignore */ }
};

// One refresh at a time: Supabase rotates refresh tokens, so two parallel
// refreshes with the same token would log the user out.
let refreshInFlight = null;
const refreshTokens = (refreshToken) => {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const rRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', refreshToken }),
      });
      if (!rRes.ok) return false;
      const rData = await rRes.json();
      if (!rData?.access_token) return false;
      writeTokens(rData.access_token, rData.refresh_token);
      return true;
    })().catch(() => false).finally(() => { setTimeout(() => { refreshInFlight = null; }, 0); });
  }
  return refreshInFlight;
};

// POST with the user's access token, refreshing it once on a 401.
// Returns the raw { res, data } so callers can handle non-standard error shapes.
export const postWithAuth = async (endpoint, payload, _retry = false) => {
  const sess = readSession();
  const headers = { 'Content-Type': 'application/json' };
  if (sess.token && sess.token !== 'ok') headers.Authorization = `Bearer ${sess.token}`;

  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  // If the access token has expired, transparently refresh once and retry.
  if (res.status === 401 && !_retry && sess.refreshToken) {
    if (await refreshTokens(sess.refreshToken)) return postWithAuth(endpoint, payload, true);
  }

  let data;
  try { data = await res.json(); }
  catch { data = { error: `Server error ${res.status}` }; }
  return { res, data };
};

const call = async (endpoint, payload) => {
  const { res, data } = await postWithAuth(endpoint, payload);
  if (!res.ok || data.error) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message;
    const err = new Error(msg || `API error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
};

// ── AUTH ─────────────────────────────────────────────────────
export const apiSignUp         = (payload)       => call('auth', { action: 'signup', ...payload });
export const apiLogin          = (phone, password) => call('auth', { action: 'login', phone, password });
export const apiResetPassword  = (phone)         => call('auth', { action: 'reset_password', phone });
export const apiVerifySession  = (userId)        => call('auth', { action: 'verify_session', userId });
export const apiAdminLogin     = (id, password)  => call('auth', { action: 'admin_login', id, password });
export const apiUpdateProfile  = (userId, updates) => call('auth', { action: 'update_profile', userId, ...updates });
export const apiChangePassword = (userId, currentPassword, newPassword) => call('auth', { action: 'change_password', userId, currentPassword, newPassword });

// ── COMPETITIONS ─────────────────────────────────────────────
export const apiGetActiveCompetitions   = ()      => call('data', { action: 'get_active_competitions' });
export const apiGetAllCompetitions      = (adminToken) => call('data', { action: 'get_all_competitions', adminToken });
export const apiCreateCompetition       = (comp, adminToken) => call('data', { action: 'create_competition', ...comp, adminToken });
export const apiUpdateCompStatus        = (id, status, adminToken) => call('data', { action: 'update_competition_status', id, status, adminToken });
export const apiDeleteCompetition       = (id, adminToken)         => call('data', { action: 'delete_competition', id, adminToken });
export const apiUpdateCompetition       = (id, fields, adminToken) => call('data', { action: 'update_competition', id, ...fields, adminToken });
export const apiAdvanceWeek             = (id, adminToken, direction = 'forward') => call('data', { action: 'advance_week', id, adminToken, direction });
export const apiRequestCompetition      = (payload) => call('data', { action: 'request_competition', ...payload });
export const apiGetCompetitionRequests  = (adminToken) => call('data', { action: 'get_competition_requests', adminToken });
export const apiUpdateCompetitionRequest = (id, status, adminToken) => call('data', { action: 'update_competition_request', id, status, adminToken });
export const apiGetCompetitionByCode    = (code) => call('data', { action: 'get_competition_by_code', code });

// ── TEAMS ────────────────────────────────────────────────────
export const apiGetTeam                = (teamId)                    => call('data', { action: 'get_team', teamId });
export const apiCreateAdditionalTeam   = (payload)                   => call('data', { action: 'create_additional_team', ...payload });
export const apiJoinExistingTeam       = (userId, teamCode)           => call('data', { action: 'join_existing_team', userId, teamCode });
export const apiGetAllTeams   = (adminToken)    => call('data', { action: 'get_all_teams', adminToken });
export const apiUpdateTeam    = (teamId, updates, adminToken) => call('data', { action: 'update_team', teamId, updates, adminToken });
export const apiDeleteTeam    = (teamId, adminToken)          => call('data', { action: 'delete_team', id: teamId, adminToken });
export const apiFinaliseTeam  = (teamId, depositPerMember) => call('data', { action: 'finalise_team', teamId, depositPerMember });
export const apiReopenTeam    = (teamId) => call('data', { action: 'finalise_team', teamId, reopen: true });

// ── TEAM MEMBERS ─────────────────────────────────────────────
export const apiGetTeamMembers    = (teamId)            => call('data', { action: 'get_team_members', teamId });
export const apiApproveMember     = (teamId, userId, adminToken)    => call('data', { action: 'approve_member', teamId, userId, adminToken });
export const apiRejectMember      = (teamId, userId, adminToken)    => call('data', { action: 'reject_member', teamId, userId, adminToken });
export const apiUpdateMember      = (teamId, userId, updates) => call('data', { action: 'update_member', teamId, userId, updates });
export const apiSaveBettingOrder  = (teamId, orderedUserIds) => call('data', { action: 'save_betting_order', teamId, orderedUserIds });

// ── BETS ─────────────────────────────────────────────────────
export const apiSubmitBet      = (payload)              => call('data', { action: 'submit_bet', ...payload });
export const apiGetTeamBets    = (teamId, weekNumber)   => call('data', { action: 'get_team_bets', teamId, weekNumber });
export const apiGetAllBets     = (weekNumber, adminToken) => call('data', { action: 'get_all_bets', weekNumber, adminToken });
export const apiUpdateBetResult = (betId, status, adminToken) => call('data', { action: 'update_bet_result', betId, overallStatus: status, adminToken });
export const apiUpdateBetLeg   = (legId, status, resultNote, adminToken) => call('data', { action: 'update_bet_leg', legId, status, resultNote, adminToken });
export const apiRejectBet      = (betId, reason, adminToken) => call('data', { action: 'reject_bet', betId, reason, adminToken });
export const apiCorrectBet     = (betId, field, value, adminToken) => call('data', { action: 'correct_bet', betId, field, value, adminToken });

// ── LEADERBOARD ──────────────────────────────────────────────
export const apiGetLeaderboard = (competitionId, currentWeek, startDate) => call('data', { action: 'get_leaderboard', competitionId, currentWeek, startDate });

// ── ADMIN ────────────────────────────────────────────────────
export const apiGetAllUsers  = (adminToken)              => call('data', { action: 'get_all_users', adminToken });
export const apiUpdateKyc    = (userId, kycStatus, adminToken) => call('data', { action: 'update_kyc', userId, kycStatus, adminToken });
export const apiAdminResetPassword = (userId, adminToken) => call('data', { action: 'admin_reset_password', userId, adminToken });
export const apiUpdateUser   = (userId, updates, adminToken)   => call('data', { action: 'update_user', userId, updates, adminToken });
export const apiDeleteUser   = (userId, adminToken)            => call('data', { action: 'delete_user', userId, adminToken });
export const apiGetAuditLog  = (limit, adminToken)       => call('data', { action: 'get_audit_log', limit, adminToken });
export const apiAddAudit     = (adminToken, action, target, detail) => call('data', { action: 'add_audit', adminToken, action, target, detail });
export const apiGetAdminNotifications    = (adminToken, unreadOnly = false) => call('data', { action: 'get_admin_notifications', adminToken, unreadOnly });
export const apiMarkNotificationRead    = (id, adminToken) => call('data', { action: 'mark_notification_read', id, adminToken });
export const apiMarkAllNotificationsRead = (adminToken)    => call('data', { action: 'mark_all_notifications_read', adminToken });

// ── WEEKLY RECAPS ───────────────────────────────────────────
export const apiGetWeeklyRecap  = (competitionId, weekNumber) => call('data', { action: 'get_weekly_recap', competitionId, weekNumber });
export const apiGetLatestRecap  = (competitionId) => call('data', { action: 'get_latest_recap', competitionId });
export const apiGetAllRecaps    = (competitionId) => call('data', { action: 'get_all_recaps', competitionId });
export const apiGenerateRecap   = (competitionId, weekNumber, adminToken) => call('data', { action: 'generate_recap', competitionId, weekNumber, adminToken });
export const apiTriggerResultsCheck = (adminToken, betId = null) => call('data', { action: 'trigger_results_check', adminToken, betId });
