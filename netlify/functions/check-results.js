// netlify/functions/check-results.js
// Scheduled function — runs every 3 hours to auto-check pending bet results via Claude AI.
// Also callable manually via POST /api/check-results from the frontend.
// Netlify schedule is configured in netlify.toml: schedule = "0 */3 * * *"

const { createClient } = require('@supabase/supabase-js');

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UNSETTLED = ['pending', 'in_progress'];

/**
 * Call Claude with web search enabled.
 * Handles multi-turn: web_search_20250305 may return stop_reason "tool_use"
 * before giving the final "end_turn" text response.
 */
async function callClaudeWithSearch(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  let messages = [{ role: 'user', content: prompt }];

  for (let turn = 0; turn < 8; turn++) {
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
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Anthropic API error ${res.status}`);

    const contentTypes = (data.content || []).map(b => b.type).join(', ');
    console.log(`[check-results] Turn ${turn + 1}: stop_reason=${data.stop_reason}, content=[${contentTypes}]`);

    if (data.stop_reason === 'end_turn') {
      const text = data.content?.find(b => b.type === 'text')?.text || null;
      console.log('[check-results] Final text:', text?.slice(0, 500));
      return text;
    }

    if (data.stop_reason === 'tool_use') {
      // Continue the conversation — the search results will be incorporated on next turn
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      console.log('[check-results] Tool calls:', toolUseBlocks.map(b => `${b.name}(${JSON.stringify(b.input)?.slice(0, 100)})`).join(', '));
      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        {
          role: 'user',
          content: toolUseBlocks.map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: 'Search executed.',
          })),
        },
      ];
      continue;
    }

    // Any other stop reason — try to extract text
    const text = data.content?.find(b => b.type === 'text')?.text || null;
    console.log(`[check-results] Unexpected stop_reason=${data.stop_reason}, text:`, text?.slice(0, 200));
    return text;
  }

  console.warn('[check-results] Max turns reached without end_turn');
  return null;
}

function parseJSON(text) {
  if (!text) return null;
  // Try direct parse first (handles clean JSON or markdown-fenced JSON)
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); } catch {}
  // Extract a JSON array from within prose — Claude sometimes wraps it in explanation text
  const match = text.match(/\[[\s\S]*\]/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

exports.handler = async (event) => {
  if (event?.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  console.log('[check-results] Starting scheduled bet result check');

  if (!process.env.SUPABASE_URL)           return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'SUPABASE_URL not configured' }) };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date();
    // AEST = UTC+10, AEDT = UTC+11 — use fixed +10 offset to avoid Intl timezone issues
    const aestOffsetMs = 10 * 60 * 60 * 1000;
    const aestDate = new Date(now.getTime() + aestOffsetMs);
    const pad = n => String(n).padStart(2, '0');
    const todayStr = aestDate.toUTCString().replace(/ GMT$/, ' AEST');
    const timeStr  = `${pad(aestDate.getUTCHours())}:${pad(aestDate.getUTCMinutes())} AEST`;
    // Fetch all bets with unsettled legs
    const { data: bets, error: betsErr } = await supabase
      .from('bets')
      .select('id, overall_status, team_id, bet_legs(*)')
      .in('overall_status', [...UNSETTLED, 'partial'])
      .order('submitted_at', { ascending: false });

    if (betsErr) { console.error('[check-results] DB fetch error:', betsErr.message); return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: betsErr.message }) }; }
    if (!bets?.length) { console.log('[check-results] No unsettled bets found'); return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0 }) }; }

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;
    const debugResponses = [];

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

The following Australian sports bet legs need their results determined. All events listed are from the past — search the web to find the actual result for each one.

Bet legs:
${desc}

Search strategy:
- For each leg, search "[Team A] vs [Team B] result [date] NRL" or "[event] [date] result"
- For try-scorer props (e.g. "Player X 1+ Try Scorer"), search "[match name] try scorers [date]" and "[player name] try [match name]"
- For goal-scorer props (AFL, soccer), search "[player name] goal [match name] [date]"
- Check sites like nrl.com, foxsports.com.au, afl.com.au, espn.com.au, or Google Sports

Rules:
- If the event date has already passed, it MUST be marked won, lost, void, or in_progress — NOT pending
- Mark "won" if the selection was correct (team won, player scored the try/goal, etc.)
- Mark "lost" if the selection was incorrect
- Mark "void" if the match was cancelled/postponed/abandoned
- Mark "in_progress" ONLY if the match is literally happening right now
- Mark "pending" ONLY if the event is scheduled for the future and has NOT started

Result note format — include as much detail as possible:
- For match winner bets: final score and scoreline (e.g. "Broncos won 28-14 over Knights")
- For try-scorer bets: confirm if the player scored a try and list ALL try scorers for the match (e.g. "Ponga scored 2 tries. All try scorers: Ponga (2), Walsh (1), Luai (1)")
- For goal-scorer bets: confirm if the player scored and list ALL goal scorers (e.g. "Oliver scored 3 goals. Goal scorers: Oliver (3), Bontempelli (2), Treloar (1)")
- For any prop bet: state the final outcome relevant to the selection with key stats
- Always include the final score when available

Return ONLY a valid JSON array — no other text, no markdown fences:
[{"legNumber":1,"status":"won|lost|void|in_progress|pending","result":"e.g. Broncos won 28-14. Try scorers: Cobbo (2), Staggs (1), Selwyn (1)"}]`;

      let responseText;
      try {
        responseText = await callClaudeWithSearch(prompt);
      } catch(e) {
        console.error('[check-results] Claude error:', e.message);
        continue;
      }
      if (!responseText) { debugResponses.push({ betId: bet.id, error: 'no text from Claude' }); continue; }

      debugResponses.push({ betId: bet.id, response: responseText.slice(0, 500) });
      const updates = parseJSON(responseText);
      if (!Array.isArray(updates)) {
        console.warn('[check-results] Could not parse Claude response:', responseText?.slice(0, 300));
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
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: totalLegsUpdated, betsUpdated: totalBetsUpdated, debug: debugResponses }) };
  } catch (err) {
    console.error('[check-results] Unexpected error:', err.stack || err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
