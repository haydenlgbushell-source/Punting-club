// netlify/functions/check-results.js
// Callable via POST /api/check-results from the frontend (26-second timeout).

const { createClient } = require('@supabase/supabase-js');

const HEADERS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};

const UNSETTLED = ['pending', 'in_progress'];
const VERSION   = 'v8-single-call';

const SETTLE_TOOL = {
  name:        'record_settlements',
  description: 'Record the final settlement for every bet leg after searching for match results.',
  input_schema: {
    type: 'object',
    properties: {
      legs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            legNumber: { type: 'number', description: 'The leg number' },
            status:    { type: 'string', enum: ['won','lost','pending','void','in_progress'] },
            result:    { type: 'string', description: 'Brief reason — score, scorer list, etc.' },
          },
          required: ['legNumber','status','result'],
        },
      },
    },
    required: ['legs'],
  },
};

async function settleWithClaude(apiKey, prompt) {
  const tools = [
    { type: 'web_search_20250305', name: 'web_search' },
    SETTLE_TOOL,
  ];

  let messages = [{ role: 'user', content: prompt }];

  for (let turn = 0; turn < 4; turn++) {
    const toolChoice = turn >= 2
      ? { type: 'tool', name: 'record_settlements' }
      : { type: 'auto' };

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
        tools,
        tool_choice: toolChoice,
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`[check-results] API error ${res.status}:`, data.error?.message);
      throw new Error(data.error?.message || `Anthropic API error ${res.status}`);
    }

    const contentTypes = (data.content || []).map(b => b.type).join(', ');
    console.log(`[check-results] Turn ${turn+1}: stop_reason=${data.stop_reason}, content=[${contentTypes}]`);

    const settleCall = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'record_settlements');
    if (settleCall?.input?.legs?.length) {
      console.log('[check-results] record_settlements result:', JSON.stringify(settleCall.input.legs));
      return settleCall.input.legs;
    }

    if (data.stop_reason === 'end_turn') {
      console.log('[check-results] end_turn without tool call, nudging...');
      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        { role: 'user',      content: 'Now call record_settlements with the settlement result for each leg.' },
      ];
      continue;
    }

    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks    = (data.content || []).filter(b => b.type === 'tool_use');
      const toolResultBlocks = (data.content || []).filter(b => b.type === 'tool_result');
      const assistantContent = (data.content || []).filter(b => b.type !== 'tool_result');

      const userResults = toolUseBlocks.map(b => {
        const found = toolResultBlocks.find(r => r.tool_use_id === b.id);
        return found
          ? { type: 'tool_result', tool_use_id: b.id, content: found.content ?? '' }
          : { type: 'tool_result', tool_use_id: b.id, content: 'No results.' };
      });

      messages = [
        ...messages,
        { role: 'assistant', content: assistantContent },
        { role: 'user',      content: userResults },
      ];
      continue;
    }
  }

  console.warn('[check-results] No record_settlements call after 4 turns');
  return null;
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
      if (!unsettledLegs.length) continue;

      if (!betId) {
        const hasStarted = unsettledLegs.some(l => {
          if (!l.event_date) return true;
          const t = l.start_time ? l.start_time.substring(0, 5) : '00:00';
          const eventStart = new Date(`${l.event_date}T${t}:00+10:00`);
          return !isNaN(eventStart.getTime()) && eventStart.getTime() <= now.getTime();
        });
        if (!hasStarted) continue;
      }

      const legs = bet.bet_legs || [];
      const legDesc = legs.map(l => {
        const datePart = l.event_date ? ` on ${l.event_date}` : '';
        return `Leg ${l.leg_number}: "${l.selection}" | ${l.event} | ${l.market}${datePart} | status: ${l.status}`;
      }).join('\n');

      const prompt = `Today is ${todayStr} AEST.

Search for the result of each match below, then call record_settlements with the outcome of every leg.

BET LEGS:
${legDesc}

For each leg:
- If it's a try/goal scorer bet: search for the match and find the full try/goal scorer list. Is the player named in that list? yes=won, no=lost.
- If it's a match winner bet: did the selected team win? yes=won, no=lost.
- If the match has not yet been played or you cannot find the result: status=pending.

Search first, then call record_settlements.`;

      let updates;
      try {
        updates = await settleWithClaude(apiKey, prompt);
      } catch (e) {
        console.error(`[check-results] Claude error bet ${bet.id}:`, e.message);
        debugLog.push({ betId: bet.id, error: e.message });
        continue;
      }

      if (!updates || !Array.isArray(updates)) {
        debugLog.push({ betId: bet.id, error: 'No settlement returned' });
        continue;
      }

      debugLog.push({ betId: bet.id, updates });

      for (const u of updates) {
        const legNum  = u.legNumber ?? u.leg_number;
        const origLeg = legs.find(l => Number(l.leg_number) === Number(legNum));
        if (!origLeg) { console.warn(`[check-results] No leg for legNumber=${legNum}`); continue; }
        if (origLeg.status === u.status) { console.log(`[check-results] Leg ${legNum} already "${u.status}"`); continue; }

        console.log(`[check-results] Updating leg ${legNum}: "${origLeg.status}" → "${u.status}"`);
        const { error: legErr } = await supabase
          .from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (legErr) {
          console.error(`[check-results] DB error leg ${legNum}:`, legErr.message);
        } else {
          totalLegsUpdated++;
          console.log(`[check-results] ✓ Leg ${legNum} → "${u.status}"`);
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
        else { totalBetsUpdated++; console.log(`[check-results] ✓ Bet ${bet.id} → "${newOverall}"`); }
      }
    }

    console.log(`[check-results] Done — ${totalLegsUpdated} legs, ${totalBetsUpdated} bets updated`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ legsUpdated: totalLegsUpdated, betsUpdated: totalBetsUpdated, debug: debugLog }) };
  } catch (err) {
    console.error('[check-results] Unexpected error:', err.stack || err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
