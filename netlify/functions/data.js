// netlify/functions/data.js
// All data operations — teams, bets, leaderboard, admin
// Uses service_role key to bypass RLS on admin operations

const { createClient } = require('@supabase/supabase-js');
const { isUUID, isEnum, isString, isPositiveInt, isPositiveFloat, sanitizeUpdates } = require('./validate');
const { corsHeaders, bearerToken, verifyAdminToken, triggerInternal } = require('./security');
const { overallFromLegs } = require('./lib/settle');
const { notifyBetPlaced, notifyBetsWon } = require('./lib/push');
const { betStatus, betReturn, STATUS_SHORT } = require('../../src/lib/betMath.js');
const { weekAt } = require('../../src/lib/auTime.js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Resolve the caller's Supabase auth user from their bearer token, or null.
const getAuthUser = async (event) => {
  const token = bearerToken(event);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
};

// Is this user the captain of the given team? (captain_id or captain role.)
const isTeamCaptain = async (userId, teamId) => {
  if (!userId || !teamId) return false;
  const { data: team } = await supabase.from('teams').select('captain_id').eq('id', teamId).maybeSingle();
  if (team && team.captain_id === userId) return true;
  const { data: mem } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return !!mem && mem.role === 'captain';
};

// The caller's membership row for a team (any role), or null.
const getMembership = async (userId, teamId) => {
  if (!userId || !teamId) return null;
  const { data: team } = await supabase.from('teams').select('captain_id').eq('id', teamId).maybeSingle();
  if (team && team.captain_id === userId) return { role: 'captain', can_bet: true };
  const { data: mem } = await supabase.from('team_members').select('role, can_bet').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return mem || null;
};

// Remove phone numbers from member rows unless the caller may see them
// (a member of that team, or an admin). Phone numbers are personal info.
const stripPhones = (members) => (members || []).map(m => (
  m && m.users ? { ...m, users: { ...m.users, phone: undefined } } : m
));
const canSeeTeamContacts = async (event, payload, teamId) => {
  try { verifyAdminToken(payload.adminToken); return true; } catch (_) { /* not admin */ }
  const actor = await getAuthUser(event);
  if (!actor) return false;
  const mem = await getMembership(actor.id, teamId);
  return !!mem && mem.role !== 'pending';
};

exports.handler = async (event) => {
  const HEADERS = corsHeaders(event);
  const json  = (data, status = 200) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(data) });
  const error = (msg, status = 400)  => json({ error: msg }, status);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return error('Method not allowed', 405);

  let action, payload;
  try { const b = JSON.parse(event.body || '{}'); action = b.action; payload = b; }
  catch(e) { return error('Invalid JSON'); }

  try {
    // Verify admin token for all admin-only operations
    const ADMIN_ACTIONS = new Set([
      'get_all_competitions','get_all_teams','get_all_users','get_all_bets','get_audit_log',
      'create_competition','get_competition_requests','update_competition_request',
      'delete_competition','update_competition_status','update_competition','advance_week',
      'update_team','update_bet_result','update_bet_leg','reject_bet','correct_bet',
      'update_kyc','update_user','delete_user','add_audit','admin_reset_password',
      'get_admin_notifications','mark_notification_read','mark_all_notifications_read',
      'delete_team',
      'generate_recap',
      'trigger_results_check',
    ]);
    if (ADMIN_ACTIONS.has(action)) {
      try {
        const claims = verifyAdminToken(payload.adminToken);
        payload.adminRole = claims.role; // verified server-side role overrides any client value
      } catch (err) {
        return error(err.message, err.status || 401);
      }
    }

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
          .select('*, teams(id, team_name, team_code, status)')
          .order('created_at', { ascending: false });
        if (e) return error(e.message);
        const enriched = (data || []).map(c => ({ ...c, team_count: c.teams?.length || 0 }));
        return json(enriched);
      }

      case 'create_competition': {
        const { name, pub, weeks, buyIn, maxTeams, startDate, endDate, isPrivate, adminRole, weeklyLimit, finalWeekLimit } = payload;
        if (!name || String(name).trim().length < 1 || String(name).length > 120)
          return error('Competition name must be 1–120 characters.');
        if (pub && String(pub).length > 120)
          return error('Venue name must be 120 characters or fewer.');
        const status = adminRole === 'owner' ? 'active' : 'pending';
        const code   = genCode(6);
        const insertRow = {
          code, name, pub, status,
          weeks:      parseInt(weeks) || 8,
          buy_in:     parseInt(String(buyIn).replace(/[^0-9]/g, '')) || 1000,
          max_teams:  parseInt(maxTeams) || 20,
          start_date: startDate || null,
          end_date:   endDate   || null,
          jackpot:    0,
          is_private: isPrivate ? true : false,
          ...(dollarsToCents(weeklyLimit) ? { weekly_limit_cents: dollarsToCents(weeklyLimit) } : {}),
          ...(dollarsToCents(finalWeekLimit) ? { final_week_limit_cents: dollarsToCents(finalWeekLimit) } : {}),
        };
        let { data, error: e } = await supabase.from('competitions').insert(insertRow).select().single();
        if (e && e.message && /is_private|limit_cents/.test(e.message)) {
          // Column not yet migrated — insert without the newer columns
          const { is_private: _drop, weekly_limit_cents: _w, final_week_limit_cents: _f, ...rowWithout } = insertRow;
          const res2 = await supabase.from('competitions').insert(rowWithout).select().single();
          if (res2.error) return error(res2.error.message);
          data = res2.data;
        } else if (e) {
          return error(e.message);
        }
        await addAudit(adminRole, 'Competition Created', name, `Code: ${code}, Private: ${isPrivate ? 'yes' : 'no'}`);
        return json(data);
      }

      case 'request_competition': {
        const { contactName, contactPhone, contactEmail, pubName, compName, estimatedTeams, preferredStartDate, preferredEndDate, buyIn, isPrivate, notes } = payload;
        const nameErr = isString(contactName, { max: 120, label: 'Contact name' });
        if (nameErr) return error(nameErr);
        const pubErr = isString(pubName, { max: 120, label: 'Venue name' });
        if (pubErr) return error(pubErr);
        const compNameErr = isString(compName, { max: 120, label: 'Competition name' });
        if (compNameErr) return error(compNameErr);
        if (notes && String(notes).length > 1000) return error('Notes must be 1000 characters or fewer.');
        const requestCode = genCode(8);
        const { data, error: e } = await supabase.from('competition_requests').insert({
          request_code:          requestCode,
          contact_name:          contactName || '',
          contact_phone:         contactPhone || '',
          contact_email:         contactEmail || '',
          pub_name:              pubName || '',
          comp_name:             compName || '',
          estimated_teams:       parseInt(estimatedTeams) || null,
          preferred_start_date:  preferredStartDate || null,
          preferred_end_date:    preferredEndDate || null,
          buy_in:                parseInt(String(buyIn || '0').replace(/[^0-9]/g, '')) || null,
          is_private:            isPrivate ? true : false,
          notes:                 notes || '',
          status:                'requested',
        }).select().single();
        if (e) return error(e.message);
        await createAdminNotif(
          'competition_request',
          `New competition request: ${compName || pubName}`,
          `${contactName} from ${pubName} has requested a competition (${compName}). ~${estimatedTeams || '?'} teams, buy-in $${parseInt(String(buyIn || '0').replace(/[^0-9]/g, '')) || 'TBD'}.`,
          { requestId: data.id, requestCode, pubName, compName, contactName, contactPhone, contactEmail, estimatedTeams }
        );
        return json(data);
      }

      case 'get_competition_requests': {
        const { adminRole } = payload;
        if (!adminRole) return error('Admin access required', 403);
        const { data, error: e } = await supabase
          .from('competition_requests')
          .select('*')
          .order('created_at', { ascending: false });
        if (e) return error(e.message);
        return json(data || []);
      }

      case 'update_competition_request': {
        const { id, status: reqStatus, adminRole } = payload;
        if (!adminRole) return error('Admin access required', 403);
        const reqStatusErr = isEnum(reqStatus, ['requested', 'approved', 'declined']);
        if (reqStatusErr) return error(`Invalid request status. ${reqStatusErr}`);
        const { data, error: e } = await supabase
          .from('competition_requests')
          .update({ status: reqStatus })
          .eq('id', id)
          .select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, `Competition Request ${reqStatus}`, data.comp_name, `Contact: ${data.contact_name}`);
        return json(data);
      }

      case 'get_competition_by_code': {
        const { code } = payload;
        if (!code || String(code).trim().length === 0) return error('Competition code is required.');
        const { data, error: e } = await supabase
          .from('competitions')
          .select('id, name, pub, code, status, buy_in, max_teams, start_date, end_date, is_private, weeks')
          .eq('code', code.toUpperCase())
          .single();
        if (e) return error('Competition not found');
        if (data.status !== 'active') return error('This competition is not currently active');
        return json(data);
      }

      case 'delete_competition': {
        const { id, adminRole } = payload;
        if (adminRole !== 'owner') return error('Only owner can delete competitions', 403);
        // Fetch name for audit before deleting
        const { data: comp, error: fetchErr } = await supabase.from('competitions').select('name, code').eq('id', id).single();
        if (fetchErr) return error(fetchErr.message);
        // Delete all dependent data in order
        const teamRes = await supabase.from('teams').select('id').eq('competition_id', id);
        const teamIds = (teamRes.data || []).map(t => t.id);
        if (teamIds.length) {
          const betRes = await supabase.from('bets').select('id').in('team_id', teamIds);
          const betIds = (betRes.data || []).map(b => b.id);
          if (betIds.length) {
            await supabase.from('bet_legs').delete().in('bet_id', betIds);
            await supabase.from('bets').delete().in('id', betIds);
          }
          await supabase.from('betting_order').delete().in('team_id', teamIds);
          await supabase.from('team_members').delete().in('team_id', teamIds);
          await supabase.from('teams').delete().in('id', teamIds);
        }
        const { error: delErr } = await supabase.from('competitions').delete().eq('id', id);
        if (delErr) return error(delErr.message);
        await addAudit(adminRole, 'Competition Deleted', comp.name, `Code: ${comp.code}, Teams removed: ${teamIds.length}`);
        return json({ success: true, name: comp.name });
      }

      case 'delete_team': {
        const { id: teamId, adminRole: delTeamRole } = payload;
        if (delTeamRole !== 'owner') return error('Only owner can delete teams', 403);
        // Fetch team details for audit before deleting
        const { data: teamData, error: teamFetchErr } = await supabase.from('teams').select('team_name, team_code').eq('id', teamId).single();
        if (teamFetchErr) return error(teamFetchErr.message);
        // Cascade delete: bet_legs → bets → betting_order → team_members → team
        const { data: betRows } = await supabase.from('bets').select('id').eq('team_id', teamId);
        const betIds = (betRows || []).map(b => b.id);
        if (betIds.length) {
          await supabase.from('bet_legs').delete().in('bet_id', betIds);
          await supabase.from('bets').delete().in('id', betIds);
        }
        await supabase.from('betting_order').delete().eq('team_id', teamId);
        await supabase.from('team_members').delete().eq('team_id', teamId);
        const { error: delTeamErr } = await supabase.from('teams').delete().eq('id', teamId);
        if (delTeamErr) return error(delTeamErr.message);
        await addAudit(delTeamRole, 'Team Deleted', teamData.team_name, `Code: ${teamData.team_code}, Bets removed: ${betIds.length}`);
        return json({ success: true, name: teamData.team_name });
      }

      case 'update_competition_status': {
        const { id, status, adminRole } = payload;
        const statusErr = isEnum(status, ['active', 'pending', 'completed', 'cancelled']);
        if (statusErr) return error(`Invalid status. ${statusErr}`);
        const { data, error: e } = await supabase.from('competitions').update({ status }).eq('id', id).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, `Competition ${status}`, data.name, '');
        return json(data);
      }

      case 'update_competition': {
        const { id, name, pub, buyIn, maxTeams, startDate, endDate, isPrivate, adminRole, weeklyLimit, finalWeekLimit } = payload;
        const weeksCalc = startDate && endDate
          ? Math.round((new Date(endDate) - new Date(startDate)) / (7 * 86400000))
          : null;
        const updates = {};
        if (name)                updates.name       = name.trim();
        if (pub)                 updates.pub        = pub.trim();
        if (buyIn)               updates.buy_in     = parseInt(String(buyIn).replace(/[^0-9]/g, '')) || undefined;
        if (maxTeams)            updates.max_teams  = parseInt(maxTeams) || undefined;
        if (startDate)           updates.start_date = startDate;
        if (endDate)             updates.end_date   = endDate;
        if (weeksCalc && weeksCalc > 0) updates.weeks = weeksCalc;
        if (isPrivate !== undefined) updates.is_private = isPrivate;
        if (dollarsToCents(weeklyLimit)) updates.weekly_limit_cents = dollarsToCents(weeklyLimit);
        if (finalWeekLimit !== undefined) updates.final_week_limit_cents = dollarsToCents(finalWeekLimit) || null;
        const { data, error: e } = await supabase.from('competitions').update(updates).eq('id', id).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, 'Competition Updated', data.name, Object.keys(updates).join(', '));
        return json(data);
      }

      case 'advance_week': {
        // Shift start_date back by 7 days so calcCurrentWeek returns week+1.
        // direction: 'forward' (default) or 'back' to undo.
        const { id, adminRole, direction = 'forward' } = payload;
        const { data: comp, error: fetchErr } = await supabase.from('competitions').select('start_date, name').eq('id', id).single();
        if (fetchErr) return error(fetchErr.message);
        const shift = direction === 'back' ? 7 : -7; // days
        const newDate = new Date(comp.start_date);
        newDate.setUTCDate(newDate.getUTCDate() + shift);
        const newDateStr = newDate.toISOString().slice(0, 10);
        const { data, error: e } = await supabase.from('competitions').update({ start_date: newDateStr }).eq('id', id).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, direction === 'back' ? 'Week Rolled Back' : 'Week Advanced', comp.name, `start_date: ${comp.start_date} → ${newDateStr}`);
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
        if (!(await canSeeTeamContacts(event, payload, teamId))) data.team_members = stripPhones(data.team_members);
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
          // Explicitly filter so only this team's members are returned
          team_members: (membersByTeam[t.id] || []).filter(m => m.team_id === t.id),
        }));
        return json(result);
      }

      case 'update_team': {
        const { teamId, adminRole } = payload;
        const TEAM_ALLOWED = ['team_name', 'status', 'buy_in_mode', 'finalised', 'deposit_per_member', 'competition_id', 'flagged'];
        const { clean: updates } = sanitizeUpdates(payload.updates, TEAM_ALLOWED);
        if (Object.keys(updates).length === 0) return error('No valid fields to update.');
        const { data, error: e } = await supabase.from('teams').update(updates).eq('id', teamId).select().single();
        if (e) return error(e.message);
        if (adminRole) await addAudit(adminRole, 'Team Updated', data.team_name, JSON.stringify(updates));
        return json(data);
      }

      case 'finalise_team': {
        const { teamId, depositPerMember, reopen } = payload;
        const actor = await getAuthUser(event);
        if (!actor) return error('Please log in again.', 401);
        if (!(await isTeamCaptain(actor.id, teamId))) return error('Only the team captain can finalise or re-open the team.', 403);
        const perMember = parseInt(depositPerMember, 10);
        if (!reopen && (!perMember || perMember <= 0 || perMember > 1_000_000)) return error('Invalid deposit amount.');
        const { data, error: e } = await supabase
          .from('teams')
          .update(reopen ? { finalised: false, deposit_per_member: null } : { finalised: true, deposit_per_member: perMember })
          .eq('id', teamId).select().single();
        if (e) return error(e.message);
        return json(data);
      }

      // ══════════════════════════════════════════════════════
      //  TEAM MEMBERS
      // ══════════════════════════════════════════════════════

      case 'get_team_members': {
        const { teamId } = payload;
        let { data, error: e } = await supabase
          .from('team_members')
          .select(`*, users(id, first_name, last_name, phone, kyc_status)`)
          .eq('team_id', teamId)
          .order('betting_order', { ascending: true, nullsFirst: false });
        // betting_order column may not exist — retry without it
        if (e) {
          const res2 = await supabase
            .from('team_members')
            .select(`*, users(id, first_name, last_name, phone, kyc_status)`)
            .eq('team_id', teamId);
          data = res2.data;
          e    = res2.error;
        }
        if (e) return error(e.message);
        if (!(await canSeeTeamContacts(event, payload, teamId))) data = stripPhones(data);
        return json(data);
      }

      case 'approve_member': {
        const { teamId, userId } = payload;
        const adminRole = getAdminRole(payload);
        if (!adminRole) {
          const actor = await getAuthUser(event);
          if (!actor) return error('Please log in again.', 401);
          if (!(await isTeamCaptain(actor.id, teamId))) return error('Only the team captain or an admin can approve members.', 403);
        }
        const { data, error: e } = await supabase
          .from('team_members')
          .update({ role: 'member', can_bet: true })
          .eq('team_id', teamId).eq('user_id', userId).select().single();
        if (e) return error(e.message);
        return json(data);
      }

      case 'reject_member': {
        const { teamId, userId } = payload;
        const adminRole = getAdminRole(payload);
        if (!adminRole) {
          const actor = await getAuthUser(event);
          if (!actor) return error('Please log in again.', 401);
          if (!(await isTeamCaptain(actor.id, teamId))) return error('Only the team captain or an admin can remove members.', 403);
        }
        const { error: e } = await supabase
          .from('team_members').delete()
          .eq('team_id', teamId).eq('user_id', userId);
        if (e) return error(e.message);
        // Also remove from betting_order so they don't linger in the rotation
        await supabase.from('betting_order').delete()
          .eq('team_id', teamId).eq('user_id', userId);
        return json({ success: true });
      }

      case 'update_member': {
        const { teamId, userId } = payload;
        const actor = await getAuthUser(event);
        if (!actor) return error('Please log in again.', 401);
        if (!(await isTeamCaptain(actor.id, teamId))) return error('Only the team captain can update members.', 403);
        const MEMBER_ALLOWED = ['role', 'can_bet', 'deposit_paid', 'betting_order'];
        const { clean: updates } = sanitizeUpdates(payload.updates, MEMBER_ALLOWED);
        if (Object.keys(updates).length === 0) return error('No valid fields to update.');
        if (updates.role !== undefined) {
          const roleErr = isEnum(updates.role, ['captain', 'member', 'view-only', 'pending']);
          if (roleErr) return error(`Invalid role. ${roleErr}`);
        }
        const { data, error: e } = await supabase
          .from('team_members').update(updates)
          .eq('team_id', teamId).eq('user_id', userId).select().single();
        if (e) return error(e.message);
        return json(data);
      }

      case 'save_betting_order': {
        const { teamId, orderedUserIds } = payload;
        const actor = await getAuthUser(event);
        if (!actor) return error('Please log in again.', 401);
        if (!(await isTeamCaptain(actor.id, teamId))) return error('Only the team captain can set the betting order.', 403);
        if (!Array.isArray(orderedUserIds)) return error('orderedUserIds must be an array.');
        if (orderedUserIds.length > 50) return error('Betting order cannot exceed 50 members.');
        const { data: memberRows } = await supabase.from('team_members').select('user_id, role').eq('team_id', teamId);
        const memberIds = new Set((memberRows || []).filter(m => m.role !== 'pending').map(m => m.user_id));
        const ids = [...new Set(orderedUserIds)].filter(id => memberIds.has(id));
        if (!ids.length) return error('None of those people are members of this team.');
        await supabase.from('betting_order').delete().eq('team_id', teamId);
        const rows = ids.map((userId, i) => ({ team_id: teamId, user_id: userId, position: i + 1 }));
        const { error: e } = await supabase.from('betting_order').insert(rows);
        if (e) return error(e.message);
        // Mirror the position onto team_members so get_team_members returns the
        // saved rotation order (that's what the app loads).
        for (const [i, userId] of ids.entries()) {
          await supabase.from('team_members').update({ betting_order: i + 1 }).eq('team_id', teamId).eq('user_id', userId);
        }
        return json({ success: true, saved: ids.length });
      }

      case 'create_additional_team': {
        const { userId, teamName, competitionCode, buyInMode } = payload;
        if (!userId)   return error('Not logged in');
        {
          const actor = await getAuthUser(event);
          if (!actor) return error('Please log in again.', 401);
          if (actor.id !== userId) return error('You can only create teams for your own account.', 403);
        }
        if (!teamName?.trim()) return error('Team name is required');

        // Only a captain of an existing team with this name may register it in another competition
        const { data: captainedTeam } = await supabase
          .from('teams')
          .select('id')
          .eq('captain_id', userId)
          .ilike('team_name', teamName.trim())
          .maybeSingle();
        if (!captainedTeam) return error('You must be the captain of an existing team with this name to register it in another competition.');

        // Resolve competition
        let compId = null;
        if (competitionCode) {
          const { data: comp } = await supabase.from('competitions').select('id').eq('code', competitionCode).eq('status', 'active').maybeSingle();
          compId = comp?.id || null;
        }

        // Enforce team name uniqueness within competition (case-insensitive)
        const nameQuery = supabase.from('teams').select('id').ilike('team_name', teamName.trim());
        if (compId) nameQuery.eq('competition_id', compId);
        const { data: nameDup } = await nameQuery.maybeSingle();
        if (nameDup) return error(`Team name "${teamName.trim()}" is already taken in this competition. Please choose a different name.`);

        // Enforce max 3 teams per user per competition (any role)
        const countQuery = supabase
          .from('team_members')
          .select('teams!inner(competition_id)', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (compId) countQuery.eq('teams.competition_id', compId);
        const { count: teamCount } = await countQuery;
        if (teamCount >= 3) return error('You can only be in up to 3 teams in the same competition.');

        // Generate unique team code
        let teamCodeGen, attempts = 0;
        do {
          teamCodeGen = Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
          const { data: ex } = await supabase.from('teams').select('id').eq('team_code', teamCodeGen).maybeSingle();
          if (!ex) break;
        } while (++attempts < 10);

        // Create team
        const { data: newTeam, error: teamErr } = await supabase.from('teams').insert({
          team_code:      teamCodeGen,
          team_name:      teamName.trim(),
          captain_id:     userId,
          competition_id: compId,
          buy_in_mode:    buyInMode || 'split',
          status:         'pending',
          finalised:      false,
        }).select().single();
        if (teamErr) return error(teamErr.message);

        // Add as captain in team_members
        const { error: memberErr } = await supabase.from('team_members').insert({
          team_id:       newTeam.id,
          user_id:       userId,
          role:          'captain',
          can_bet:       true,
          deposit_paid:  false,
          betting_order: 1,
        });
        if (memberErr) {
          // Retry without betting_order if column missing
          await supabase.from('team_members').insert({ team_id: newTeam.id, user_id: userId, role: 'captain', can_bet: true, deposit_paid: false });
        }

        // Increment competition team count
        if (compId) {
          const { error: rpcErr } = await supabase.rpc('increment_competition_teams', { comp_id: compId });
          if (rpcErr) {
            const { data: cd } = await supabase.from('competitions').select('teams_count').eq('id', compId).maybeSingle();
            if (cd) await supabase.from('competitions').update({ teams_count: (cd.teams_count || 0) + 1 }).eq('id', compId);
          }
        }

        await createAdminNotif(
          'new_team',
          `New team registered: ${teamName.trim()}`,
          `A new team "${teamName.trim()}" has signed up${competitionCode ? ` for competition ${competitionCode}` : ''}. Captain user ID: ${userId}.`,
          { teamId: newTeam.id, teamCode: teamCodeGen, teamName: teamName.trim(), competitionCode: competitionCode || null, userId }
        );
        return json({ ...newTeam, teamCode: teamCodeGen });
      }

      case 'join_existing_team': {
        const { userId, teamCode } = payload;
        if (!userId)   return error('Not logged in');
        {
          const actor = await getAuthUser(event);
          if (!actor) return error('Please log in again.', 401);
          if (actor.id !== userId) return error('You can only join teams for your own account.', 403);
        }
        if (!teamCode?.trim()) return error('Team code is required');

        // Find the team
        const { data: team } = await supabase
          .from('teams')
          .select('*, competitions(name, code, status)')
          .eq('team_code', teamCode.trim().toUpperCase())
          .maybeSingle();
        if (!team) return error('Team code not found. Please check and try again.');

        // Check user isn't already a member (any role)
        const { data: existing } = await supabase
          .from('team_members')
          .select('id, role')
          .eq('team_id', team.id)
          .eq('user_id', userId)
          .maybeSingle();
        if (existing) {
          if (existing.role === 'pending') return error('You have already requested to join this team and are awaiting captain approval.');
          return error('You are already a member of this team.');
        }

        // Add as pending member
        const { error: memberErr } = await supabase.from('team_members').insert({
          team_id:      team.id,
          user_id:      userId,
          role:         'pending',
          can_bet:      false,
          deposit_paid: false,
        });
        if (memberErr) return error(memberErr.message);

        return json({ teamName: team.team_name, teamCode: team.team_code, teamId: team.id, competitionName: team.competitions?.name || null });
      }

      // ══════════════════════════════════════════════════════
      //  BETS
      // ══════════════════════════════════════════════════════

      case 'submit_bet': {
        const { teamId, weekNumber, betType, stake, combinedOdds, estimatedReturn, submissionValid, aiConfidence, legs } = payload;

        // Authorise: only a signed-in team member who is allowed to bet may submit,
        // and the submitter is always the caller (never taken from the request).
        const actor = await getAuthUser(event);
        if (!actor) return error('Please log in again to submit a bet.', 401);
        if (isUUID(teamId) !== null) return error('Invalid team.');
        const membership = await getMembership(actor.id, teamId);
        if (!membership || membership.role === 'pending') return error('You are not a member of this team.', 403);
        if (membership.role === 'view-only' || membership.can_bet === false) return error('You do not have betting rights in this team. Ask your captain.', 403);

        const stakeCents = Math.round(parseFloat(String(stake).replace(/[^0-9.]/g, '')));

        // Weekly stake limit for this team's competition (server-side, so it can't
        // be bypassed). Limits come from the competition; default $50.
        const { data: teamRow } = await supabase.from('teams').select('competition_id, competitions(*)').eq('id', teamId).maybeSingle();
        const comp = teamRow?.competitions || null;
        const thisWeek = comp?.start_date ? weekAt(Date.now(), comp.start_date) : null;
        const isFinalWeek = !!(comp?.weeks && thisWeek && thisWeek >= comp.weeks);
        const limitCents = (isFinalWeek && comp?.final_week_limit_cents) || comp?.weekly_limit_cents || 5000;

        const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabase.from('bets')
          .select('id, stake, submitted_at, overall_status, bet_legs(selection)')
          .eq('team_id', teamId).gte('submitted_at', since);
        const live = (recent || []).filter(b => b.overall_status !== 'rejected');
        if (thisWeek && comp?.start_date) {
          const usedCents = live
            .filter(b => weekAt(new Date(b.submitted_at).getTime(), comp.start_date) === thisWeek)
            .reduce((sum, b) => sum + (b.stake || 0), 0);
          if (usedCents + stakeCents > limitCents) {
            const left = Math.max(0, limitCents - usedCents) / 100;
            return error(`Weekly limit is $${(limitCents / 100).toFixed(2)}${isFinalWeek && comp?.final_week_limit_cents ? ' (final week)' : ''}. Your team has $${left.toFixed(2)} left this week.`, 409);
          }
        }

        // Duplicate guard: the same stake and the same selections in the last 8 days
        // is almost always a double submit. The client can confirm and resend.
        if (!payload.allowDuplicate && Array.isArray(legs)) {
          const sig = (sels) => sels.map(x => String(x || '').trim().toLowerCase()).sort().join('|');
          const mine = sig(legs.map(l => l.selection));
          const dup = live.find(b => b.stake === stakeCents && sig((b.bet_legs || []).map(l => l.selection)) === mine);
          if (dup) return error('Duplicate bet: this slip looks like one your team already submitted. Submit again only if you placed it twice.', 409);
        }

        const stakeErr = isPositiveInt(stake, { max: 1_000_000, label: 'Stake' });
        if (stakeErr) return error(stakeErr);
        // Normalise casing/variants (e.g. "Multi", "Same Game Multi") to the enum.
        const normBetType = /single/i.test(String(betType || '')) ? 'single' : 'multi';
        const betTypeErr = isEnum(normBetType, ['multi', 'single']);
        if (betTypeErr) return error(`Invalid bet type. ${betTypeErr}`);
        if (!Array.isArray(legs) || legs.length === 0) return error('Bet must include at least one leg.');
        if (legs.length > 20) return error('Bet cannot have more than 20 legs.');
        if (combinedOdds !== null && combinedOdds !== undefined) {
          const oddsErr = isPositiveFloat(combinedOdds, { min: 1.01, max: 10_000, label: 'Combined odds' });
          if (oddsErr) return error(oddsErr);
        }
        for (const [i, leg] of legs.entries()) {
          const legLabel = `Leg ${i + 1}`;
          const evtErr = isString(leg.event, { max: 200, label: `${legLabel} event` });
          if (evtErr) return error(evtErr);
          const selErr = isString(leg.selection, { max: 200, label: `${legLabel} selection` });
          if (selErr) return error(selErr);
        }

        const { data: bet, error: betError } = await supabase.from('bets').insert({
          team_id:          teamId,
          week_number:      weekNumber,
          bet_type:         normBetType,
          stake:            stakeCents,
          combined_odds:    parseFloat(combinedOdds) || null,
          estimated_return: Math.round(parseFloat(String(estimatedReturn).replace(/[^0-9.]/g, ''))),
          overall_status:   'pending',
          submission_valid: submissionValid !== false,
          ai_confidence:    aiConfidence || null,
          submitted_by:     actor.id,
          flagged:          !submissionValid,
        }).select().single();
        if (betError) return error(betError.message);

        if (legs?.length) {
          const MARKET_TYPES = ['head_to_head', 'line', 'total', 'anytime_scorer', 'first_scorer', 'win', 'place', 'other'];
          const str = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
          const intOrNull = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
          const numOrNull = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
          const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
          const timeOrNull = (v) => (/^\d{1,2}:\d{2}/.test(String(v || '')) ? String(v).slice(0, 5) : null);
          const baseRows = legs.map((leg, i) => ({
            bet_id:     bet.id,
            leg_number: intOrNull(leg.legNumber) || i + 1,
            event:      leg.event,
            selection:  leg.selection,
            market:     leg.market,
            odds:       numOrNull(leg.odds),
            event_date: dateOrNull(leg.eventDate),
            start_time: timeOrNull(leg.startTime),
            status:     'pending',
          }));
          // Structured fields extracted from the slip (v2 migration). They let the
          // settler search precisely and settle most markets in code.
          const fullRows = baseRows.map((row, i) => {
            const leg = legs[i];
            const mt = String(leg.marketType || '').toLowerCase();
            return {
              ...row,
              sport:         str(leg.sport, 40),
              competition:   str(leg.competition),
              home_team:     str(leg.homeTeam),
              away_team:     str(leg.awayTeam),
              market_type:   MARKET_TYPES.includes(mt) ? mt : null,
              line:          numOrNull(leg.line),
              player:        str(leg.player),
              venue:         str(leg.venue),
              race_number:   intOrNull(leg.raceNumber),
              runner_number: intOrNull(leg.runnerNumber),
            };
          });
          let { error: legsError } = await supabase.from('bet_legs').insert(fullRows);
          if (legsError && /column|schema cache/i.test(legsError.message || '')) {
            // v2 columns not migrated yet — store the basic fields.
            ({ error: legsError } = await supabase.from('bet_legs').insert(baseRows));
          }
          if (legsError) return error(legsError.message);
        }

        // Tell the rest of the team (never blocks or fails the bet).
        await notifyBetPlaced(supabase, bet);

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
        const { data: before } = await supabase.from('bets').select('overall_status').eq('id', betId).maybeSingle();
        const { data, error: e } = await supabase.from('bets').update({ overall_status: overallStatus }).eq('id', betId).select('*, teams(team_name)').single();
        if (e) return error(e.message);
        if (overallStatus === 'won' && before?.overall_status !== 'won') await notifyBetsWon(supabase, [betId]);
        await addAudit(adminRole, `Bet ${overallStatus}`, `${data.teams?.team_name} — ${betId}`, `Result set to ${overallStatus}`);
        return json(data);
      }

      case 'update_bet_leg': {
        const { legId, status, resultNote, adminRole } = payload;
        const legStatusErr = isEnum(status, ['pending', 'in_progress', 'won', 'lost', 'void']);
        if (legStatusErr) return error(`Invalid leg status. ${legStatusErr}`);
        const baseUpdate = { status, result_note: resultNote, updated_at: new Date().toISOString() };
        const sel = '*, bets(id, overall_status, teams(team_name))';
        // Admin decision: clear the review flag and record who settled it (v2 columns).
        let { data, error: e } = await supabase.from('bet_legs')
          .update({ ...baseUpdate, settled_by: 'admin', needs_review: false })
          .eq('id', legId).select(sel).single();
        if (e && /column|schema cache/i.test(e.message || '')) {
          ({ data, error: e } = await supabase.from('bet_legs').update(baseUpdate).eq('id', legId).select(sel).single());
        }
        if (e) return error(e.message);
        // Keep the bet's overall status in step with its legs.
        if (data.bet_id) {
          const { data: siblings } = await supabase.from('bet_legs').select('status').eq('bet_id', data.bet_id);
          const overall = overallFromLegs(siblings || []);
          if (overall !== data.bets?.overall_status) {
            await supabase.from('bets').update({ overall_status: overall }).eq('id', data.bet_id);
            if (overall === 'won') await notifyBetsWon(supabase, [data.bet_id]);
          }
        }
        if (adminRole) await addAudit(adminRole, 'Leg Override', `${data.bets?.teams?.team_name} — ${data.selection}`, `Status → ${status}${resultNote ? ': ' + resultNote : ''}`);
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
      //  PUSH NOTIFICATIONS (bet placed / bet won)
      // ══════════════════════════════════════════════════════

      case 'push_public_key': {
        return json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
      }

      case 'push_subscribe': {
        const actor = await getAuthUser(event);
        if (!actor) return error('Please log in again.', 401);
        const sub = payload.subscription || {};
        const endpoint = String(sub.endpoint || '');
        const p256dh = String(sub.keys?.p256dh || '');
        const auth = String(sub.keys?.auth || '');
        if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return error('Invalid subscription.');
        if (!p256dh || p256dh.length > 200 || !auth || auth.length > 100) return error('Invalid subscription.');
        const { error: e } = await supabase.from('push_subscriptions').upsert({
          user_id: actor.id, endpoint, p256dh, auth,
          user_agent: String(event.headers?.['user-agent'] || '').slice(0, 300) || null,
        }, { onConflict: 'endpoint' });
        if (e) return error(/push_subscriptions/.test(e.message || '') ? 'Notifications are not set up yet.' : e.message, 503);
        return json({ ok: true });
      }

      case 'push_unsubscribe': {
        const actor = await getAuthUser(event);
        if (!actor) return error('Please log in again.', 401);
        const endpoint = String(payload.endpoint || '');
        if (!endpoint) return error('Missing endpoint.');
        await supabase.from('push_subscriptions').delete().eq('user_id', actor.id).eq('endpoint', endpoint);
        return json({ ok: true });
      }

      // ══════════════════════════════════════════════════════
      //  LEADERBOARD
      // ══════════════════════════════════════════════════════

      case 'get_leaderboard': {
        const { competitionId, startDate } = payload;
        const { data, error: e } = await supabase
          .from('teams')
          .select(`id, team_name, team_code, status, finalised, team_members(user_id, role, users(first_name, last_name)), bets(id, overall_status, stake, estimated_return, week_number, bet_type, combined_odds, flagged, submitted_at, submitted_by, bet_legs(*))`)
          .eq('competition_id', competitionId)
          .neq('status', 'suspended');
        if (e) return error(e.message);

        const currentWeek = payload.currentWeek || 1;

        // A bet's week comes from its upload time: weeks roll over every Wednesday
        // 12:00 midday Sydney time (DST-aware) — same rule as the app (src/lib/auTime.js).
        const calcWeekFromTimestamp = (submittedAt, compStartDate) =>
          (submittedAt && compStartDate) ? weekAt(new Date(submittedAt).getTime(), compStartDate) : null;

        const ranked = data
          .map(team => {
            // Build user_id → full name lookup from team members
            const memberNameMap = {};
            (team.team_members || []).forEach(m => {
              if (m.user_id && m.users) {
                memberNameMap[m.user_id] = `${m.users.first_name || ''} ${m.users.last_name || ''}`.trim() || 'Member';
              }
            });
            const memberCount = team.team_members?.length || 0;

            // Sort bets newest week first so bets[0] in the frontend is always current
            const sortedBets = (team.bets || [])
              .map(b => ({
                ...b,
                // Derive week from submitted_at timestamp — more reliable than the stored week_number
                week_number: (startDate && b.submitted_at)
                  ? calcWeekFromTimestamp(b.submitted_at, startDate)
                  : (b.week_number || 1),
                // Attach submitter's name from team members lookup
                submitted_by_name: b.submitted_by ? (memberNameMap[b.submitted_by] || null) : null,
                // Re-derive status from legs so it's always accurate (shared rules)
                overall_status: betStatus(b.bet_legs, b.overall_status || 'pending'),
                // Actual gross return in cents: reduced for void legs, stake back if all void
                actual_return: betReturn(b).returnCents,
                return_reduced: betReturn(b).reducedForVoids,
                // Sort legs by leg_number
                bet_legs: (b.bet_legs || []).slice().sort((a, b) => (a.leg_number || 0) - (b.leg_number || 0)),
              }))
              .sort((a, b) => (b.week_number || 0) - (a.week_number || 0));

            const totalWon = sortedBets.reduce((sum, b) => sum + (b.actual_return || 0), 0);
            const weekBet  = sortedBets.find(b => b.week_number === currentWeek);
            const weekHistory = Array.from({ length: currentWeek - 1 }, (_, i) => {
              const wb = sortedBets.find(b => b.week_number === i + 1);
              return STATUS_SHORT[wb?.overall_status] || '–';
            });
            return { ...team, bets: sortedBets, totalWon, totalWonFormatted: `$${(totalWon / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, memberCount, currentWeekBet: weekBet || null, weekHistory };
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
        // The app and database use 'verified'; accept 'approved' as an alias.
        const kyc = kycStatus === 'approved' ? 'verified' : kycStatus;
        const kycErr = isEnum(kyc, ['pending', 'verified', 'rejected']);
        if (kycErr) return error(`Invalid KYC status. ${kycErr}`);
        const { data, error: e } = await supabase.from('users').update({ kyc_status: kyc, active: kyc !== 'rejected' }).eq('id', userId).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, `KYC ${kyc}`, `${data.first_name} ${data.last_name}`, `KYC status set to ${kyc}`);
        return json(data);
      }

      case 'update_user': {
        const { userId, adminRole } = payload;
        const USER_ALLOWED = ['first_name', 'last_name', 'email', 'dob', 'postcode', 'active', 'flagged', 'kyc_status', 'role'];
        const { clean: updates } = sanitizeUpdates(payload.updates, USER_ALLOWED);
        if (Object.keys(updates).length === 0) return error('No valid fields to update.');
        const { data, error: e } = await supabase.from('users').update(updates).eq('id', userId).select().single();
        if (e) return error(e.message);
        if (adminRole) await addAudit(adminRole, 'User Updated', `${data.first_name} ${data.last_name}`, JSON.stringify(updates));
        return json(data);
      }

      case 'delete_user': {
        const { userId, adminRole } = payload;
        if (adminRole !== 'owner') return error('Only owner can delete users', 403);
        if (!userId) return error('userId is required');

        // Fetch user details for audit log before deletion
        const { data: userToDelete } = await supabase.from('users').select('first_name, last_name, phone').eq('id', userId).maybeSingle();
        const userName = userToDelete ? `${userToDelete.first_name} ${userToDelete.last_name} (${userToDelete.phone})` : userId;

        // Remove team memberships
        await supabase.from('team_members').delete().eq('user_id', userId);

        // Delete the user profile row
        const { error: delErr } = await supabase.from('users').delete().eq('id', userId);
        if (delErr) return error(delErr.message);

        // Delete from Supabase auth
        const { error: authDelErr } = await supabase.auth.admin.deleteUser(userId);
        if (authDelErr) console.error('Auth delete error:', authDelErr.message);

        await addAudit(adminRole, 'User Deleted', userName, 'User account permanently deleted to allow re-registration');
        return json({ success: true });
      }

      case 'admin_reset_password': {
        // Issue a temporary password for a member who is locked out. The admin
        // passes it on in person/by text; the member changes it in their profile.
        const { userId, adminRole } = payload;
        if (!['owner', 'campaign'].includes(adminRole)) return error('Only the owner or campaign manager can reset passwords.', 403);
        if (isUUID(userId) !== null) return error('Invalid user.');
        const { data: target } = await supabase.from('users').select('first_name, last_name').eq('id', userId).maybeSingle();
        if (!target) return error('User not found.', 404);
        const WORDS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let temp = '';
        while (temp.length < 12) { const b = randomBytes(1)[0]; if (b < 248) temp += WORDS[b % WORDS.length]; }
        const { error: pwErr } = await supabase.auth.admin.updateUserById(userId, { password: temp });
        if (pwErr) return error(pwErr.message);
        await addAudit(adminRole, 'Password Reset', `${target.first_name} ${target.last_name}`, 'Temporary password issued');
        return json({ success: true, tempPassword: temp });
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

      // ══════════════════════════════════════════════════════
      //  ADMIN NOTIFICATIONS
      // ══════════════════════════════════════════════════════

      case 'get_admin_notifications': {
        const { adminRole: role, unreadOnly = false } = payload;
        if (!role) return error('Admin access required', 403);
        let query = supabase
          .from('admin_notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (unreadOnly) query = query.eq('read', false);
        const { data, error: e } = await query;
        if (e) return error(e.message);
        return json(data || []);
      }

      case 'mark_notification_read': {
        const { id, adminRole: role } = payload;
        if (!role) return error('Admin access required', 403);
        const { data, error: e } = await supabase
          .from('admin_notifications')
          .update({ read: true })
          .eq('id', id)
          .select().single();
        if (e) return error(e.message);
        return json(data);
      }

      case 'mark_all_notifications_read': {
        const { adminRole: role } = payload;
        if (!role) return error('Admin access required', 403);
        const { error: e } = await supabase
          .from('admin_notifications')
          .update({ read: true })
          .eq('read', false);
        if (e) return error(e.message);
        return json({ success: true });
      }

      // ══════════════════════════════════════════════════════
      //  WEEKLY RECAPS
      // ══════════════════════════════════════════════════════

      case 'get_weekly_recap': {
        const { competitionId, weekNumber } = payload;
        if (!competitionId) return error('competitionId is required');
        if (!weekNumber)    return error('weekNumber is required');
        const { data, error: e } = await supabase
          .from('weekly_recaps')
          .select('*')
          .eq('competition_id', competitionId)
          .eq('week_number', weekNumber)
          .eq('published', true)
          .maybeSingle();
        if (e) return error(e.message);
        return json(data);
      }

      case 'get_latest_recap': {
        const { competitionId } = payload;
        if (!competitionId) return error('competitionId is required');
        const { data, error: e } = await supabase
          .from('weekly_recaps')
          .select('*')
          .eq('competition_id', competitionId)
          .eq('published', true)
          .order('week_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (e) return error(e.message);
        return json(data);
      }

      case 'get_all_recaps': {
        const { competitionId } = payload;
        if (!competitionId) return error('competitionId is required');
        const { data, error: e } = await supabase
          .from('weekly_recaps')
          .select('id, competition_id, week_number, headline, stats, generated_at, published')
          .eq('competition_id', competitionId)
          .order('week_number', { ascending: false });
        if (e) return error(e.message);
        return json(data || []);
      }

      case 'trigger_results_check': {
        const { adminRole, betId } = payload;
        if (!adminRole) return error('Admin access required', 403);
        if (betId && isUUID(betId) !== null) return error('Invalid betId.');
        let bgStatus = null, bgErr = null;
        try { bgStatus = await triggerInternal('check-results-background', { betId: betId || null }); }
        catch (e) { bgErr = e.message; }
        await addAudit(adminRole, 'Results Check Triggered', betId ? `Bet ${betId}` : 'All pending bets',
          bgErr ? `Background trigger failed: ${bgErr}` : `Background settler invoked (HTTP ${bgStatus})`);
        if (bgErr) return error('Could not start results check: ' + bgErr, 502);
        return json({ success: true, message: `Results check started (HTTP ${bgStatus})`, bgStatus });
      }

      case 'generate_recap': {
        const { competitionId, weekNumber, adminRole } = payload;
        if (!adminRole) return error('Admin access required', 403);
        if (!competitionId) return error('competitionId is required');
        try {
          await triggerInternal('generate-recap-background', { competitionId, weekNumber: weekNumber || null });
        } catch (e) {
          return error('Could not start recap generation: ' + e.message, 502);
        }
        return json({ success: true, message: 'Recap generation started' });
      }

      default:
        return error(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error('Data function error:', err);
    return error(err.message, 500);
  }
};

// "$75", "75.50" → 7500 / 7550 cents; null if empty/invalid.
const dollarsToCents = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) || n <= 0 ? null : Math.round(n * 100);
};

// Helper: add audit log entry
const addAudit = async (adminRole, action, target, detail) => {
  await supabase.from('audit_log').insert({ admin_role: adminRole, action, target, detail });
};

// Helper: create admin notification
const createAdminNotif = async (type, title, message, data = {}) => {
  await supabase.from('admin_notifications').insert({ type, title, message, data });
};

// Helper: return the admin role if a valid admin token is present, else null.
const getAdminRole = (payload) => {
  try { return verifyAdminToken(payload.adminToken).role; }
  catch { return null; }
};

// Helper: generate random code (crypto-safe)
const { randomBytes } = require('crypto');
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const genCode = (len) => {
  const result = [];
  while (result.length < len) {
    const byte = randomBytes(1)[0];
    // Reject values that would cause modulo bias (256 % 36 = 4, so reject >= 252)
    if (byte < 252) result.push(CHARS[byte % 36]);
  }
  return result.join('');
};

