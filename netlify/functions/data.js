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
    // Verify admin token for all admin-only operations
    const ADMIN_ACTIONS = new Set([
      'get_all_competitions','get_all_teams','get_all_users','get_all_bets','get_audit_log',
      'create_competition','get_competition_requests','update_competition_request',
      'delete_competition','update_competition_status','update_competition','advance_week',
      'update_team','update_bet_result','update_bet_leg','reject_bet','correct_bet',
      'update_kyc','update_user','delete_user','add_audit',
      'get_admin_notifications','mark_notification_read','mark_all_notifications_read',
      'delete_team',
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
        const { name, pub, weeks, buyIn, maxTeams, startDate, endDate, isPrivate, adminRole } = payload;
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
        };
        let { data, error: e } = await supabase.from('competitions').insert(insertRow).select().single();
        if (e && e.message && e.message.includes('is_private')) {
          // Column not yet migrated — insert without it then patch
          const { is_private: _drop, ...rowWithout } = insertRow;
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
        const { data, error: e } = await supabase.from('competitions').update({ status }).eq('id', id).select().single();
        if (e) return error(e.message);
        await addAudit(adminRole, `Competition ${status}`, data.name, '');
        return json(data);
      }

      case 'update_competition': {
        const { id, name, pub, buyIn, maxTeams, startDate, endDate, isPrivate, adminRole } = payload;
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
        // Also remove from betting_order so they don't linger in the rotation
        await supabase.from('betting_order').delete()
          .eq('team_id', teamId).eq('user_id', userId);
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

      case 'create_additional_team': {
        const { userId, teamName, competitionCode, buyInMode } = payload;
        if (!userId)   return error('Not logged in');
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
            event_date: leg.eventDate || null,
            start_time: leg.startTime || null,
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
        const { legId, status, resultNote, adminRole } = payload;
        const { data, error: e } = await supabase.from('bet_legs').update({ status, result_note: resultNote, updated_at: new Date().toISOString() }).eq('id', legId).select('*, bets(id, teams(team_name))').single();
        if (e) return error(e.message);
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

        // Derive which competition week a bet belongs to from its upload timestamp.
        // Wednesday 12:00 AEST marks the boundary between weeks — same logic as the frontend.
        const calcWeekFromTimestamp = (submittedAt, compStartDate) => {
          if (!submittedAt || !compStartDate) return null;
          const AEST = 10 * 60 * 60 * 1000;
          const submittedAEST = new Date(submittedAt).getTime() + AEST;
          const startAEST    = new Date(compStartDate).getTime() + AEST;
          let boundary = new Date(startAEST);
          boundary.setUTCHours(12, 0, 0, 0);
          const daysToWed = (3 - boundary.getUTCDay() + 7) % 7;
          boundary = new Date(boundary.getTime() + daysToWed * 86400000);
          if (boundary.getTime() <= startAEST) boundary = new Date(boundary.getTime() + 7 * 86400000);
          if (submittedAEST < boundary.getTime()) return 1;
          return Math.floor((submittedAEST - boundary.getTime()) / (7 * 86400000)) + 2;
        };

        // Compute overall_status from actual leg statuses — keeps display in sync
        // even if the DB overall_status column hasn't been written yet
        const deriveLegStatus = (legs) => {
          if (!legs?.length) return 'pending';
          const settled = ['won', 'lost', 'void'];
          if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
          if (legs.some(l => l.status === 'pending'))     return 'pending';
          if (!legs.every(l => settled.includes(l.status))) return 'pending';
          if (legs.every(l => l.status === 'won'))  return 'won';
          if (legs.some(l => l.status === 'lost'))  return 'lost';
          return 'partial'; // all void or mixed won/void
        };

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
                // Re-derive status from legs so it's always accurate
                overall_status: b.bet_legs?.length ? deriveLegStatus(b.bet_legs) : (b.overall_status || 'pending'),
                // Sort legs by leg_number
                bet_legs: (b.bet_legs || []).slice().sort((a, b) => (a.leg_number || 0) - (b.leg_number || 0)),
              }))
              .sort((a, b) => (b.week_number || 0) - (a.week_number || 0));

            const wonBets  = sortedBets.filter(b => b.overall_status === 'won');
            const totalWon = wonBets.reduce((sum, b) => sum + (b.estimated_return || 0), 0);
            const weekBet  = sortedBets.find(b => b.week_number === currentWeek);
            const weekHistory = Array.from({ length: currentWeek - 1 }, (_, i) => {
              const wb = sortedBets.find(b => b.week_number === i + 1);
              return wb?.overall_status === 'won' ? 'W' : wb?.overall_status === 'lost' ? 'L' : wb?.overall_status === 'partial' ? 'P' : '–';
            });
            return { ...team, bets: sortedBets, totalWon, totalWonFormatted: `$${(totalWon / 100).toLocaleString()}`, memberCount, currentWeekBet: weekBet || null, weekHistory };
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

// Helper: create admin notification
const createAdminNotif = async (type, title, message, data = {}) => {
  await supabase.from('admin_notifications').insert({ type, title, message, data });
};

// Helper: verify signed admin token
const verifyAdminToken = (token) => {
  const { createHmac } = require('crypto');
  if (!token) { const e = new Error('Admin token required'); e.status = 401; throw e; }
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) { const e = new Error('Admin auth not configured'); e.status = 500; throw e; }
  const dot = String(token).lastIndexOf('.');
  if (dot < 0) { const e = new Error('Invalid token format'); e.status = 401; throw e; }
  const payloadB64 = String(token).slice(0, dot);
  const sig        = String(token).slice(dot + 1);
  const expected   = createHmac('sha256', secret).update(payloadB64).digest('hex');
  if (sig !== expected) { const e = new Error('Invalid admin token'); e.status = 401; throw e; }
  let claims;
  try { claims = JSON.parse(Buffer.from(payloadB64, 'base64').toString()); }
  catch(_) { const e = new Error('Invalid token payload'); e.status = 401; throw e; }
  if (!claims.exp || Date.now() > claims.exp) { const e = new Error('Admin session expired, please log in again'); e.status = 401; throw e; }
  return claims;
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

