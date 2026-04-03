// ============================================================
//  src/api.js
//  Frontend API client — calls Netlify edge functions
//  Import this into App.jsx to replace all in-memory operations
// ============================================================

const call = async (endpoint, payload) => {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `API error ${res.status}`);
  return data;
};

// ── AUTH ─────────────────────────────────────────────────────
export const apiSignUp         = (payload)       => call('auth', { action: 'signup', ...payload });
export const apiLogin          = (phone, password) => call('auth', { action: 'login', phone, password });
export const apiResetPassword  = (phone)         => call('auth', { action: 'reset_password', phone });
export const apiVerifySession  = (userId)        => call('auth', { action: 'verify_session', userId });
export const apiAdminLogin     = (id, password)  => call('auth', { action: 'admin_login', id, password });
export const apiUpdateProfile  = (userId, updates) => call('auth', { action: 'update_profile', userId, ...updates });
export const apiChangePassword = (userId, newPassword) => call('auth', { action: 'change_password', userId, newPassword });

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

// ── TEAM MEMBERS ─────────────────────────────────────────────
export const apiGetTeamMembers    = (teamId)            => call('data', { action: 'get_team_members', teamId });
export const apiApproveMember     = (teamId, userId)    => call('data', { action: 'approve_member', teamId, userId });
export const apiRejectMember      = (teamId, userId)    => call('data', { action: 'reject_member', teamId, userId });
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
export const apiUpdateUser   = (userId, updates, adminToken)   => call('data', { action: 'update_user', userId, updates, adminToken });
export const apiDeleteUser   = (userId, adminToken)            => call('data', { action: 'delete_user', userId, adminToken });
export const apiGetAuditLog  = (limit, adminToken)       => call('data', { action: 'get_audit_log', limit, adminToken });
export const apiAddAudit     = (adminToken, action, target, detail) => call('data', { action: 'add_audit', adminToken, action, target, detail });
export const apiGetAdminNotifications    = (adminToken, unreadOnly = false) => call('data', { action: 'get_admin_notifications', adminToken, unreadOnly });
export const apiMarkNotificationRead    = (id, adminToken) => call('data', { action: 'mark_notification_read', id, adminToken });
export const apiMarkAllNotificationsRead = (adminToken)    => call('data', { action: 'mark_all_notifications_read', adminToken });

// ── CLAUDE AI ────────────────────────────────────────────────
export const apiAnalyseBetSlip = (imageData, mediaType) => call('claude', {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1200,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: `Analyse this bet slip image and return ONLY valid JSON:\n{"betType":"Multi","stake":"$50.00","combinedOdds":"3.50","estimatedReturn":"$175.00","submissionValid":true,"aiConfidence":95,"legs":[{"legNumber":1,"event":"Event","selection":"Selection","market":"Win","odds":"2.10","status":"pending"}]}\nRules: dollar signs on money, decimal odds, status in {pending,won,lost,void}, submissionValid=placed before first leg, aiConfidence=0-100. Return ONLY JSON.` },
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
    ],
  }],
});

export const apiCheckBetResults = (legs) => call('claude', {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 500,
  messages: [{
    role: 'user',
    content: `Today: ${new Date().toLocaleDateString('en-AU', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}.\n\nBet legs:\n${legs.map(l => `Leg ${l.leg_number}: ${l.selection} — ${l.event} — ${l.market} @ ${l.odds} — status: ${l.status}`).join('\n')}\n\nFor each pending leg determine if concluded. Return ONLY JSON array:\n[{"legId":"uuid","legNumber":1,"status":"won|lost|void|pending","result":"brief note"}]\nOnly settle if confident. Return all legs.`,
  }],
});
