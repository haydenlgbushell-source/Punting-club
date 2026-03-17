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
  let lastText = null;

  for (let turn = 0; turn < 5; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-6',
        max_tokens:  1024,
        system:      'You are a sports bet settlement assistant. You MUST respond with ONLY a valid JSON array — no prose, no markdown, no explanation. The first character of your response must be [ and the last must be ].',
        tools:       [{ type: 'web_search_20250305', name: 'web_search' }],
        tool_choice: turn === 0 ? { type: 'any' } : { type: 'auto' },
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`[check-results] API error ${res.status}:`, JSON.stringify(data).slice(0, 300));
      throw new Error(data.error?.message || `Anthropic API error ${res.status}`);
    }

    const contentTypes = (data.content || []).map(b => b.type).join(', ');
    console.log(`[check-results] Turn ${turn + 1}: stop_reason=${data.stop_reason}, content=[${contentTypes}]`);

    if (data.stop_reason === 'end_turn') {
      // Concatenate all text blocks (Claude sometimes splits output across multiple)
      const text = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('') || null;
      console.log('[check-results] Final text:', text?.slice(0, 800));

      if (text && parseJSON(text)) return text;

      if (text) {
        lastText = text;
        messages = [
          ...messages,
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'Your response was not valid JSON. Output ONLY the JSON array now — no other text.' },
        ];
        continue;
      }
      return null;
    }

    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks    = (data.content || []).filter(b => b.type === 'tool_use');
      const toolResultBlocks = (data.content || []).filter(b => b.type === 'tool_result');
      const assistantContent = (data.content || []).filter(b => b.type !== 'tool_result');

      console.log('[check-results] Tool calls:', toolUseBlocks.map(b =>
        `${b.name}(${JSON.stringify(b.input)?.slice(0, 120)})`).join(', '));

      const userToolResults = toolUseBlocks.map(b => {
        const found = toolResultBlocks.find(r => r.tool_use_id === b.id);
        return found
          ? { type: 'tool_result', tool_use_id: b.id, content: found.content ?? '' }
          : { type: 'tool_result', tool_use_id: b.id, content: 'No search results returned.' };
      });

      messages = [
        ...messages,
        { role: 'assistant', content: assistantContent },
        { role: 'user',      content: userToolResults },
      ];
      continue;
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || null;
    console.warn(`[check-results] stop_reason=${data.stop_reason}, text:`, text?.slice(0, 200));
    if (text) return text;
  }

  console.warn('[check-results] Max turns reached. Last text:', lastText?.slice(0, 200));
  return lastText;
}

function parseJSON(text) {
  if (!text) return null;
  // Strip markdown fences and try direct parse
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // Find the FIRST '[' and walk the string counting brackets to find the matching ']'
  // This avoids the greedy regex bug where ']' inside result strings misleads the match.
  const start = cleaned.indexOf('[');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') { depth--; if (depth === 0 && ch === ']') {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch {}
        break;
      }}
    }
  }
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

You are settling Australian sports bet legs. Use the exact same logic a human would:

BET LEGS:
${desc}

STEP 1 — FIND EACH UNIQUE MATCH RESULT
The legs above may come from one or more matches. For each unique match (event), search:
  "[Team A] vs [Team B] NRL 2026 result" or "[Team A] vs [Team B] AFL 2026 result"
From the match report you need TWO things:
  a) The FINAL SCORE (e.g. "Knights 36 - Sea Eagles 16")
  b) The COMPLETE official try/goal scorer list with every player who scored (e.g. "Try scorers: Marzhew, Young, Hunt, Olakau'atu")
Search nrl.com match centre or a match report for the official scorer list — headlines alone are not enough.

STEP 2 — SETTLE EACH LEG USING THIS EXACT LOGIC

For "1+ Try" / "Anytime Try Scorer" bets:
  - Get the full try scorer list for that match
  - Is the named player in that list? YES → "won" / NO → "lost"
  - If the player was a confirmed late scratching (did not play) → "void"

For "Match Winner" / "Head to Head" bets:
  - Did the selected team win? YES → "won" / NO → "lost"

For "Handicap" / "Line" bets:
  - Apply the handicap to the final score. Does the selection win on handicap? YES → "won" / NO → "lost"

For "Over/Under" / "Total Points" bets:
  - Compare total points scored to the line. Over → "won" or "lost" depending on selection.

General rules:
  - "pending" ONLY if the match has not been played yet or you genuinely found zero match data
  - "in_progress" ONLY if the match is live right now
  - "void" ONLY if match cancelled, postponed, or player confirmed scratched before kick-off

STEP 3 — OUTPUT
Return ONLY a valid JSON array, no other text:
[{"legNumber":1,"status":"won|lost|void|in_progress|pending","result":"Final score + full scorer list + source URL"}]`;

      let responseText;
      try {
        responseText = await callClaudeWithSearch(prompt);
      } catch(e) {
        console.error('[check-results] Claude error:', e.message);
        continue;
      }
      if (!responseText) { debugResponses.push({ betId: bet.id, error: 'no text from Claude' }); continue; }

      debugResponses.push({ betId: bet.id, response: responseText.slice(0, 2000) });
      console.log('[check-results] Full Claude response:', responseText?.slice(0, 2000));

      const updates = parseJSON(responseText);
      if (!Array.isArray(updates)) {
        console.warn('[check-results] Could not parse Claude response as JSON array. Raw:', responseText?.slice(0, 500));
        debugResponses[debugResponses.length - 1].parseError = 'not a JSON array';
        continue;
      }
      console.log('[check-results] Parsed updates:', JSON.stringify(updates));
      debugResponses[debugResponses.length - 1].parsed = updates;

      // Update each changed leg in DB
      for (const u of updates) {
        // Accept both legNumber and leg_number from Claude
        const legNum = u.legNumber ?? u.leg_number;
        const origLeg = (bet.bet_legs || []).find(l => Number(l.leg_number) === Number(legNum));
        if (!origLeg) {
          console.warn(`[check-results] No matching leg for legNumber=${legNum}. DB legs:`, (bet.bet_legs||[]).map(l=>l.leg_number));
          continue;
        }
        if (origLeg.status === u.status) {
          console.log(`[check-results] Leg ${legNum} status unchanged (${u.status}) — skipping`);
          continue;
        }
        console.log(`[check-results] Updating leg ${legNum} from "${origLeg.status}" to "${u.status}"`);
        const { error: legErr } = await supabase
          .from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (legErr) {
          console.error('[check-results] Leg update DB error:', legErr.message, legErr);
        } else {
          totalLegsUpdated++;
          console.log(`[check-results] Leg ${legNum} updated to "${u.status}": ${u.result}`);
        }
      }

      // Recalculate overall bet status from updated legs
      const updatedLegs = (bet.bet_legs || []).map(l => {
        const u = updates.find(x => Number(x.legNumber ?? x.leg_number) === Number(l.leg_number));
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
