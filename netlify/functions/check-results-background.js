// netlify/functions/check-results-background.js
// Background function — Netlify returns 202 immediately; this runs up to 15 min.
// Triggered on schedule (every 3 hours) via netlify.toml, AND manually via the
// frontend "Check Results" button (POST to /.netlify/functions/check-results-background).

const { createClient } = require('@supabase/supabase-js');

const UNSETTLED = ['pending', 'in_progress'];

// Step 1: Search for match results — Claude can return any prose format it likes.
async function searchMatchResults(apiKey, prompt) {
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
      tools:       [{ type: 'web_search_20250305', name: 'web_search' }],
      tool_choice: { type: 'any' },
      messages:    [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || `Anthropic API error ${res.status}`;
    console.error(`[check-results-bg] Search API error ${res.status}:`, msg);
    throw new Error(msg);
  }

  const contentTypes = (data.content || []).map(b => b.type).join(', ');
  console.log(`[check-results-bg] Search response: stop_reason=${data.stop_reason}, content=[${contentTypes}]`);

  // Concatenate all text blocks
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  console.log('[check-results-bg] Search result text:', text?.slice(0, 1000));
  return text || null;
}

// Step 2: Convert prose to structured JSON using tool_use with a schema.
// Using tool_choice forces Claude to call the tool — output is guaranteed valid JSON.
async function convertToJSON(apiKey, summary, legs) {
  const legList = legs.map(l => `Leg ${l.leg_number}: "${l.selection}" | ${l.event} | ${l.market}`).join('\n');

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
        description: 'Record the settlement result for each bet leg',
        input_schema: {
          type: 'object',
          properties: {
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  legNumber: { type: 'number',  description: 'The leg number from the bet' },
                  status:    { type: 'string',  enum: ['won', 'lost', 'pending', 'void', 'in_progress'] },
                  result:    { type: 'string',  description: 'Brief reason: score, scorer list, etc.' },
                },
                required: ['legNumber', 'status', 'result'],
              },
            },
          },
          required: ['legs'],
        },
      }],
      tool_choice: { type: 'tool', name: 'record_settlements' },
      messages: [{
        role:    'user',
        content: `Settle each bet leg using the match summary below.

MATCH SUMMARY:
${summary}

BET LEGS TO SETTLE:
${legList}

Settlement rules:
- "1+ Try" / anytime try scorer: if the named player is in the try scorer list → "won"; if not → "lost"
- Match winner: selected team won → "won"; lost → "lost"
- Handicap: apply handicap to the final score → "won" or "lost"
- If the match has not been played yet, or you cannot find the result → "pending"

Call record_settlements with the result for every leg.`,
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`[check-results-bg] Haiku API error ${res.status}:`, data.error?.message);
    throw new Error(data.error?.message || `Haiku API error ${res.status}`);
  }

  const toolUse = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'record_settlements');
  if (!toolUse?.input?.legs) {
    console.error('[check-results-bg] Haiku did not call record_settlements. Content:', JSON.stringify(data.content).slice(0, 300));
    return null;
  }

  console.log('[check-results-bg] Haiku tool result:', JSON.stringify(toolUse.input.legs));
  // Return in the format the rest of the code expects
  return JSON.stringify(toolUse.input.legs);
}

