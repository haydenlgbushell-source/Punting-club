// netlify/functions/check-results.js
// Callable via POST /api/check-results from the frontend (26-second timeout).
// Handles ONE bet at a time (betId required for production use).
// Uses the same v9 two-step pipeline as the background function:
//   Step 1 — Sonnet + web search → prose summary
//   Step 2 — Haiku + forced tool_use → structured settlement JSON

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN = process.env.URL || process.env.ALLOWED_ORIGIN || '*';
const HEADERS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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
                  legNumber: { type: 'number' },
                  status:    { type: 'string', enum: ['won','lost','pending','void','in_progress'] },
                  result:    { type: 'string' },
                },
                required: ['legNumber','status','result'],
              },
            },
          },
          required: ['legs'],
        },
      }],
      tool_choice: { type: 'tool', name: 'record_settlements' },
      messages: [{
        role:    'user',
        content: `Summary:\n${summary}\n\nLegs:\n${legList}\n\nSettle: scorer in list→won, not in list→lost, winner bet→won/lost, no result→pending.`,
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

    if (betId) {
      // ── SINGLE BET MODE ────────────────────────────────────────────────────
      const bet = bets[0];
      const legs = bet.bet_legs || [];
      const unsettledLegs = legs.filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) {
        console.log(`[check-results] Bet ${bet.id} already fully settled`);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0, message: 'Bet already settled' }) };
      }

      const legsToSearch = unsettledLegs.map(l => {
        const d = l.event_date ? ` on ${l.event_date}` : '';
        return `Leg ${l.leg_number}: "${l.selection}" | ${l.event} | ${l.market}${d}`;
      }).join('\n');

      const searchPrompt = `Today is ${todayStr} AEST. Search for the final result of each match below. For each: report the score and full try/goal scorer list.\n\n${legsToSearch}\n\nReport results for every match — do not skip any.`;

      console.log(`[check-results] Single bet ${bet.id} — step 1 search...`);
      let summary;
      try { summary = await searchForResults(apiKey, searchPrompt); }
      catch (e) { return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) }; }
      if (!summary) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0, message: 'No search summary' }) };

      let updates;
      try { updates = await settleLegs(apiKey, summary, unsettledLegs); }
      catch (e) { return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) }; }
      if (!updates?.length) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0, message: 'No settlements returned' }) };

      debugLog.push({ betId: bet.id, updates });
      for (const u of updates) {
        const legNum  = u.legNumber ?? u.leg_number;
        const origLeg = legs.find(l => Number(l.leg_number) === Number(legNum));
        if (!origLeg || !UNSETTLED.includes(origLeg.status) || origLeg.status === u.status) continue;
        const { error: legErr } = await supabase.from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (!legErr) { totalLegsUpdated++; origLeg.status = u.status; }
        else console.error(`[check-results] DB error leg ${legNum}:`, legErr.message);
      }

      const settled = ['won','lost','void'];
      const allDone = legs.every(l => settled.includes(l.status));
      const allWon  = legs.every(l => l.status === 'won');
      const anyLost = legs.some(l  => l.status === 'lost');
      const anyLive = legs.some(l  => l.status === 'in_progress');
      const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';
      if (newOverall !== bet.overall_status) {
        const { error: betErr } = await supabase.from('bets').update({ overall_status: newOverall }).eq('id', bet.id);
        if (!betErr) { totalBetsUpdated++; console.log(`[check-results] ✓ Bet ${bet.id} overall → "${newOverall}"`); }
      }

    } else {
      // ── BATCH MODE: deduplicate events across ALL bet slips ─────────────────
      // eventKey → [{bet, leg}] — one entry per leg that shares this event
      const eventRefs = new Map();
      // betId → {bet, allLegs} — for recalculating overall status later
      const betMeta   = new Map();

      for (const bet of bets) {
        const allLegs      = bet.bet_legs || [];
        const unsettledLegs = allLegs.filter(l => UNSETTLED.includes(l.status));
        if (!unsettledLegs.length) { console.log(`[check-results] Bet ${bet.id} all settled`); continue; }

        // Only include legs whose event has already started
        const startedLegs = unsettledLegs.filter(l => {
          if (!l.event_date) return true;
          const t = l.start_time ? l.start_time.substring(0, 5) : '00:00';
          const start = new Date(`${l.event_date}T${t}:00+10:00`);
          return !isNaN(start.getTime()) && start.getTime() <= now.getTime();
        });
        if (!startedLegs.length) { console.log(`[check-results] Bet ${bet.id} not started yet`); continue; }

        betMeta.set(bet.id, { bet, allLegs });

        for (const leg of startedLegs) {
          // Normalise key: event name + date so the same match across different
          // bet slips maps to the same key and is only searched once.
          const eventKey = `${(leg.event || '').trim().toLowerCase()}|||${leg.event_date || ''}`;
          if (!eventRefs.has(eventKey)) eventRefs.set(eventKey, []);
          eventRefs.get(eventKey).push({ bet, leg });
        }
      }

      if (eventRefs.size === 0) {
        console.log('[check-results] No started unsettled legs found');
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0, message: 'No started unsettled legs' }) };
      }

      // Build one search prompt with a single representative leg per unique event
      const uniqueEntries = [...eventRefs.entries()];
      const searchLegsText = uniqueEntries.map(([, refs], idx) => {
        const { leg } = refs[0];
        const d = leg.event_date ? ` on ${leg.event_date}` : '';
        return `Leg ${idx + 1}: "${leg.selection}" | ${leg.event} | ${leg.market}${d}`;
      }).join('\n');

      const searchPrompt = `Today is ${todayStr} AEST. Search for the final result of each match below. For each: report the score and full try/goal scorer list.\n\n${searchLegsText}\n\nReport results for every match — do not skip any.`;

      console.log(`[check-results] Batch: ${eventRefs.size} unique event(s) across ${betMeta.size} bet(s)`);
      let summary;
      try { summary = await searchForResults(apiKey, searchPrompt); }
      catch (e) {
        console.error('[check-results] Search error:', e.message);
        return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
      }
      if (!summary) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0, message: 'No search summary returned' }) };

      // Settle using representative legs (renumbered 1…N for settlement call)
      const repLegs = uniqueEntries.map(([, refs], idx) => ({ ...refs[0].leg, leg_number: idx + 1 }));
      let updates;
      try { updates = await settleLegs(apiKey, summary, repLegs); }
      catch (e) {
        console.error('[check-results] Settle error:', e.message);
        return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
      }
      if (!updates?.length) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: 0, betsUpdated: 0, message: 'No settlements returned' }) };

      // Map settlement result back to each unique event key
      const settlementByKey = new Map();
      uniqueEntries.forEach(([key], idx) => {
        const s = updates.find(u => Number(u.legNumber ?? u.leg_number) === idx + 1);
        if (s) settlementByKey.set(key, s);
      });

      debugLog.push({ uniqueEvents: eventRefs.size, updates });

      // Apply settlements to ALL matching legs across ALL bet slips
      const touchedBetIds = new Set();
      for (const [eventKey, refs] of eventRefs.entries()) {
        const settlement = settlementByKey.get(eventKey);
        if (!settlement) continue;

        for (const { bet, leg } of refs) {
          if (!UNSETTLED.includes(leg.status) || leg.status === settlement.status) continue;

          console.log(`[check-results] Updating leg ${leg.leg_number} in bet ${bet.id}: "${leg.status}" → "${settlement.status}" (${leg.event})`);
          const { error: legErr } = await supabase.from('bet_legs')
            .update({ status: settlement.status, result_note: settlement.result || '', updated_at: now.toISOString() })
            .eq('id', leg.id);
          if (!legErr) {
            totalLegsUpdated++;
            touchedBetIds.add(bet.id);
            leg.status = settlement.status; // update in-memory for overall calc
            console.log(`[check-results] ✓ Leg ${leg.leg_number} (${leg.event}) → "${settlement.status}"`);
          } else {
            console.error(`[check-results] DB error leg ${leg.leg_number}:`, legErr.message);
          }
        }
      }

      // Recalculate overall status for every affected bet
      for (const bid of touchedBetIds) {
        const { bet, allLegs } = betMeta.get(bid);
        const settled    = ['won','lost','void'];
        const allDone    = allLegs.every(l => settled.includes(l.status));
        const allWon     = allLegs.every(l => l.status === 'won');
        const anyLost    = allLegs.some(l  => l.status === 'lost');
        const anyLive    = allLegs.some(l  => l.status === 'in_progress');
        const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';
        if (newOverall !== bet.overall_status) {
          const { error: betErr } = await supabase.from('bets').update({ overall_status: newOverall }).eq('id', bet.id);
          if (!betErr) { totalBetsUpdated++; console.log(`[check-results] ✓ Bet ${bet.id} overall → "${newOverall}"`); }
          else console.error(`[check-results] DB error bet ${bet.id}:`, betErr.message);
        }
      }
    }

    console.log(`[check-results] Done — ${totalLegsUpdated} legs, ${totalBetsUpdated} bets updated`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: totalLegsUpdated, betsUpdated: totalBetsUpdated, debug: debugLog }) };
  } catch (err) {
    console.error('[check-results] Unexpected error:', err.stack || err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
