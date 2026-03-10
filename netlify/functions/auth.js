// netlify/functions/auth.js
// Handles all authentication via Supabase Admin SDK
// Using service_role key so it can bypass RLS

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') // service role — never expose this in browser
);

export default async (request) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });

  const { action, ...payload } = await request.json();

  try {
    switch (action) {

      // ── SIGNUP ──────────────────────────────────────────────
      case 'signup': {
        const { phone, password, firstName, lastName, email, dob, postcode, teamName, teamCode, buyInMode, competitionCode } = payload;
        const cleanPhone = phone.trim().replace(/\s+/g, '');
        const authEmail  = `${cleanPhone}@puntingclub.app`;

        // Check phone not already registered
        const { data: existing } = await supabase.from('users').select('id').eq('phone', cleanPhone).maybeSingle();
        if (existing) return new Response(JSON.stringify({ error: 'Mobile number already registered.' }), { status: 400, headers });

        // Create Supabase auth user
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: authEmail,
          password,
          email_confirm: true, // auto-confirm for phone-based auth
        });
        if (authError) return new Response(JSON.stringify({ error: authError.message }), { status: 400, headers });

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
        if (userError) return new Response(JSON.stringify({ error: userError.message }), { status: 400, headers });

        let team = null;

        if (teamName) {
          // CREATING a new team
          // Find competition
          let compId = null;
          if (competitionCode) {
            const { data: comp } = await supabase.from('competitions').select('id').eq('code', competitionCode).eq('status', 'active').maybeSingle();
            compId = comp?.id || null;
          }

          // Generate unique team code
          let teamCodeGen, attempts = 0;
          do {
            teamCodeGen = Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
            const { data: existing } = await supabase.from('teams').select('id').eq('team_code', teamCodeGen).maybeSingle();
            if (!existing) break;
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
          if (teamError) return new Response(JSON.stringify({ error: teamError.message }), { status: 400, headers });

          // Add captain as team member
          await supabase.from('team_members').insert({
            team_id:       newTeam.id,
            user_id:       user.id,
            role:          'captain',
            can_bet:       true,
            deposit_paid:  false,
            betting_order: 1,
          });

          // Update user role to captain
          await supabase.from('users').update({ role: 'captain' }).eq('id', user.id);
          user.role = 'captain';
          team = { ...newTeam, teamCode: teamCodeGen };

        } else if (teamCode) {
          // JOINING an existing team
          const { data: existingTeam } = await supabase.from('teams').select('*').eq('team_code', teamCode.toUpperCase()).maybeSingle();
          if (!existingTeam) return new Response(JSON.stringify({ error: 'Team code not found.' }), { status: 400, headers });

          // Add as pending member
          await supabase.from('team_members').insert({
            team_id:      existingTeam.id,
            user_id:      user.id,
            role:         'pending',
            can_bet:      false,
            deposit_paid: false,
          });
          team = existingTeam;
        }

        return new Response(JSON.stringify({ user, team }), { status: 200, headers });
      }

      // ── LOGIN ───────────────────────────────────────────────
      case 'login': {
        const { phone, password } = payload;
        const cleanPhone = phone.trim().replace(/\s+/g, '');
        const authEmail  = `${cleanPhone}@puntingclub.app`;

        const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
        if (error) return new Response(JSON.stringify({ error: 'Invalid mobile number or password.' }), { status: 401, headers });

        // Get full profile + teams
        const { data: user } = await supabase.from('users').select('*').eq('phone', cleanPhone).single();
        const { data: memberships } = await supabase
          .from('team_members')
          .select(`*, teams(*, competitions(*))`)
          .eq('user_id', user.id);

        return new Response(JSON.stringify({
          user,
          session: data.session,
          teams: memberships?.map(m => ({ ...m.teams, myRole: m.role, myCanBet: m.can_bet })) || [],
        }), { status: 200, headers });
      }

      // ── RESET PASSWORD ──────────────────────────────────────
      case 'reset_password': {
        const { phone } = payload;
        const cleanPhone = phone.trim().replace(/\s+/g, '');
        const authEmail  = `${cleanPhone}@puntingclub.app`;
        const { error } = await supabase.auth.admin.generateLink({ type: 'recovery', email: authEmail });
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers });
        return new Response(JSON.stringify({ success: true, message: 'Password reset link generated.' }), { status: 200, headers });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers });
    }
  } catch (err) {
    console.error('Auth function error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/auth' };
