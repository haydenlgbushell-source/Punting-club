// netlify/functions/check-results-background.js
// Background function — Netlify returns 202 immediately; this runs up to 15 min.
// Triggered on schedule (every 3 hours) and manually via POST /api/check-results.

const { createClient } = require('@supabase/supabase-js');

const UNSETTLED = ['pending', 'in_progress'];

async function callClaudeWithSearch(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'web-search-2025-03-05',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Anthropic API error ${res.status}`);

  return data.content?.find(b => b.type === 'text')?.text || null;
}

function parseJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

exports.handler = async () => {
  console.log('[check-results] Starting bet result check (background)');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[check-results] Missing Supabase env vars');
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date();
    // AEST = UTC+10 — avoid Intl timezone dependency
    const aestDate = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const todayStr = aestDate.toUTCString().replace(/ GMT$/, ' AEST');
    const timeStr  = `${pad(aestDate.getUTCHours())}:${pad(aestDate.getUTCMinutes())} AEST`;

    const { data: bets, error: betsErr } = await supabase
      .from('bets')
      .select('id, overall_status, team_id, bet_legs(*)')
      .in('overall_status', [...UNSETTLED, 'partial'])
      .order('submitted_at', { ascending: false });

    if (betsErr) { console.error('[check-results] DB fetch error:', betsErr.message); return; }
    if (!bets?.length) { console.log('[check-results] No unsettled bets found'); return; }

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;

    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) continue;

      const hasStartedEvent = unsettledLegs.some(l => {
        if (!l.event_date) return true;
        const t = l.start_time ? l.start_time.substring(0, 5) : '00:00';
        const eventStart = new Date(`${l.event_date}T${t}`);
        return !isNaN(eventStart.getTime()) && eventStart.getTime() <= now.getTime();
      });
      if (!hasStartedEvent) continue;

      const desc = (bet.bet_legs || []).map(l => {
        const datePart = l.event_date ? ` on ${l.event_date}${l.start_time ? ' at ' + l.start_time + ' AEST' : ''}` : '';
        return `Leg ${l.leg_number}: "${l.selection}" — ${l.event} — ${l.market} @ ${l.odds}${datePart} — current status: ${l.status}`;
      }).join('\n');

      const prompt = `Today is ${todayStr} at ${timeStr} AEST (Australian Eastern Standard Time).

You must determine the outcome of the following Australian sports bet legs. Use web search to look up the actual match results for any events that should have already taken place.

Bet legs:
${desc}

Instructions:
- Search the web for the actual result of each event/match by name and date
- Mark "won" if the selection won (team won, scored over line, etc.)
- Mark "lost" if the selection lost
- Mark "void" if the match was cancelled, postponed, or abandoned
- Mark "in_progress" if the event has started but is still ongoing right now
- Mark "pending" only if the event clearly hasn't started yet

Return ONLY a valid JSON array — no other text, no markdown fences:
[{"legNumber":1,"status":"won|lost|void|in_progress|pending","result":"brief result note e.g. 'Team A won 24-18'"}]`;

      let responseText;
      try {
        responseText = await callClaudeWithSearch(prompt);
      } catch (e) {
        console.error('[check-results] Claude error:', e.message);
        continue;
      }
      if (!responseText) continue;

      const updates = parseJSON(responseText);
      if (!Array.isArray(updates)) {
        console.warn('[check-results] Could not parse Claude response:', responseText?.slice(0, 200));
        continue;
      }

      for (const u of updates) {
        const origLeg = (bet.bet_legs || []).find(l => l.leg_number === u.legNumber);
        if (!origLeg || origLeg.status === u.status) continue;
        const { error: legErr } = await supabase
          .from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (legErr) console.error('[check-results] Leg update error:', legErr.message);
        else {
          totalLegsUpdated++;
          console.log(`[check-results] Leg ${u.legNumber} updated to "${u.status}": ${u.result}`);
        }
      }

      const updatedLegs = (bet.bet_legs || []).map(l => {
        const u = updates.find(x => x.legNumber === l.leg_number);
        return u ? { ...l, status: u.status } : l;
      });
      const settled    = ['won', 'lost', 'void'];
      const allDone    = updatedLegs.every(l => settled.includes(l.status));
      const allWon     = updatedLegs.every(l => l.status === 'won');
      const anyLost    = updatedLegs.some(l => l.status === 'lost');
      const anyLive    = updatedLegs.some(l => l.status === 'in_progress');
      const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';

      if (newOverall !== bet.overall_status) {
        const { error: betErr } = await supabase
          .from('bets')
          .update({ overall_status: newOverall })
          .eq('id', bet.id);
        if (betErr) console.error('[check-results] Bet update error:', betErr.message);
        else {
          totalBetsUpdated++;
          console.log(`[check-results] Bet ${bet.id} updated to "${newOverall}"`);
        }
      }
    }

    console.log(`[check-results] Done — ${totalLegsUpdated} legs updated, ${totalBetsUpdated} bets updated`);
  } catch (err) {
    console.error('[check-results] Unexpected error:', err.stack || err);
  }
};
