// netlify/functions/check-results.js
// Callable via POST /api/check-results from the frontend (26-second timeout).
// Handles ONE bet at a time (betId required for production use).
// Uses the same v9 two-step pipeline as the background function:
//   Step 1 — Sonnet + web search → prose summary
//   Step 2 — Haiku + forced tool_use → structured settlement JSON

const { createClient } = require('@supabase/supabase-js');

const HEADERS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type, Authorization',
};

const UNSETTLED = ['pending', 'in_progress'];
const VERSION   = 'v9-two-step-haiku-tool';

// Step 1: Sonnet + web search → prose summary only
// Multi-turn loop handles both server-side (web_search_20250305) and any
// stop_reason='tool_use' continuation that requires a follow-up message.
async function searchForResults(apiKey, searchPrompt) {
  const SEARCH_HEADERS = {
    'Content-Type':      'application/json',
    'x-api-key':         apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta':    'web-search-2025-03-05',
  };

  let messages = [{ role: 'user', content: searchPrompt }];

  for (let turn = 0; turn < 5; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: SEARCH_HEADERS,
      body: JSON.stringify({
        model:    'claude-sonnet-4-6',
        max_tokens: 1024,
        tools:    [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Anthropic API ${res.status}`);

    const types = (data.content || []).map(b => b.type).join(', ');
    console.log(`[check-results] Search turn ${turn + 1}: stop_reason=${data.stop_reason}, content=[${types}]`);

    // Extract any text blocks in this response
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    if (data.stop_reason === 'end_turn') {
      const text = textBlocks.map(b => b.text).join('\n');
      console.log('[check-results] Search summary:', text?.slice(0, 600));
      return text || null;
    }

    if (data.stop_reason === 'tool_use') {
      // Add assistant's turn to messages, then provide empty tool_results so
      // the conversation can continue to the final text response.
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        {
          role: 'user',
          content: toolUseBlocks.map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: `Tool ${b.name} called with: ${JSON.stringify(b.input || {}).slice(0, 200)}`,
          })),
        },
      ];
      continue;
    }

    // Any other stop reason — return whatever text we have
    const text = textBlocks.map(b => b.text).join('\n');
    return text || null;
  }

  return null;
}

// Step 2: Haiku (separate rate limit) + forced record_settlements tool → structured JSON
async function settleLegs(apiKey, summary, legs) {
  const legList = legs.map(l =>
    `Leg ${l.leg_number}: "${l.selection}" | ${l.event} | ${l.market}`
  ).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:       'claude-haiku-4-5-20251001',
      max_tokens:  512,
      tools: [{
        name:        'record_settlements',
        description: 'Settle bet legs',
        input_schema: {
          type: 'object',
          properties: {
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  legNumber:  { type: 'number' },
                  status:     { type: 'string', enum: ['won','lost','pending','void','in_progress'] },
                  result:     { type: 'string' },
                  confidence: { type: 'number', description: '0-100. How confident are you the result is correct based on the search summary? Set status to pending if confidence < 80.' },
                },
                required: ['legNumber','status','result','confidence'],
              },
            },
          },
          required: ['legs'],
        },
      }],
      tool_choice: { type: 'tool', name: 'record_settlements' },
      messages: [{
        role:    'user',
        content: `Summary:\n${summary}\n\nLegs:\n${legList}\n\nSettle each leg using ONLY the official scorer list as the source of truth. Rules:\n- Try/goal scorer bets: name appears in official scorer list → won; name absent from official scorer list AND match is finished → lost. Commentary, assists, near-misses, or play descriptions do NOT count — only the official scorer list.\n- Match winner bets: settle on final score.\n- If the official scorer list is unavailable or match is not finished → pending.\n- Set confidence 0-100 based solely on how clearly the official scorer list supports the result. If confidence < 80, use status=pending.`,
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Haiku API ${res.status}`);

  const types = (data.content || []).map(b => b.type).join(', ');
  console.log(`[check-results] Settle: stop_reason=${data.stop_reason}, content=[${types}]`);

  const toolCall = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'record_settlements');
  if (!toolCall?.input?.legs?.length) {
    console.error('[check-results] Haiku did not call record_settlements:', JSON.stringify(data.content).slice(0, 300));
    return null;
  }

  console.log('[check-results] Settled:', JSON.stringify(toolCall.input.legs));
  return toolCall.input.legs;
}

exports.handler = async (event) => {
  if (event?.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  let bodyStr = event?.body || '';
  if (event?.isBase64Encoded) bodyStr = Buffer.from(bodyStr, 'base64').toString('utf-8');

  let betId = null;
  try { betId = bodyStr ? JSON.parse(bodyStr)?.betId || null : null; } catch (_) {}
  console.log(`[check-results] ${VERSION} — Starting check${betId ? ` for bet ${betId}` : ' (all)'}`);

  if (!process.env.SUPABASE_URL)              return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'SUPABASE_URL missing' }) };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY missing' }) };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY missing' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date();
    const aestDate = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const todayStr = `${aestDate.getUTCFullYear()}-${pad(aestDate.getUTCMonth()+1)}-${pad(aestDate.getUTCDate())}`;
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    let betsQuery = supabase.from('bets').select('id, overall_status, team_id, bet_legs(*)');
    if (betId) {
      betsQuery = betsQuery.eq('id', betId);
    } else {
      betsQuery = betsQuery
        .or(`overall_status.in.(${[...UNSETTLED, 'partial'].join(',')}),submitted_at.gte.${fourteenDaysAgo}`)
        .order('submitted_at', { ascending: false });
    }
    const { data: bets, error: betsErr } = await betsQuery;

    if (betsErr) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: betsErr.message }) };
    if (!bets?.length) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0, message: 'No unsettled bets' }) };

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;
    const debugLog = [];

    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) { console.log(`[check-results] Bet ${bet.id} all settled`); continue; }

      if (!betId) {
        const hasStarted = unsettledLegs.some(l => {
          if (!l.event_date) return true;
          const t = l.start_time ? l.start_time.substring(0, 5) : '00:00';
          const start = new Date(`${l.event_date}T${t}:00+10:00`);
          return !isNaN(start.getTime()) && start.getTime() <= now.getTime();
        });
        if (!hasStarted) { console.log(`[check-results] Bet ${bet.id} not started yet`); continue; }
      }

      const legs = bet.bet_legs || [];
      // Only search for unsettled legs — already won/lost legs don't need re-searching
      const legsToSearch = unsettledLegs.map(l => {
        const d = l.event_date ? ` on ${l.event_date}` : '';
        return `Leg ${l.leg_number}: "${l.selection}" | ${l.event} | ${l.market}${d}`;
      }).join('\n');

      const year = aestDate.getUTCFullYear();
      const searchPrompt = `Today is ${todayStr} AEST. For each match below, find the OFFICIAL post-match try/goal scorer list — not commentary, not play-by-play, not social media. Use the official NRL, AFL, or league match centre, or a major sports data provider. Report the final score and the complete official scorer list exactly as published. Do not infer scorers from match commentary or assist descriptions — only the official scorer list counts.

${legsToSearch}

For every match: state the final score and list every try/goal scorer by name as recorded in the official match result. If the official scorer list is not yet available or the match has not finished, say so explicitly.`;

      console.log(`[check-results] Step 1 — searching for bet ${bet.id} (${legs.length} legs)...`);
      let summary;
      try {
        summary = await searchForResults(apiKey, searchPrompt);
      } catch (e) {
        console.error(`[check-results] Search error bet ${bet.id}:`, e.message);
        debugLog.push({ betId: bet.id, error: e.message });
        continue;
      }
      if (!summary) {
        console.warn(`[check-results] No search summary for bet ${bet.id}`);
        debugLog.push({ betId: bet.id, error: 'No search summary returned' });
        continue;
      }

      console.log(`[check-results] Step 2 — settling bet ${bet.id}...`);
      let updates;
      try {
        updates = await settleLegs(apiKey, summary, unsettledLegs);
      } catch (e) {
        console.error(`[check-results] Settle error bet ${bet.id}:`, e.message);
        debugLog.push({ betId: bet.id, error: e.message });
        continue;
      }
      if (!updates?.length) {
        console.warn(`[check-results] No settlements returned for bet ${bet.id}`);
        debugLog.push({ betId: bet.id, error: 'No settlements returned' });
        continue;
      }

      debugLog.push({ betId: bet.id, updates });

      for (const u of updates) {
        const legNum  = u.legNumber ?? u.leg_number;
        const origLeg = legs.find(l => Number(l.leg_number) === Number(legNum));
        if (!origLeg) { console.warn(`[check-results] No leg for legNumber=${legNum}`); continue; }
        if (!UNSETTLED.includes(origLeg.status)) { console.log(`[check-results] Leg ${legNum} already settled as "${origLeg.status}", skipping`); continue; }
        if (origLeg.status === u.status) { console.log(`[check-results] Leg ${legNum} already "${u.status}"`); continue; }
        const confidence = typeof u.confidence === 'number' ? u.confidence : 100;
        if (confidence < 80 && !UNSETTLED.includes(u.status)) {
          console.log(`[check-results] Leg ${legNum} confidence too low (${confidence}%) to settle as "${u.status}" — keeping pending`);
          continue;
        }

        console.log(`[check-results] Updating leg ${legNum}: "${origLeg.status}" → "${u.status}"`);
        const { error: legErr } = await supabase
          .from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (legErr) {
          console.error(`[check-results] DB error leg ${legNum}:`, legErr.message);
        } else {
          totalLegsUpdated++;
          console.log(`[check-results] ✓ Leg ${legNum} → "${u.status}": ${u.result}`);
        }
      }

      const updatedLegs = legs.map(l => {
        const u = updates.find(x => Number(x.legNumber ?? x.leg_number) === Number(l.leg_number));
        return u ? { ...l, status: u.status } : l;
      });
      const settled    = ['won','lost','void'];
      const allDone    = updatedLegs.every(l => settled.includes(l.status));
      const allWon     = updatedLegs.every(l => l.status === 'won');
      const anyLost    = updatedLegs.some(l  => l.status === 'lost');
      const anyLive    = updatedLegs.some(l  => l.status === 'in_progress');
      const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';

      if (newOverall !== bet.overall_status) {
        const { error: betErr } = await supabase.from('bets').update({ overall_status: newOverall }).eq('id', bet.id);
        if (betErr) console.error(`[check-results] DB error bet:`, betErr.message);
        else { totalBetsUpdated++; console.log(`[check-results] ✓ Bet ${bet.id} overall → "${newOverall}"`); }
      }
    }

    console.log(`[check-results] Done — ${totalLegsUpdated} legs, ${totalBetsUpdated} bets updated`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: totalLegsUpdated, betsUpdated: totalBetsUpdated, debug: debugLog }) };
  } catch (err) {
    console.error('[check-results] Unexpected error:', err.stack || err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
