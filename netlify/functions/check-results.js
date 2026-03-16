// netlify/functions/check-results.js
// Scheduled function — runs every 3 hours to auto-check pending bet results via Claude AI.
// Netlify schedule is configured in netlify.toml: schedule = "0 */3 * * *"

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UNSETTLED = ['pending', 'in_progress'];

/**
 * Call Claude with web search enabled.
 * Uses a multi-turn loop to handle any tool_use blocks the model may emit
 * before it produces a final text response.
 */
async function callClaudeWithSearch(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  let messages = [{ role: 'user', content: prompt }];

  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 1024,
        tools,
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Anthropic API error ${res.status}`);

    // Final answer — extract the text block
    if (data.stop_reason === 'end_turn') {
      return data.content?.find(b => b.type === 'text')?.text || null;
    }

    // Model wants to use a tool — feed tool_results back and continue
    if (data.stop_reason === 'tool_use') {
      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        {
          role: 'user',
          content: data.content
            .filter(b => b.type === 'tool_use')
            .map(b => ({
              type:        'tool_result',
              tool_use_id: b.id,
              content:     `Search for "${b.input?.query || ''}" was executed.`,
            })),
        },
      ];
      continue;
    }

    // Any other stop reason — still try to return a text block if present
    return data.content?.find(b => b.type === 'text')?.text || null;
  }

  return null; // gave up after max turns
}

function parseJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

exports.handler = async () => {
  console.log('[check-results] Starting scheduled bet result check');
  const now = new Date();
  const todayStr  = now.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr   = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' });

  try {
    // Fetch all bets with unsettled legs
    const { data: bets, error: betsErr } = await supabase
      .from('bets')
      .select('id, overall_status, team_id, bet_legs(*)')
      .in('overall_status', [...UNSETTLED, 'partial'])
      .order('submitted_at', { ascending: false });

    if (betsErr) { console.error('[check-results] DB fetch error:', betsErr.message); return { statusCode: 500, body: JSON.stringify({ error: betsErr.message }) }; }
    if (!bets?.length) { console.log('[check-results] No unsettled bets found'); return { statusCode: 200, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0 }) }; }

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;

    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) continue;

      // Only check bets where at least one event should have started
      const hasStartedEvent = unsettledLegs.some(l => {
        if (!l.event_date) return true; // no date stored — always check
        const timeStr = l.start_time ? l.start_time.substring(0, 5) : '00:00';
        const eventStart = new Date(`${l.event_date}T${timeStr}`);
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
      } catch(e) {
        console.error('[check-results] Claude error:', e.message);
        continue;
      }
      if (!responseText) continue;

      const updates = parseJSON(responseText);
      if (!Array.isArray(updates)) {
        console.warn('[check-results] Could not parse Claude response:', responseText?.slice(0, 200));
        continue;
      }

      // Update each changed leg in DB
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

      // Recalculate overall bet status from updated legs
      const updatedLegs = (bet.bet_legs || []).map(l => {
        const u = updates.find(x => x.legNumber === l.leg_number);
        return u ? { ...l, status: u.status } : l;
      });
      const settled   = ['won', 'lost', 'void'];
      const allDone   = updatedLegs.every(l => settled.includes(l.status));
      const allWon    = updatedLegs.every(l => l.status === 'won');
      const anyLost   = updatedLegs.some(l => l.status === 'lost');
      const anyLive   = updatedLegs.some(l => l.status === 'in_progress');
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
    return { statusCode: 200, body: JSON.stringify({ legsUpdated: totalLegsUpdated, betsUpdated: totalBetsUpdated }) };
  } catch (err) {
    console.error('[check-results] Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