async function callClaudeWithSearch(prompt, legs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // Step 1: search (returns prose — that's fine)
  const summary = await searchMatchResults(apiKey, prompt);
  if (!summary) return null;

  // If step 1 happened to return valid JSON, use it directly
  if (parseJSON(summary)) return summary;

  // Step 2: convert prose to JSON (simple, reliable)
  const jsonText = await convertToJSON(apiKey, summary, legs);
  return jsonText;
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
  // Optional betId in POST body — when provided, check only that single bet
  let betId = null;
  try { betId = event?.body ? JSON.parse(event.body)?.betId || null : null; } catch (_) {}
  console.log(`[check-results-bg] Starting check${betId ? ` for bet ${betId}` : ' (all pending bets)'}`);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[check-results-bg] Missing Supabase env vars');
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date();
    const aestDate = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const todayStr = aestDate.toUTCString().replace(/ GMT$/, ' AEST');
    const timeStr  = `${pad(aestDate.getUTCHours())}:${pad(aestDate.getUTCMinutes())} AEST`;

    // 14-day lookback: include any bet submitted in the past 14 days so that
    // last-week bets whose overall_status was already settled (but may still
    // have pending legs) are not silently excluded.
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

    if (betsErr) { console.error('[check-results-bg] DB fetch error:', betsErr.message); return; }
    if (!bets?.length) { console.log('[check-results-bg] No unsettled bets found'); return; }

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;
    let betIndex = 0;


    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) continue;

      // Stagger requests to avoid hitting the 30k input token/min rate limit.
      // Web search results are large — 10s between bets keeps us well under the limit.
      if (betIndex > 0) {
        console.log(`[check-results-bg] Waiting 10s before next bet to avoid rate limit...`);
        await new Promise(r => setTimeout(r, 10000));
      }
      betIndex++;

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

      const legs = bet.bet_legs || [];
      const desc = legs.map(l => {
        const datePart = l.event_date ? ` on ${l.event_date}${l.start_time ? ' at ' + l.start_time + ' AEST' : ''}` : '';
        return `Leg ${l.leg_number}: "${l.selection}" | ${l.event} | ${l.market}${datePart}`;
      }).join('\n');

      // Search prompt: just find the facts — prose is fine, JSON not required here
      const searchPrompt = `Today is ${todayStr} AEST. Search for the results of these Australian sports matches and report:
1. The FINAL SCORE of each match
2. The COMPLETE list of try scorers / goal scorers for each match

MATCHES TO FIND:
${desc}

Search for each match on nrl.com, afl.com.au, or foxsports.com.au. Report the final score and full scorer list for each match. If a match hasn't been played yet, say so.`;

      let responseText;
      try {
        responseText = await callClaudeWithSearch(searchPrompt, legs);
      } catch (e) {
        console.error('[check-results-bg] Claude error:', e.message);
        continue;
      }
      if (!responseText) continue;

      console.log('[check-results-bg] Full Claude response:', responseText?.slice(0, 2000));

      const updates = parseJSON(responseText);
      if (!Array.isArray(updates)) {
        console.warn('[check-results-bg] Could not parse Claude response as JSON array. Raw text:', responseText?.slice(0, 500));
        continue;
      }
      console.log('[check-results-bg] Parsed updates:', JSON.stringify(updates));

      for (const u of updates) {
        // Accept both legNumber and leg_number from Claude
        const legNum = u.legNumber ?? u.leg_number;
        const origLeg = (bet.bet_legs || []).find(l => Number(l.leg_number) === Number(legNum));
        if (!origLeg) {
          console.warn(`[check-results-bg] No matching leg found for legNumber=${legNum}. DB legs:`, (bet.bet_legs||[]).map(l=>l.leg_number));
          continue;
        }
        if (origLeg.status === u.status) {
          console.log(`[check-results-bg] Leg ${legNum} status unchanged (${u.status}) — skipping`);
          continue;
        }
        console.log(`[check-results-bg] Updating leg ${legNum} from "${origLeg.status}" to "${u.status}"`);
        const { error: legErr } = await supabase
          .from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (!legErr) {
          totalLegsUpdated++;
          console.log(`[check-results-bg] Leg ${legNum} → "${u.status}": ${u.result}`);
        } else {
          console.error(`[check-results-bg] DB error updating leg ${legNum}:`, legErr.message, legErr);
        }
      }

      const updatedLegs = (bet.bet_legs || []).map(l => {
        const u = updates.find(x => Number(x.legNumber ?? x.leg_number) === Number(l.leg_number));
        return u ? { ...l, status: u.status } : l;
      });
      const settled    = ['won', 'lost', 'void'];
      const allDone    = updatedLegs.every(l => settled.includes(l.status));
      const allWon     = updatedLegs.every(l => l.status === 'won');
      const anyLost    = updatedLegs.some(l => l.status === 'lost');
      const anyLive    = updatedLegs.some(l => l.status === 'in_progress');
      const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';

      if (newOverall !== bet.overall_status) {
        console.log(`[check-results-bg] Updating bet ${bet.id} overall_status from "${bet.overall_status}" to "${newOverall}"`);
        const { error: betErr } = await supabase
          .from('bets').update({ overall_status: newOverall }).eq('id', bet.id);
        if (!betErr) {
          totalBetsUpdated++;
          console.log(`[check-results-bg] Bet ${bet.id} → "${newOverall}"`);
        } else {
          console.error(`[check-results-bg] DB error updating bet ${bet.id}:`, betErr.message, betErr);
        }
      } else {
        console.log(`[check-results-bg] Bet ${bet.id} overall_status already "${newOverall}" — no change`);
      }
    }

    console.log(`[check-results-bg] Done — ${totalLegsUpdated} legs, ${totalBetsUpdated} bets updated`);
  } catch (err) {
    console.error('[check-results-bg] Unexpected error:', err.stack || err);
  }
};
