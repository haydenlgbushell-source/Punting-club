// netlify/functions/check-results-background.js
// Background function — Netlify returns 202 immediately; this runs up to 15 min.
// Triggered on schedule (every 3 hours) via netlify.toml, AND manually via the
// frontend "Check Results" button (POST to /.netlify/functions/check-results-background).

const { createClient } = require('@supabase/supabase-js');

const UNSETTLED = ['pending', 'in_progress'];

async function callClaudeWithSearch(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  let messages = [{ role: 'user', content: prompt }];

  for (let turn = 0; turn < 10; turn++) {
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
        max_tokens:  4096,
        tools:       [{ type: 'web_search_20250305', name: 'web_search' }],
        tool_choice: turn === 0 ? { type: 'any' } : { type: 'auto' },
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`[check-results-bg] API error ${res.status}:`, JSON.stringify(data).slice(0, 300));
      throw new Error(data.error?.message || `Anthropic API error ${res.status}`);
    }

    const contentTypes = (data.content || []).map(b => b.type).join(', ');
    console.log(`[check-results-bg] Turn ${turn + 1}: stop_reason=${data.stop_reason}, content=[${contentTypes}]`);

    // Final answer — extract text and return
    if (data.stop_reason === 'end_turn') {
      const text = data.content?.find(b => b.type === 'text')?.text || null;
      console.log('[check-results-bg] Final text:', text?.slice(0, 800));
      return text;
    }

    // Claude called web_search — server executed it and returned tool_result blocks in
    // the same response. We must re-attach them as a user turn so Claude sees the results.
    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks    = (data.content || []).filter(b => b.type === 'tool_use');
      const toolResultBlocks = (data.content || []).filter(b => b.type === 'tool_result');
      // Keep text + tool_use in the assistant turn; strip tool_result (moves to user turn)
      const assistantContent = (data.content || []).filter(b => b.type !== 'tool_result');

      console.log('[check-results-bg] Tool calls:', toolUseBlocks.map(b =>
        `${b.name}(${JSON.stringify(b.input)?.slice(0, 120)})`).join(', '));
      console.log(`[check-results-bg] ${toolResultBlocks.length} search result block(s) returned by server`);

      // Build clean tool_result blocks (only the fields the API accepts in user turns)
      const userToolResults = toolUseBlocks.map(b => {
        const found = toolResultBlocks.find(r => r.tool_use_id === b.id);
        if (found) {
          // Sanitize: only pass fields valid in a client-submitted tool_result
          return { type: 'tool_result', tool_use_id: b.id, content: found.content ?? '' };
        }
        // Server didn't return results for this tool call — return empty so Claude can continue
        return { type: 'tool_result', tool_use_id: b.id, content: 'No search results returned.' };
      });

      messages = [
        ...messages,
        { role: 'assistant', content: assistantContent },
        { role: 'user',      content: userToolResults },
      ];
      continue;
    }

    // max_tokens hit mid-stream — grab whatever text exists and return it
    if (data.stop_reason === 'max_tokens') {
      const text = data.content?.find(b => b.type === 'text')?.text || null;
      console.warn('[check-results-bg] max_tokens reached, partial text:', text?.slice(0, 200));
      return text;
    }

    // Unexpected stop reason — attempt to extract text before giving up
    const text = data.content?.find(b => b.type === 'text')?.text || null;
    console.warn(`[check-results-bg] Unexpected stop_reason=${data.stop_reason}, text:`, text?.slice(0, 200));
    return text;
  }

  console.warn('[check-results-bg] Max turns reached without end_turn');
  return null;
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

    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) continue;

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
        const u = updates.find(x => Number(x.legNumber) === Number(l.leg_number));
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
