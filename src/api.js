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

// ── COMPETITIONS ─────────────────────────────────────────────
export const apiGetActiveCompetitions   = ()      => call('data', { action: 'get_active_competitions' });
export const apiGetAllCompetitions      = (competitionId) => call('data', { action: 'get_all_competitions', ...(competitionId ? { competitionId } : {}) });
export const apiCreateCompetition       = (comp, adminRole) => call('data', { action: 'create_competition', ...comp, adminRole });
export const apiUpdateCompStatus        = (id, status, adminRole) => call('data', { action: 'update_competition_status', id, status, adminRole });
export const apiDeleteCompetition       = (id, adminRole)         => call('data', { action: 'delete_competition', id, adminRole });
export const apiUpdateCompetition       = (id, fields, adminRole) => call('data', { action: 'update_competition', id, ...fields, adminRole });
export const apiAdvanceWeek             = (id, adminRole, direction = 'forward') => call('data', { action: 'advance_week', id, adminRole, direction });
export const apiRequestCompetition      = (payload) => call('data', { action: 'request_competition', ...payload });
export const apiGetCompetitionRequests  = (adminRole) => call('data', { action: 'get_competition_requests', adminRole });
export const apiUpdateCompetitionRequest = (id, status, adminRole) => call('data', { action: 'update_competition_request', id, status, adminRole });
export const apiGetCompetitionByCode    = (code) => call('data', { action: 'get_competition_by_code', code });

// ── TEAMS ────────────────────────────────────────────────────
export const apiGetTeam                = (teamId)                    => call('data', { action: 'get_team', teamId });
export const apiCreateAdditionalTeam   = (payload)                   => call('data', { action: 'create_additional_team', ...payload });
export const apiJoinExistingTeam       = (userId, teamCode)           => call('data', { action: 'join_existing_team', userId, teamCode });
export const apiGetAllTeams   = (competitionId) => call('data', { action: 'get_all_teams', ...(competitionId ? { competitionId } : {}) });
export const apiUpdateTeam    = (teamId, updates, adminRole) => call('data', { action: 'update_team', teamId, updates, adminRole });
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
export const apiGetAllBets     = (weekNumber)           => call('data', { action: 'get_all_bets', weekNumber });
export const apiUpdateBetResult = (betId, status, adminRole) => call('data', { action: 'update_bet_result', betId, overallStatus: status, adminRole });
export const apiUpdateBetLeg   = (legId, status, resultNote, adminRole) => call('data', { action: 'update_bet_leg', legId, status, resultNote, adminRole });
export const apiRejectBet      = (betId, reason, adminRole) => call('data', { action: 'reject_bet', betId, reason, adminRole });
export const apiCorrectBet     = (betId, field, value, adminRole) => call('data', { action: 'correct_bet', betId, field, value, adminRole });

// ── LEADERBOARD ──────────────────────────────────────────────
export const apiGetLeaderboard = (competitionId, currentWeek, startDate) => call('data', { action: 'get_leaderboard', competitionId, currentWeek, startDate });

export const apiCheckPubAdminLogin = (username, password) => call('data', { action: 'check_pub_admin_login', username, password });

// ── ADMIN ────────────────────────────────────────────────────
export const apiGetAllUsers  = ()                        => call('data', { action: 'get_all_users' });
export const apiUpdateKyc    = (userId, kycStatus, adminRole) => call('data', { action: 'update_kyc', userId, kycStatus, adminRole });
export const apiUpdateUser   = (userId, updates, adminRole)   => call('data', { action: 'update_user', userId, updates, adminRole });
export const apiGetAuditLog  = (limit)                   => call('data', { action: 'get_audit_log', limit });
export const apiAddAudit     = (adminRole, action, target, detail) => call('data', { action: 'add_audit', adminRole, action, target, detail });
export const apiGetAdminNotifications    = (adminRole, unreadOnly = false) => call('data', { action: 'get_admin_notifications', adminRole, unreadOnly });
export const apiMarkNotificationRead    = (id, adminRole) => call('data', { action: 'mark_notification_read', id, adminRole });
export const apiMarkAllNotificationsRead = (adminRole)    => call('data', { action: 'mark_all_notifications_read', adminRole });

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
