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
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email:          authEmail,
        password,
        email_confirm:  true,
      });
      if (authError) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: authError.message }) };

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

        const { data: newTeam, error: teamError } = await supabase.from('teams').insert({
          team_code:      teamCodeGen,
          team_name:      teamName,
          captain_id:     user.id,
          competition_id: compId,
          buy_in_mode:    buyInMode || 'split',
          status:         'pending',
          finalised:      false,
        }).select().single();
        if (teamError) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: teamError.message }) };

        await supabase.from('team_members').insert({
          team_id:       newTeam.id,
          user_id:       user.id,
          role:          'captain',
          can_bet:       true,
          deposit_paid:  false,
          betting_order: 1,
        });
        await supabase.from('users').update({ role: 'captain' }).eq('id', user.id);

        // Increment competition team count
        if (compId) {
          await supabase.rpc('increment_competition_teams', { comp_id: compId }).catch(() => {
            // Fallback: manual increment if RPC not available
            supabase.from('competitions').select('teams_count').eq('id', compId).single().then(({ data: cd }) => {
              if (cd) supabase.from('competitions').update({ teams_count: (cd.teams_count || 0) + 1 }).eq('id', compId);
            });
          });
        }

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
      const { data: sessionData } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      }).catch(() => ({ data: null }));

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ user, team, session: sessionData?.session || null }) };
    }

    // ── LOGIN ────────────────────────────────────────────────────────────────
    if (action === 'login') {
      const { phone, password } = payload;
      const cleanPhone = normalisePhone(phone);
      const authEmail  = `${cleanPhone}@puntingclub.app`;

      const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
      if (error) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid mobile number or password.' }) };
      }

      const { data: user } = await supabase.from('users').select('*').eq('phone', cleanPhone).single();
      const { data: memberships } = await supabase
        .from('team_members')
        .select('*, teams(*, competitions(*))')
        .eq('user_id', user.id);

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({
        user,
        session: data.session,
        teams: (memberships || []).map(m => ({ ...m.teams, myRole: m.role, myCanBet: m.can_bet })),
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

    // ── ADMIN LOGIN ──────────────────────────────────────────────────────────
    if (action === 'admin_login') {
      const { adminId, adminPassword } = payload;
      if (!adminId || !adminPassword) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing credentials.' }) };
      }

      // Admin credentials are stored in environment variables:
      // ADMIN_<ID>_PASSWORD and ADMIN_<ID>_ROLE
      // e.g. ADMIN_ADMIN_PASSWORD, ADMIN_ADMIN_ROLE, ADMIN_ADMIN_NAME
      const idKey     = adminId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const envPass   = process.env[`ADMIN_${idKey}_PASSWORD`];
      const envRole   = process.env[`ADMIN_${idKey}_ROLE`];
      const envName   = process.env[`ADMIN_${idKey}_NAME`] || adminId;

      if (!envPass || !envRole || adminPassword !== envPass) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid admin credentials.' }) };
      }

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ role: envRole, name: envName, phone: adminId }) };
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    console.error('Auth function error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
