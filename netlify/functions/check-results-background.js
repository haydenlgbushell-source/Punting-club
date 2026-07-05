// netlify/functions/check-results-background.js
// Background function — Netlify returns 202 immediately; this runs up to 15 min.
// Triggered on schedule (every 3 hours) via netlify.toml, AND manually via the
// frontend "Check Results" button (POST to /.netlify/functions/check-results-background).

const { createClient } = require('@supabase/supabase-js');

const UNSETTLED = ['pending', 'in_progress'];
const VERSION   = 'v9-two-step-haiku-tool';

// Step 1: Sonnet + web search → prose summary (no JSON required, avoids max_tokens issue)
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
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Anthropic API ${res.status}`);

    const types = (data.content || []).map(b => b.type).join(', ');
    console.log(`[check-results-bg] Search turn ${turn + 1}: stop_reason=${data.stop_reason}, content=[${types}]`);

    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    if (data.stop_reason === 'end_turn') {
      const text = textBlocks.map(b => b.text).join('\n');
      console.log('[check-results-bg] Search summary:', text?.slice(0, 600));
      return text || null;
    }

    if (data.stop_reason === 'tool_use') {
      // Add assistant's turn to messages, then provide tool_results so the
      // conversation can continue to the final text response.
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

// Step 2: Haiku (separate rate limit bucket) + forced tool_use → guaranteed structured output
// The search results are NOT passed here — only the prose summary from Step 1.
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
        content: `Summary:\n${summary}\n\nLegs:\n${legList}\n\nSettle each leg using ONLY the summary above. Rules: mark "won" or "lost" only if the match has FINISHED and the result is clearly stated; if it is still in progress use "in_progress"; if it has not started or the summary has no result for it use "pending". For "to score"/scorer markets: "won" only if the player is explicitly named as a scorer, "lost" only if the match finished and they are not named. For winner/head-to-head markets settle by the stated final result. Never guess or infer beyond the summary.`,
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Haiku API ${res.status}`);

  const types = (data.content || []).map(b => b.type).join(', ');
  console.log(`[check-results-bg] Settle: stop_reason=${data.stop_reason}, content=[${types}]`);

  const toolCall = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'record_settlements');
  if (!toolCall?.input?.legs?.length) {
    console.error('[check-results-bg] Haiku did not call record_settlements:', JSON.stringify(data.content).slice(0, 300));
    return null;
  }

  console.log('[check-results-bg] Settled:', JSON.stringify(toolCall.input.legs));
  return toolCall.input.legs;
}

