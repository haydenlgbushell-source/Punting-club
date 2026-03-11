// netlify/functions/data.js
// All data operations — teams, bets, leaderboard, admin
// Uses service_role key to bypass RLS on admin operations

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json  = (data, status = 200) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(data) });
const error = (msg, status = 400)  => json({ error: msg }, status);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return error('Method not allowed', 405);

  let action, payload;
  try { const b = JSON.parse(event.body || '{}'); action = b.action; payload = b; }
  catch(e) { return error('Invalid JSON'); }

  try {
    switch (action) {

      // ══════════════════════════════════════════════════════
      //  COMPETITIONS
      // ══════════════════════════════════════════════════════

      case 'get_active_competitions': {
        const { data, error: e } = await supabase
          .from('competitions')
          .select('*, teams(id, team_name, team_code, status)')
          .eq('status', 'active')
          .order('created_at', { ascending: false });
        if (e) return error(e.message);
        // Add live team count to each competition
        const enriched = (data || []).map(c => ({ ...c, team_count: c.teams?.length || 0 }));
        return json(enriched);
      }

      case 'get_all_competitions': {
        const { data, error: e } = await supabase
          .from('competitions')
          .select('*, teams(id, team_name, team_code, status, captain_id, users!teams_captain_id_fkey(first_name, last_name))')
          .order('created_at', { ascending: false });
        if (e) return error(e.message);
        const enriched = (data || []).map(c => ({ ...c, team_count: c.teams?.length || 0 }));
        return json(enriched);
      }

      case 'create_competition': {
        const { name, pub, weeks, buyIn, maxTeams, startDate, endDate, adminRole } = payload;
        const status = adminRole === 'owner' ? 'active' : 'pending';
        const code   = genCode(6);
        const { data, error: e } = await supabase.from('competitions').insert({
          code, name, pub, status,
          weeks:     parseInt(weeks) || 8,
          buy_in:    parseInt(String(buyIn).replace(/[^0-9]/g, '')) || 1000,
          max_teams: parseInt(maxTeams) || 20,
          start_date: startDate || null,
          end_date:   endDate   || null,
          jackpot:   0,
        }).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, 'Competition Created', name, `Code: ${code}`);
        return json(data);
      }

      case 'update_competition_status': {
        const { id, status, adminRole } = payload;
        const { data, error: e } = await supabase.from('competitions').update({ status }).eq('id', id).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, `Competition ${status}`, data.name, '');
        return json(data);
      }

      // ══════════════════════════════════════════════════════
      //  TEAMS
      // ══════════════════════════════════════════════════════

      case 'get_team': {
        const { teamId } = payload;
        const { data, error: e } = await supabase
          .from('teams')
          .select(`*, competitions(*), team_members(*, users(id, first_name, last_name, phone, kyc_status))`)
          .eq('id', teamId).single();
        if (e) return error(e.message);
        return json(data);
      }

      case 'get_all_teams': {
        // Get teams with competition info
        const { data: teams, error: e1 } = await supabase
          .from('teams')
          .select('*, competitions(id, name, code)')
          .order('created_at', { ascending: false });
        if (e1) return error(e1.message);
        if (!teams || teams.length === 0) return json([]);

        // Get captain names separately to avoid FK alias issues
        const captainIds = [...new Set(teams.map(t => t.captain_id).filter(Boolean))];
        const { data: captains } = await supabase
          .from('users')
          .select('id, first_name, last_name, phone')
          .in('id', captainIds);
        const captainMap = {};
        (captains || []).forEach(u => { captainMap[u.id] = u; });

        // Get all team members with user info
        const teamIds = teams.map(t => t.id);
        const { data: members } = await supabase
          .from('team_members')
          .select('*, users(id, first_name, last_name, phone, kyc_status)')
          .in('team_id', teamIds);
        const membersByTeam = {};
        (members || []).forEach(m => {
          if (!membersByTeam[m.team_id]) membersByTeam[m.team_id] = [];
          membersByTeam[m.team_id].push(m);
        });

        const result = teams.map(t => ({
          ...t,
          users: captainMap[t.captain_id] || null,
          team_members: membersByTeam[t.id] || [],
        }));
        return json(result);
      }

      case 'update_team': {
        const { teamId, updates, adminRole } = payload;
        const { data, error: e } = await supabase.from('teams').update(updates).eq('id', teamId).select().single();
        if (e) return error(e.message);
        if (adminRole) await addAudit(adminRole, 'Team Updated', data.team_name, JSON.stringify(updates));
        return json(data);
      }

      case 'finalise_team': {
        const { teamId, depositPerMember } = payload;
        const { data, error: e } = await supabase
          .from('teams')
          .update({ finalised: true, deposit_per_member: depositPerMember })
          .eq('id', teamId).select().single();
        if (e) return error(e.message);
        return json(data);
      }

      // ══════════════════════════════════════════════════════
      //  TEAM MEMBERS
      // ══════════════════════════════════════════════════════

      case 'get_team_members': {
        const { teamId } = payload;
        const { data, error: e } = await supabase
          .from('team_members')
          .select(`*, users(id, first_name, last_name, phone, kyc_status)`)
          .eq('team_id', teamId)
          .order('betting_order', { ascending: true, nullsFirst: false });
        if (e) return error(e.message);
        return json(data);
      }

      case 'approve_member': {
        const { teamId, userId } = payload;
        const { data, error: e } = await supabase
          .from('team_members')
          .update({ role: 'member', can_bet: true })
          .eq('team_id', teamId).eq('user_id', userId).select().single();
        if (e) return error(e.message);
        return json(data);
      }

      case 'reject_member': {
        const { teamId, userId } = payload;
        const { error: e } = await supabase
          .from('team_members').delete()
          .eq('team_id', teamId).eq('user_id', userId);
        if (e) return error(e.message);
        return json({ success: true });
      }

      case 'update_member': {
        const { teamId, userId, updates } = payload;
        const { data, error: e } = await supabase
          .from('team_members').update(updates)
          .eq('team_id', teamId).eq('user_id', userId).select().single();
        if (e) return error(e.message);
        return json(data);
      }

      case 'save_betting_order': {
        const { teamId, orderedUserIds } = payload;
        await supabase.from('betting_order').delete().eq('team_id', teamId);
        const rows = orderedUserIds.map((userId, i) => ({ team_id: teamId, user_id: userId, position: i + 1 }));
        const { error: e } = await supabase.from('betting_order').insert(rows);
        if (e) return error(e.message);
        return json({ success: true });
      }

      // ══════════════════════════════════════════════════════
      //  BETS
      // ══════════════════════════════════════════════════════

      case 'submit_bet': {
        const { teamId, weekNumber, betType, stake, combinedOdds, estimatedReturn, submissionValid, aiConfidence, legs, submittedBy } = payload;

        const { data: bet, error: betError } = await supabase.from('bets').insert({
          team_id:          teamId,
          week_number:      weekNumber,
          bet_type:         betType,
          stake:            Math.round(parseFloat(String(stake).replace(/[^0-9.]/g, ''))),
          combined_odds:    parseFloat(combinedOdds) || null,
          estimated_return: Math.round(parseFloat(String(estimatedReturn).replace(/[^0-9.]/g, ''))),
          overall_status:   'pending',
          submission_valid: submissionValid !== false,
          ai_confidence:    aiConfidence || null,
          submitted_by:     submittedBy || null,
          flagged:          !submissionValid,
        }).select().single();
        if (betError) return error(betError.message);

        if (legs?.length) {
          const legRows = legs.map(leg => ({
            bet_id:     bet.id,
            leg_number: leg.legNumber,
            event:      leg.event,
            selection:  leg.selection,
            market:     leg.market,
            odds:       parseFloat(leg.odds) || null,
            status:     'pending',
          }));
          const { error: legsError } = await supabase.from('bet_legs').insert(legRows);
          if (legsError) return error(legsError.message);
        }

        return json(bet);
      }

      case 'get_team_bets': {
        const { teamId, weekNumber } = payload;
        let query = supabase.from('bets').select(`*, bet_legs(*)`).eq('team_id', teamId).order('submitted_at', { ascending: false });
        if (weekNumber) query = query.eq('week_number', weekNumber);
        const { data, error: e } = await query;
        if (e) return error(e.message);
        return json(data);
      }

      case 'get_all_bets': {
        const { weekNumber } = payload;
        let query = supabase.from('bets').select(`*, bet_legs(*), teams(team_name)`).order('submitted_at', { ascending: false });
        if (weekNumber) query = query.eq('week_number', weekNumber);
        const { data, error: e } = await query;
        if (e) return error(e.message);
        return json(data);
      }

      case 'update_bet_result': {
        const { betId, overallStatus, adminRole } = payload;
        const { data, error: e } = await supabase.from('bets').update({ overall_status: overallStatus }).eq('id', betId).select('*, teams(team_name)').single();
        if (e) return error(e.message);
        await addAudit(adminRole, `Bet ${overallStatus}`, `${data.teams?.team_name} — ${betId}`, `Result set to ${overallStatus}`);
        return json(data);
      }

      case 'update_bet_leg': {
        const { legId, status, resultNote } = payload;
        const { data, error: e } = await supabase.from('bet_legs').update({ status, result_note: resultNote, updated_at: new Date().toISOString() }).eq('id', legId).select().single();
        if (e) return error(e.message);
        return json(data);
      }

      case 'reject_bet': {
        const { betId, reason, adminRole } = payload;
        const { data, error: e } = await supabase.from('bets').update({ overall_status: 'rejected', rejection_reason: reason }).eq('id', betId).select('*, teams(team_name)').single();
        if (e) return error(e.message);
        await addAudit(adminRole, 'Bet Rejected', `${data.teams?.team_name}`, reason);
        return json(data);
      }

      case 'correct_bet': {
        const { betId, field, value, adminRole } = payload;
        const allowed = ['stake', 'combined_odds', 'estimated_return', 'bet_type'];
        if (!allowed.includes(field)) return error(`Field ${field} cannot be edited`);
        const update = { [field]: field === 'stake' || field === 'estimated_return' ? Math.round(parseFloat(String(value).replace(/[^0-9.]/g,'')) * 100) : value };
        const { data, error: e } = await supabase.from('bets').update({ ...update, flagged: false }).eq('id', betId).select('*, teams(team_name)').single();
        if (e) return error(e.message);
        await addAudit(adminRole, 'Bet Corrected', `${data.teams?.team_name} — ${betId}`, `${field} → ${value}`);
        return json(data);
      }

      // ══════════════════════════════════════════════════════
      //  LEADERBOARD
      // ══════════════════════════════════════════════════════

      case 'get_leaderboard': {
        const { competitionId } = payload;
        const { data, error: e } = await supabase
          .from('teams')
          .select(`id, team_name, team_code, status, finalised, team_members(count), bets(id, overall_status, stake, estimated_return, week_number, bet_type, combined_odds, flagged, submitted_at, bet_legs(*))`)
          .eq('competition_id', competitionId)
          .neq('status', 'suspended');
        if (e) return error(e.message);

        const currentWeek = payload.currentWeek || 1;
        const ranked = data
          .map(team => {
            const wonBets  = (team.bets || []).filter(b => b.overall_status === 'won');
            const totalWon = wonBets.reduce((sum, b) => sum + (b.estimated_return || 0), 0);
            const weekBet  = (team.bets || []).find(b => b.week_number === currentWeek);
            const weekHistory = Array.from({ length: currentWeek - 1 }, (_, i) => {
              const wb = (team.bets || []).find(b => b.week_number === i + 1);
              return wb?.overall_status === 'won' ? 'W' : wb?.overall_status === 'lost' ? 'L' : wb?.overall_status === 'partial' ? 'P' : '–';
            });
            return { ...team, totalWon, totalWonFormatted: `$${(totalWon / 100).toLocaleString()}`, memberCount: team.team_members?.[0]?.count || 0, currentWeekBet: weekBet || null, weekHistory };
          })
          .sort((a, b) => b.totalWon - a.totalWon)
          .map((team, i) => ({ ...team, rank: i + 1 }));
        return json(ranked);
      }

      // ══════════════════════════════════════════════════════
      //  ADMIN — USERS / KYC
      // ══════════════════════════════════════════════════════

      case 'get_all_users': {
        const { data: users, error: e } = await supabase
          .from('users')
          .select('*')
          .order('created_at', { ascending: false });
        if (e) return error(e.message);
        if (!users || users.length === 0) return json([]);

        // Get team memberships separately
        const userIds = users.map(u => u.id);
        const { data: memberships } = await supabase
          .from('team_members')
          .select('user_id, role, deposit_paid, can_bet, teams(id, team_name, team_code)')
          .in('user_id', userIds);
        const membershipMap = {};
        (memberships || []).forEach(m => { membershipMap[m.user_id] = m; });

        const result = users.map(u => ({
          ...u,
          team_members: membershipMap[u.id] ? [membershipMap[u.id]] : [],
        }));
        return json(result);
      }

      case 'update_kyc': {
        const { userId, kycStatus, adminRole } = payload;
        const { data, error: e } = await supabase.from('users').update({ kyc_status: kycStatus, active: kycStatus !== 'rejected' }).eq('id', userId).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, `KYC ${kycStatus}`, `${data.first_name} ${data.last_name}`, `KYC status set to ${kycStatus}`);
        return json(data);
      }

      case 'update_user': {
        const { userId, updates, adminRole } = payload;
        const { data, error: e } = await supabase.from('users').update(updates).eq('id', userId).select().single();
        if (e) return error(e.message);
        if (adminRole) await addAudit(adminRole, 'User Updated', `${data.first_name} ${data.last_name}`, JSON.stringify(updates));
        return json(data);
      }

      // ══════════════════════════════════════════════════════
      //  AUDIT LOG
      // ══════════════════════════════════════════════════════

      case 'get_audit_log': {
        const { limit = 100 } = payload;
        const { data, error: e } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
        if (e) return error(e.message);
        return json(data);
      }

      case 'add_audit': {
        const { adminRole, action: act, target, detail } = payload;
        await addAudit(adminRole, act, target, detail);
        return json({ success: true });
      }

      default:
        return error(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error('Data function error:', err);
    return error(err.message, 500);
  }
};

// Helper: add audit log entry
const addAudit = async (adminRole, action, target, detail) => {
  await supabase.from('audit_log').insert({ admin_role: adminRole, action, target, detail });
};

// Helper: generate random code
const genCode = (len) => Array.from({ length: len }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');

