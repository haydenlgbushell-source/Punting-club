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
        max_tokens: 2048,
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
      const toolUseBlocks    = (data.content || []).filter(b => b.type === 'tool_use');
      const toolResultBlocks = (data.content || []).filter(b => b.type === 'tool_result');
      // web_search_20250305: Anthropic executes the search server-side and returns the
      // results as tool_result blocks inside data.content. Strip them from the assistant
      // turn and re-attach as the user turn so Claude can read the real search data.
      const assistantContent = (data.content || []).filter(b => b.type !== 'tool_result');
      console.log('[check-results] Tool calls:', toolUseBlocks.map(b => `${b.name}(${JSON.stringify(b.input)?.slice(0, 100)})`).join(', '));
      if (toolResultBlocks.length) console.log(`[check-results] Passing ${toolResultBlocks.length} search result block(s) to Claude`);
      messages = [
        ...messages,
        { role: 'assistant', content: assistantContent },
        {
          role: 'user',
          content: toolUseBlocks.map(b => {
            const found = toolResultBlocks.find(r => r.tool_use_id === b.id);
            return found || { type: 'tool_result', tool_use_id: b.id, content: '' };
          }),
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

  // Optional betId in POST body — when provided, check only that single bet
  let betId = null;
  try { betId = event?.body ? JSON.parse(event.body)?.betId || null : null; } catch (_) {}
  console.log(`[check-results] Starting check${betId ? ` for bet ${betId}` : ' (all pending bets)'}`);

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

    // 14-day lookback: include any bet submitted in the past 14 days so that
    // last-week bets whose overall_status was already settled (but may still
    // have pending legs) are not silently excluded.
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // When betId is supplied fetch only that bet; otherwise fetch all unsettled
    // OR submitted in the past 14 days (to catch last-week bets)
    let betsQuery = supabase.from('bets').select('id, overall_status, team_id, bet_legs(*)');
    if (betId) {
      betsQuery = betsQuery.eq('id', betId);
    } else {
      betsQuery = betsQuery
        .or(`overall_status.in.(${[...UNSETTLED, 'partial'].join(',')}),submitted_at.gte.${fourteenDaysAgo}`)
        .order('submitted_at', { ascending: false });
    }
    const { data: bets, error: betsErr } = await betsQuery;

    if (betsErr) { console.error('[check-results] DB fetch error:', betsErr.message); return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: betsErr.message }) }; }
    if (!bets?.length) { console.log('[check-results] No unsettled bets found'); return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0 }) }; }

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;
    const debugResponses = [];

    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) continue;

      // Only skip the time-gate when running globally (betId check = user explicitly requested it)
      if (!betId) {
        const hasStartedEvent = unsettledLegs.some(l => {
          if (!l.event_date) return true;
          const t = l.start_time ? l.start_time.substring(0, 5) : '00:00';
          // Append AEST offset so the time is parsed correctly (not as UTC)
          const eventStart = new Date(`${l.event_date}T${t}:00+10:00`);
          return !isNaN(eventStart.getTime()) && eventStart.getTime() <= now.getTime();
        });
        if (!hasStartedEvent) continue;
      }

      const desc = (bet.bet_legs || []).map(l => {
        const datePart = l.event_date ? ` — event date approx ${l.event_date}${l.start_time ? ' at ' + l.start_time + ' AEST' : ''}` : '';
        return `Leg ${l.leg_number}: "${l.selection}" | ${l.event} | ${l.market} @ ${l.odds}${datePart} | current status: ${l.status}`;
      }).join('\n');

      const prompt = `Today is ${todayStr} at ${timeStr} AEST (Australian Eastern Standard Time).

You must find the verified, real-world result for each bet leg below by searching the web. Only update a leg if you can confirm the result from an authoritative source.

BET LEGS:
${desc}

SEARCH INSTRUCTIONS:
1. For each leg, search by TEAM NAMES + COMPETITION + YEAR, e.g. "Panthers vs Broncos NRL 2026 result"
2. The stored event date may be off by ±3 days — search across that window
3. For NRL: check nrl.com match centre first (it has official try scorers), then foxsports.com.au or leagueunlimited.com
4. For AFL: check afl.com.au match centre for official goal scorers
5. For scorer props (try/goal): find the COMPLETE official scorer list from the match report — do not rely on headlines alone
6. Perform at least 2 separate searches to cross-check your answer before deciding won/lost

RESULT RULES — READ CAREFULLY:
- ONLY mark "won" or "lost" if you have found a CONFIRMED final result from an official or major sports news source
- If you CANNOT find a confirmed result, mark "pending" — it is MUCH better to leave as pending than to guess wrong
- Do NOT assume a result — if searches return no clear match data, mark "pending"
- Mark "void" if the match was cancelled/postponed or the player was a late scratching
- Mark "in_progress" ONLY if the match is live right now
- For scorer bets: the player must appear in the OFFICIAL match scorer list — do not infer from match summaries

RESULT NOTE must always include:
- The confirmed FINAL SCORE (e.g. "Panthers 28 def Broncos 14")
- For scorer bets: the COMPLETE list of try/goal scorers and their counts from the official match report
- The source URL where you confirmed the result (e.g. "Source: nrl.com/draw/nrl-premiership/2026/round-2/panthers-v-broncos/")

Return ONLY a valid JSON array — no other text, no markdown fences:
[{"legNumber":1,"status":"won|lost|void|in_progress|pending","result":"Final score + scorer list + source URL"}]`;

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
        const origLeg = (bet.bet_legs || []).find(l => Number(l.leg_number) === Number(u.legNumber));
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
        const u = updates.find(x => Number(x.legNumber) === Number(l.leg_number));
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
