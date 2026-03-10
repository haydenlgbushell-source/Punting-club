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
export const apiSignUp = (payload)              => call('auth', { action: 'signup', ...payload });
export const apiLogin  = (phone, password)      => call('auth', { action: 'login', phone, password });
export const apiResetPassword = (phone)         => call('auth', { action: 'reset_password', phone });

// ── COMPETITIONS ─────────────────────────────────────────────
export const apiGetActiveCompetitions = ()      => call('data', { action: 'get_active_competitions' });
export const apiGetAllCompetitions    = ()      => call('data', { action: 'get_all_competitions' });
export const apiCreateCompetition = (comp, adminRole) => call('data', { action: 'create_competition', ...comp, adminRole });
export const apiUpdateCompStatus = (id, status, adminRole) => call('data', { action: 'update_competition_status', id, status, adminRole });

// ── TEAMS ────────────────────────────────────────────────────
export const apiGetTeam       = (teamId)        => call('data', { action: 'get_team', teamId });
export const apiGetAllTeams   = ()              => call('data', { action: 'get_all_teams' });
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
export const apiUpdateBetLeg   = (legId, status, resultNote) => call('data', { action: 'update_bet_leg', legId, status, resultNote });
export const apiRejectBet      = (betId, reason, adminRole) => call('data', { action: 'reject_bet', betId, reason, adminRole });
export const apiCorrectBet     = (betId, field, value, adminRole) => call('data', { action: 'correct_bet', betId, field, value, adminRole });

// ── LEADERBOARD ──────────────────────────────────────────────
export const apiGetLeaderboard = (competitionId, currentWeek) => call('data', { action: 'get_leaderboard', competitionId, currentWeek });

// ── ADMIN ────────────────────────────────────────────────────
export const apiGetAllUsers  = ()                        => call('data', { action: 'get_all_users' });
export const apiUpdateKyc    = (userId, kycStatus, adminRole) => call('data', { action: 'update_kyc', userId, kycStatus, adminRole });
export const apiUpdateUser   = (userId, updates, adminRole)   => call('data', { action: 'update_user', userId, updates, adminRole });
export const apiGetAuditLog  = (limit)                   => call('data', { action: 'get_audit_log', limit });
export const apiAddAudit     = (adminRole, action, target, detail) => call('data', { action: 'add_audit', adminRole, action, target, detail });

// ── CLAUDE AI ────────────────────────────────────────────────
export const apiAnalyseBetSlip = (imageData, mediaType) => call('claude', {
  model: 'claude-sonnet-4-20250514',
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
  model: 'claude-sonnet-4-20250514',
  max_tokens: 500,
  messages: [{
    role: 'user',
    content: `Today: ${new Date().toLocaleDateString('en-AU', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}.\n\nBet legs:\n${legs.map(l => `Leg ${l.leg_number}: ${l.selection} — ${l.event} — ${l.market} @ ${l.odds} — status: ${l.status}`).join('\n')}\n\nFor each pending leg determine if concluded. Return ONLY JSON array:\n[{"legId":"uuid","legNumber":1,"status":"won|lost|void|pending","result":"brief note"}]\nOnly settle if confident. Return all legs.`,
  }],
});
