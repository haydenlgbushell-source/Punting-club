// netlify/functions/auth.js — Node.js (CommonJS)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Normalise Australian mobile numbers to 04XXXXXXXX format
const normalisePhone = (raw) => {
  const digits = (raw || '').replace(/\D/g, '');
  if (/^04\d{8}$/.test(digits)) return digits;
  if (/^614\d{8}$/.test(digits)) return '0' + digits.slice(2);
  if (/^4\d{8}$/.test(digits))  return '0' + digits;
  return digits; // return as-is if unrecognised — let DB constraint catch it
};

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Resolve a user's teams: checks team_members first, then falls back to captain_id lookup.
// This handles the case where the team_members insert failed during signup.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resolveUserTeams = async (userId) => {
  // First fetch team_members without join to avoid UUID cast errors from stale local_ IDs
  const { data: rawMemberships } = await supabase
    .from('team_members')
    .select('team_id, role, can_bet')
    .eq('user_id', userId);

  // Filter to valid UUIDs only, then fetch team details
  const validTeamIds = (rawMemberships || []).map(m => m.team_id).filter(id => UUID_RE.test(String(id || '')));
  const membershipMeta = {};
  (rawMemberships || []).forEach(m => { membershipMeta[m.team_id] = m; });

  let teamRows = [];
  if (validTeamIds.length > 0) {
    const { data } = await supabase
      .from('teams')
      .select('*, competitions(*)')
      .in('id', validTeamIds);
    teamRows = data || [];
  }

  // Reconstruct memberships with team data
  const memberships = teamRows.map(t => ({
    team_id: t.id,
    role: membershipMeta[t.id]?.role,
    can_bet: membershipMeta[t.id]?.can_bet,
    teams: t,
  }));

  const memberTeamIds = new Set(validTeamIds);

  // Fallback: find teams where user is captain but has no team_members record
  const { data: captainedTeams } = await supabase
    .from('teams')
    .select('*, competitions(*)')
    .eq('captain_id', userId)
    .neq('status', 'suspended');

  const missingMemberships = (captainedTeams || [])
    .filter(t => !memberTeamIds.has(t.id))
    .map(t => ({ teams: t, role: 'captain', can_bet: true }));

  // If user is captain of a team but has no team_members record, auto-insert it
  for (const m of missingMemberships) {
    console.log('Repairing missing team_members record for captain', userId, 'team', m.teams.id);
    const { error: repairErr } = await supabase.from('team_members').insert({
      team_id:      m.teams.id,
      user_id:      userId,
      role:         'captain',
      can_bet:      true,
      deposit_paid: false,
    });
    if (repairErr) console.error('Auto-repair insert failed:', repairErr.message);
  }

  const allMemberships = [
    ...(memberships || []).map(m => ({ ...m.teams, myRole: m.role, myCanBet: m.can_bet })),
    ...missingMemberships.map(m => ({ ...m.teams, myRole: 'captain', myCanBet: true })),
  ];
  return allMemberships;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: HEADERS, body: 'Method not allowed' };

  let action, payload;
  try {
    const body = JSON.parse(event.body || '{}');
    action  = body.action;
    payload = body;
  } catch(e) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  try {

    // ── SIGNUP ──────────────────────────────────────────────────────────────
    if (action === 'signup') {
      const { phone, password, firstName, lastName, email, dob, postcode, teamName, teamCode, buyInMode, competitionCode } = payload;
      const cleanPhone = normalisePhone(phone);
      if (!cleanPhone || cleanPhone.length < 10) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid mobile number. Please use format: 0412 345 678' }) };
      }
      // Always use phone-based email so login always works
      const authEmail = `${cleanPhone}@puntingclub.app`;

      // Check phone not already registered
      const { data: existing } = await supabase.from('users').select('id').eq('phone', cleanPhone).maybeSingle();
      if (existing) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Mobile number already registered.' }) };

      // Create Supabase auth user using phone-derived email (consistent with login)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email:    authEmail,
        password,
      });
      if (signUpError || !signUpData?.user) {
        const msg = signUpError?.message || 'Signup failed — no user returned';
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: msg }) };
      }
      const authData = { user: signUpData.user };

      // Insert user profile
      const { data: user, error: userError } = await supabase.from('users').insert({
        id:            authData.user.id,
        phone:         cleanPhone,
        first_name:    firstName,
        last_name:     lastName,
        email:         email || null,
        password_hash: 'supabase_auth',
        dob:           dob || null,
        postcode:      postcode || null,
        role:          'member',
        kyc_status:    'pending',
        active:        true,
      }).select().single();
      if (userError) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: userError.message }) };

      let team = null;

      if (teamName) {
        let compId = null;
        if (competitionCode) {
          const { data: comp } = await supabase.from('competitions').select('id').eq('code', competitionCode).eq('status', 'active').maybeSingle();
          compId = comp?.id || null;
        }
        let teamCodeGen, attempts = 0;
        do {
          teamCodeGen = Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
          const { data: ex } = await supabase.from('teams').select('id').eq('team_code', teamCodeGen).maybeSingle();
          if (!ex) break;
        } while (++attempts < 10);

        // Enforce team name uniqueness within competition (case-insensitive)
        const nameQuery = supabase.from('teams').select('id').ilike('team_name', teamName.trim());
        if (compId) nameQuery.eq('competition_id', compId);
        const { data: nameDup } = await nameQuery.maybeSingle();
        if (nameDup) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Team name "${teamName.trim()}" is already taken in this competition. Please choose a different name.` }) };

        const { data: newTeam, error: teamError } = await supabase.from('teams').insert({
          team_code:      teamCodeGen,
          team_name:      teamName.trim(),
          captain_id:     user.id,
          competition_id: compId,
          buy_in_mode:    buyInMode || 'split',
          status:         'pending',
          finalised:      false,
        }).select().single();
        if (teamError) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: teamError.message }) };

        await supabase.from('users').update({ role: 'captain' }).eq('id', user.id);

        // Insert captain into team_members — check result and retry without betting_order if needed
        const { error: memberErr } = await supabase.from('team_members').insert({
          team_id:       newTeam.id,
          user_id:       user.id,
          role:          'captain',
          can_bet:       true,
          deposit_paid:  false,
          betting_order: 1,
        });
        if (memberErr) {
          console.error('team_members insert (with betting_order) failed:', memberErr.message);
          // Retry without betting_order in case the column doesn't exist
          const { error: memberErr2 } = await supabase.from('team_members').insert({
            team_id:      newTeam.id,
            user_id:      user.id,
            role:         'captain',
            can_bet:      true,
            deposit_paid: false,
          });
          if (memberErr2) console.error('team_members insert (minimal) also failed:', memberErr2.message);
        }

        // Increment competition team count
        if (compId) {
          const { error: rpcErr } = await supabase.rpc('increment_competition_teams', { comp_id: compId });
          if (rpcErr) {
            // Fallback: manual increment if RPC not available
            const { data: cd } = await supabase.from('competitions').select('teams_count').eq('id', compId).maybeSingle();
            if (cd) await supabase.from('competitions').update({ teams_count: (cd.teams_count || 0) + 1 }).eq('id', compId);
          }
        }

        // Notify admin of new team signup
        await supabase.from('admin_notifications').insert({
          type:    'new_team',
          title:   `New team registered: ${teamName.trim()}`,
          message: `${firstName} ${lastName} created team "${teamName.trim()}"${competitionCode ? ` for competition ${competitionCode}` : ''}. Phone: ${cleanPhone}.`,
          data:    { teamId: newTeam.id, teamCode: teamCodeGen, teamName: teamName.trim(), competitionCode: competitionCode || null, captainName: `${firstName} ${lastName}`, captainPhone: cleanPhone },
        });

        team = { ...newTeam, teamCode: teamCodeGen, team_code: teamCodeGen };

      } else if (teamCode) {
        const { data: existingTeam } = await supabase.from('teams').select('*').eq('team_code', teamCode.toUpperCase()).maybeSingle();
        if (!existingTeam) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Team code not found.' }) };
        await supabase.from('team_members').insert({
          team_id:      existingTeam.id,
          user_id:      user.id,
          role:         'pending',
          can_bet:      false,
          deposit_paid: false,
        });
        team = existingTeam;
      }

      // Sign in to get a session token so frontend can persist the session
      let sessionData = null;
      try {
        const { data: sd, error: signInErr } = await supabase.auth.signInWithPassword({ email: authEmail, password });
        if (!signInErr) sessionData = sd;
      } catch(e) {}

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ user, team, session: sessionData?.session || null }) };
    }

    // ── LOGIN ────────────────────────────────────────────────────────────────
    if (action === 'login') {
      const { phone, password } = payload;
      const cleanPhone = normalisePhone(phone);
      const authEmail  = `${cleanPhone}@puntingclub.app`;

      // Step 1: Supabase auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: authEmail, password });
      if (authError) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid mobile number or password.' }) };
      if (!authData) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Auth returned null' }) };

      // Step 2: Fetch user profile
      const { data: user, error: userErr } = await supabase.from('users').select('*').eq('phone', cleanPhone).maybeSingle();
      if (userErr) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: userErr.message }) };
      if (!user) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'User profile not found. Please contact support.' }) };

      // Step 3: Resolve teams
      const teams = await resolveUserTeams(user.id);

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({
        user,
        session: authData.session,
        teams,
      })};
    }

    // ── RESET PASSWORD ───────────────────────────────────────────────────────
    if (action === 'reset_password') {
      const { phone } = payload;
      const cleanPhone = (phone || '').trim().replace(/\s+/g, '');
      const authEmail  = `${cleanPhone}@puntingclub.app`;
      const { error } = await supabase.auth.admin.generateLink({ type: 'recovery', email: authEmail });
      if (error) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };
    }

    // ── VERIFY SESSION ───────────────────────────────────────────────────────
    // Called on page refresh to re-fetch fresh user + team data from DB
    if (action === 'verify_session') {
      const { userId } = payload;
      if (!userId || String(userId).startsWith('local_')) {
        return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Invalid session' }) };
      }
      const { data: user, error: userErr } = await supabase
        .from('users').select('*').eq('id', userId).maybeSingle();
      if (userErr || !user) {
        return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'User not found' }) };
      }
      const teams = await resolveUserTeams(userId);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ user, teams })};
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    console.error('Auth function error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
