// netlify/functions/generate-recap-background.js
// Scheduled background function — runs every Wednesday 04:00 UTC (14:00 AEST),
// 2 hours after the Wed 12:00 AEST betting deadline.
// Generates AI-powered weekly recaps for each active competition.

const { createClient } = require('@supabase/supabase-js');

const VERSION = 'v1-weekly-recap';

const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

function calcCurrentWeek(startDate) {
  if (!startDate) return 1;
  const nowAEST   = Date.now() + AEST_OFFSET_MS;
  const startAEST = new Date(startDate).getTime() + AEST_OFFSET_MS;
  let boundary = new Date(startAEST);
  boundary.setUTCHours(12, 0, 0, 0);
  const daysToWed = (3 - boundary.getUTCDay() + 7) % 7;
  boundary = new Date(boundary.getTime() + daysToWed * 86400000);
  if (boundary.getTime() <= startAEST) boundary = new Date(boundary.getTime() + 7 * 86400000);
  if (nowAEST < boundary.getTime()) return 1;
  return Math.floor((nowAEST - boundary.getTime()) / (7 * 86400000)) + 2;
}

function calcWeekFromTimestamp(submittedAt, compStartDate) {
  if (!submittedAt || !compStartDate) return null;
  const submittedAEST = new Date(submittedAt).getTime() + AEST_OFFSET_MS;
  const startAEST     = new Date(compStartDate).getTime() + AEST_OFFSET_MS;
  let boundary = new Date(startAEST);
  boundary.setUTCHours(12, 0, 0, 0);
  const daysToWed = (3 - boundary.getUTCDay() + 7) % 7;
  boundary = new Date(boundary.getTime() + daysToWed * 86400000);
  if (boundary.getTime() <= startAEST) boundary = new Date(boundary.getTime() + 7 * 86400000);
  if (submittedAEST < boundary.getTime()) return 1;
  return Math.floor((submittedAEST - boundary.getTime()) / (7 * 86400000)) + 2;
}

function deriveLegStatus(legs) {
  if (!legs?.length) return 'pending';
  if (legs.some(l => l.status === 'in_progress')) return 'in_progress';
  if (legs.some(l => l.status === 'pending'))     return 'pending';
  const settled = ['won', 'lost', 'void'];
  if (!legs.every(l => settled.includes(l.status))) return 'pending';
  if (legs.every(l => l.status === 'won'))  return 'won';
  if (legs.some(l => l.status === 'lost'))  return 'lost';
  return 'partial';
}

function formatCents(cents) {
  return '$' + (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 });
}