exports.handler = async (event) => {
  let bodyStr = event?.body || '';
  if (event?.isBase64Encoded) bodyStr = Buffer.from(bodyStr, 'base64').toString('utf-8');

  let betId = null;
  try { betId = bodyStr ? JSON.parse(bodyStr)?.betId || null : null; } catch (_) {}
  console.log(`[check-results-bg] ${VERSION} — Starting${betId ? ` for bet ${betId}` : ' (all pending bets)'}`);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[check-results-bg] Missing Supabase env vars'); return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[check-results-bg] Missing ANTHROPIC_API_KEY'); return; }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Efficiency tuning:
    //  1) Deduplicate matches across ALL bets — a game many teams bet on is
    //     searched ONCE, not once per bet (the main cost saving).
    //  2) Only check matches that have FINISHED (kicked off > FINISHED_AFTER_MS
    //     ago) so we don't repeatedly pay to search still-in-progress games.
    const FINISHED_AFTER_MS = 3 * 60 * 60 * 1000; // treat a match as settle-able 3h after kickoff
    const EVENTS_PER_SEARCH = 5;                  // unique matches per search call (keeps each search focused)
    const SLEEP_BETWEEN_SEARCHES_MS = 20000;      // pause between search calls to respect rate limits

    const now = new Date();
    const aestDate = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const todayStr = `${aestDate.getUTCFullYear()}-${pad(aestDate.getUTCMonth()+1)}-${pad(aestDate.getUTCDate())}`;

    // Fetch only bets that still have work to do (or a single bet by id).
    let betsQuery = supabase.from('bets').select('id, overall_status, team_id, bet_legs(*)');
    if (betId) {
      betsQuery = betsQuery.eq('id', betId);
    } else {
      betsQuery = betsQuery
        .in('overall_status', [...UNSETTLED, 'partial'])
        .order('submitted_at', { ascending: false });
    }
    const { data: bets, error: betsErr } = await betsQuery;
    if (betsErr) { console.error('[check-results-bg] DB error:', betsErr.message); return; }
    if (!bets?.length) { console.log('[check-results-bg] No unsettled bets'); return; }

    // A leg is eligible once its match has finished. Manual single-bet checks
    // (betId) skip the finished buffer so an admin can settle immediately.
    const legReady = (l) => {
      if (!l.event_date) return true; // no date (e.g. outrights) — always eligible
      const t = l.start_time ? l.start_time.substring(0, 5) : '00:00';
      const start = new Date(`${l.event_date}T${t}:00+10:00`);
      if (isNaN(start.getTime())) return true;
      const cutoff = betId ? now.getTime() : now.getTime() - FINISHED_AFTER_MS;
      return start.getTime() <= cutoff;
    };

    // eventKey → [{bet, leg}] for every unsettled leg on a finished match.
    const eventRefs = new Map();
    const betMeta   = new Map(); // betId → {bet, allLegs}
    for (const bet of bets) {
      const allLegs = bet.bet_legs || [];
      const readyLegs = allLegs.filter(l => UNSETTLED.includes(l.status) && legReady(l));
      if (!readyLegs.length) continue;
      betMeta.set(bet.id, { bet, allLegs });
      for (const leg of readyLegs) {
        const eventKey = `${(leg.event || '').trim().toLowerCase()}|||${leg.event_date || ''}`;
        if (!eventRefs.has(eventKey)) eventRefs.set(eventKey, []);
        eventRefs.get(eventKey).push({ bet, leg });
      }
    }
    if (eventRefs.size === 0) { console.log('[check-results-bg] No finished unsettled matches to check'); return; }

    const uniqueEntries = [...eventRefs.entries()];
    console.log(`[check-results-bg] ${uniqueEntries.length} unique match(es) across ${betMeta.size} bet(s) (deduped)`);

    let totalLegsUpdated = 0, totalBetsUpdated = 0;
    const settlementByKey = new Map();

    // Search + settle the unique matches in small chunks (one web search per match).
    for (let i = 0; i < uniqueEntries.length; i += EVENTS_PER_SEARCH) {
      const chunk = uniqueEntries.slice(i, i + EVENTS_PER_SEARCH);
      if (i > 0) {
        console.log(`[check-results-bg] Waiting ${SLEEP_BETWEEN_SEARCHES_MS / 1000}s (rate limit)...`);
        await new Promise(r => setTimeout(r, SLEEP_BETWEEN_SEARCHES_MS));
      }
      const searchLegsText = chunk.map(([, refs], idx) => {
        const { leg } = refs[0];
        const d = leg.event_date ? ` on ${leg.event_date}` : '';
        return `Leg ${idx + 1}: "${leg.selection}" | ${leg.event} | ${leg.market}${d}`;
      }).join('\n');

      const searchPrompt = `Today is ${todayStr} AEST. Search the web for the MOST RECENT, FINAL result of each match below, using up-to-date sources. For each match report: whether it has FINISHED or is still in progress, the final (or current) score, and the full list of try/goal scorers.\n\n${searchLegsText}\n\nReport on every match — do not skip any. If you cannot find a result, say so explicitly rather than guessing.`;

      console.log(`[check-results-bg] Search chunk ${Math.floor(i / EVENTS_PER_SEARCH) + 1} (${chunk.length} match(es))...`);
      let summary;
      try { summary = await searchForResults(apiKey, searchPrompt); }
      catch (e) { console.error('[check-results-bg] Search error:', e.message); continue; }
      if (!summary) { console.warn('[check-results-bg] No summary for chunk'); continue; }

      const repLegs = chunk.map(([, refs], idx) => ({ ...refs[0].leg, leg_number: idx + 1 }));
      let updates;
      try { updates = await settleLegs(apiKey, summary, repLegs); }
      catch (e) { console.error('[check-results-bg] Settle error:', e.message); continue; }
      if (!updates?.length) { console.warn('[check-results-bg] No settlements for chunk'); continue; }

      chunk.forEach(([key], idx) => {
        const s = updates.find(u => Number(u.legNumber ?? u.leg_number) === idx + 1);
        if (s) settlementByKey.set(key, s);
      });
    }

    // Apply each match's settlement to EVERY leg that shares it, across all bets.
    const touchedBetIds = new Set();
    for (const [eventKey, refs] of eventRefs.entries()) {
      const settlement = settlementByKey.get(eventKey);
      if (!settlement) continue;
      for (const { bet, leg } of refs) {
        if (!UNSETTLED.includes(leg.status) || leg.status === settlement.status) continue;
        const { error: legErr } = await supabase.from('bet_legs')
          .update({ status: settlement.status, result_note: settlement.result || '', updated_at: now.toISOString() })
          .eq('id', leg.id);
        if (!legErr) {
          totalLegsUpdated++;
          touchedBetIds.add(bet.id);
          leg.status = settlement.status; // mutate in-memory so the overall calc below sees it
          console.log(`[check-results-bg] ✓ Leg ${leg.leg_number} (${leg.event}) → "${settlement.status}"`);
        } else {
          console.error(`[check-results-bg] DB error leg ${leg.leg_number}:`, legErr.message);
        }
      }
    }

    // Recompute overall status for each affected bet.
    const settled = ['won', 'lost', 'void'];
    for (const bid of touchedBetIds) {
      const { bet, allLegs } = betMeta.get(bid);
      const allDone = allLegs.every(l => settled.includes(l.status));
      const allWon  = allLegs.every(l => l.status === 'won');
      const anyLost = allLegs.some(l  => l.status === 'lost');
      const anyLive = allLegs.some(l  => l.status === 'in_progress');
      const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';
      if (newOverall !== bet.overall_status) {
        const { error: betErr } = await supabase.from('bets').update({ overall_status: newOverall }).eq('id', bet.id);
        if (!betErr) { totalBetsUpdated++; console.log(`[check-results-bg] ✓ Bet ${bet.id} overall → "${newOverall}"`); }
        else console.error(`[check-results-bg] DB error bet ${bet.id}:`, betErr.message);
      }
    }

    console.log(`[check-results-bg] Done — ${totalLegsUpdated} legs, ${totalBetsUpdated} bets updated`);
  } catch (err) {
    console.error('[check-results-bg] Unexpected error:', err.stack || err);
  }
};