async function generateRecapHTML(apiKey, comp, weekNumber, weekData, seasonStandings) {
  const prompt = `You are the Punting Club weekly match reporter. Write a punchy, pub-friendly weekly recap.

Competition: ${comp.name}${comp.pub ? ` at ${comp.pub}` : ''}
Week: ${weekNumber} of ${comp.weeks || 8}

WEEK ${weekNumber} RESULTS:
${weekData.map(d => {
  if (!d.bet) return `• ${d.teamName}: No bet submitted`;
  const status = d.bet.overall_status;
  const legs = (d.bet.bet_legs || []).map(l => `${l.selection} (${l.status})`).join(', ');
  return `• ${d.teamName}: ${status.toUpperCase()} — ${d.bet.bet_type} @ ${d.bet.combined_odds || '?'} odds — Stake ${formatCents(d.bet.stake)} → Return ${formatCents(d.bet.estimated_return)} — Legs: ${legs}`;
}).join('\n')}

SEASON STANDINGS (after Week ${weekNumber}):
${seasonStandings.map((t, i) => `${i + 1}. ${t.teamName} — ${formatCents(t.totalWon)}`).join('\n')}

RULES:
- Output ONLY the HTML content (no wrapping <html>, <body>, or <style> tags)
- Use Tailwind CSS classes for all styling
- Include: a bold headline, biggest win callout, hard-luck story (if any losses), leaderboard movers, season summary
- Tone: fun Australian pub banter, sports language, keep it under 300 words
- Use these color conventions: green for wins, red for losses, brand-600 (#1a5632) for highlights
- Structure with clear sections using headers, no bullet lists — make it read like a match report
- Wrap the entire output in a single <div> with class "space-y-4"`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Claude API ${res.status}`);

  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return text.trim();
}

exports.handler = async (event) => {
  console.log(`[generate-recap] ${VERSION} — Starting`);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[generate-recap] Missing Supabase env vars');
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[generate-recap] Missing ANTHROPIC_API_KEY');
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Allow manual trigger for a specific competition/week
    let manualCompId = null;
    let manualWeek   = null;
    if (event?.body) {
      try {
        const body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body);
        manualCompId = body.competitionId || null;
        manualWeek   = body.weekNumber    || null;
      } catch (_) {}
    }

    // Get active competitions
    let compQuery = supabase.from('competitions').select('*').eq('status', 'active');
    if (manualCompId) compQuery = compQuery.eq('id', manualCompId);
    const { data: competitions, error: compErr } = await compQuery;
    if (compErr) { console.error('[generate-recap] DB error:', compErr.message); return; }
    if (!competitions?.length) { console.log('[generate-recap] No active competitions'); return; }

    let recapsGenerated = 0;

    for (const comp of competitions) {
      const currentWeek = calcCurrentWeek(comp.start_date);
      const recapWeek   = manualWeek || (currentWeek > 1 ? currentWeek - 1 : null);
      if (!recapWeek) {
        console.log(`[generate-recap] ${comp.name}: Week 1, no previous week to recap`);
        continue;
      }

      // Check if recap already exists for this week
      const { data: existing } = await supabase
        .from('weekly_recaps')
        .select('id')
        .eq('competition_id', comp.id)
        .eq('week_number', recapWeek)
        .maybeSingle();

      if (existing && !manualCompId) {
        console.log(`[generate-recap] ${comp.name} Week ${recapWeek}: already generated, skipping`);
        continue;
      }

      // Fetch all teams + bets for this competition
      const { data: teams, error: teamsErr } = await supabase
        .from('teams')
        .select(`
          id, team_name, team_code, status,
          team_members(user_id, role, users(first_name, last_name)),
          bets(id, overall_status, stake, estimated_return, week_number, bet_type, combined_odds, submitted_at, submitted_by, bet_legs(*))
        `)
        .eq('competition_id', comp.id)
        .neq('status', 'suspended');

      if (teamsErr) {
        console.error(`[generate-recap] Error fetching teams for ${comp.name}:`, teamsErr.message);
        continue;
      }
      if (!teams?.length) {
        console.log(`[generate-recap] ${comp.name}: no teams`);
        continue;
      }

      // Build per-team data with derived week numbers
      const enrichedTeams = teams.map(team => {
        const bets = (team.bets || []).map(b => ({
          ...b,
          week_number: comp.start_date && b.submitted_at
            ? calcWeekFromTimestamp(b.submitted_at, comp.start_date)
            : (b.week_number || 1),
          overall_status: b.bet_legs?.length ? deriveLegStatus(b.bet_legs) : (b.overall_status || 'pending'),
          bet_legs: (b.bet_legs || []).sort((a, b) => (a.leg_number || 0) - (b.leg_number || 0)),
        }));

        const wonBets  = bets.filter(b => b.overall_status === 'won');
        const totalWon = wonBets.reduce((sum, b) => sum + (b.estimated_return || 0), 0);
        const weekBet  = bets.find(b => b.week_number === recapWeek) || null;

        return { teamName: team.team_name, bets, totalWon, bet: weekBet };
      });

      // Week data for the recap week
      const weekData = enrichedTeams.map(t => ({
        teamName: t.teamName,
        bet:      t.bet,
      }));

      // Season standings sorted by total winnings
      const seasonStandings = enrichedTeams
        .map(t => ({ teamName: t.teamName, totalWon: t.totalWon }))
        .sort((a, b) => b.totalWon - a.totalWon);

      // Check if there are any settled bets to recap
      const settledBets = weekData.filter(d => d.bet && ['won', 'lost', 'partial'].includes(d.bet.overall_status));
      if (settledBets.length === 0 && !manualCompId) {
        console.log(`[generate-recap] ${comp.name} Week ${recapWeek}: no settled bets yet, skipping`);
        continue;
      }

      // Build stats
      const winners = weekData.filter(d => d.bet?.overall_status === 'won');
      const losers  = weekData.filter(d => d.bet?.overall_status === 'lost');
      const noBet   = weekData.filter(d => !d.bet);
      const biggestWin = winners.sort((a, b) => (b.bet.estimated_return || 0) - (a.bet.estimated_return || 0))[0] || null;
      const totalPot = seasonStandings.reduce((sum, t) => sum + t.totalWon, 0);

      const stats = {
        winners:    winners.length,
        losers:     losers.length,
        noBet:      noBet.length,
        winRate:    settledBets.length > 0 ? Math.round((winners.length / settledBets.length) * 100) : null,
        biggestWin: biggestWin ? { team: biggestWin.teamName, amount: biggestWin.bet.estimated_return } : null,
        totalPot,
        leader:     seasonStandings[0] || null,
      };

      console.log(`[generate-recap] Generating recap for ${comp.name} Week ${recapWeek}...`);

      // Rate-limit between competitions
      if (recapsGenerated > 0) {
        console.log('[generate-recap] Waiting 5s between recaps...');
        await new Promise(r => setTimeout(r, 5000));
      }

      let html;
      try {
        html = await generateRecapHTML(apiKey, comp, recapWeek, weekData, seasonStandings);
      } catch (e) {
        console.error(`[generate-recap] Claude error for ${comp.name}:`, e.message);
        continue;
      }

      if (!html) {
        console.warn(`[generate-recap] Empty response for ${comp.name} Week ${recapWeek}`);
        continue;
      }

      // Extract headline from the HTML (first h2 or h3 text content)
      const headlineMatch = html.match(/<h[23][^>]*>(.*?)<\/h[23]>/i);
      const headline = headlineMatch
        ? headlineMatch[1].replace(/<[^>]*>/g, '').trim()
        : `Week ${recapWeek} Recap`;

      // Upsert the recap (update if manually re-triggered)
      const { error: upsertErr } = await supabase
        .from('weekly_recaps')
        .upsert({
          competition_id: comp.id,
          week_number:    recapWeek,
          headline,
          summary_html:   html,
          stats,
          generated_at:   new Date().toISOString(),
          published:      true,
        }, { onConflict: 'competition_id,week_number' });

      if (upsertErr) {
        console.error(`[generate-recap] DB upsert error for ${comp.name}:`, upsertErr.message);
        continue;
      }

      recapsGenerated++;
      console.log(`[generate-recap] ✓ ${comp.name} Week ${recapWeek} recap published — "${headline}"`);

      // Create admin notification
      await supabase.from('admin_notifications').insert({
        type:    'weekly_recap',
        title:   `Weekly Recap: ${comp.name} Week ${recapWeek}`,
        message: headline,
        data:    { competitionId: comp.id, weekNumber: recapWeek },
      }).catch(() => {});
    }

    console.log(`[generate-recap] Done — ${recapsGenerated} recap(s) generated`);
  } catch (err) {
    console.error('[generate-recap] Unexpected error:', err.stack || err);
  }
};
