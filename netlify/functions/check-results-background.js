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
    console.log(`[check-results-bg] Turn ${turn + 1}: stop_reason=${data.stop_reason}, content=[${contentTypes}]`);

    if (data.stop_reason === 'end_turn') {
      const text = data.content?.find(b => b.type === 'text')?.text || null;
      console.log('[check-results-bg] Final text:', text?.slice(0, 500));
      return text;
    }

    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      console.log('[check-results-bg] Tool calls:', toolUseBlocks.map(b => `${b.name}(${JSON.stringify(b.input)?.slice(0, 100)})`).join(', '));
      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        {
          role: 'user',
          content: toolUseBlocks.map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: '',
          })),
        },
      ];
      continue;
    }

    const text = data.content?.find(b => b.type === 'text')?.text || null;
    console.log(`[check-results-bg] Unexpected stop_reason=${data.stop_reason}, text:`, text?.slice(0, 200));
    return text;
  }

  console.warn('[check-results-bg] Max turns reached without end_turn');
  return null;
}

function parseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); } catch {}
  const match = text.match(/\[[\s\S]*\]/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

exports.handler = async () => {
  console.log('[check-results-bg] Starting bet result check');

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

    const { data: bets, error: betsErr } = await supabase
      .from('bets')
      .select('id, overall_status, team_id, bet_legs(*)')
      .in('overall_status', [...UNSETTLED, 'partial'])
      .order('submitted_at', { ascending: false });

    if (betsErr) { console.error('[check-results-bg] DB fetch error:', betsErr.message); return; }
    if (!bets?.length) { console.log('[check-results-bg] No unsettled bets found'); return; }

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;

    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) continue;

      const hasStartedEvent = unsettledLegs.some(l => {
        if (!l.event_date) return true;
        const t = l.start_time ? l.start_time.substring(0, 5) : '00:00';
        const eventStart = new Date(`${l.event_date}T${t}`);
        return !isNaN(eventStart.getTime()) && eventStart.getTime() <= now.getTime();
      });
      if (!hasStartedEvent) continue;

      const desc = (bet.bet_legs || []).map(l => {
        const datePart = l.event_date ? ` around ${l.event_date}${l.start_time ? ' at ' + l.start_time + ' AEST' : ''}` : '';
        return `Leg ${l.leg_number}: "${l.selection}" — ${l.event} — ${l.market} @ ${l.odds}${datePart} — current status: ${l.status}`;
      }).join('\n');

      const prompt = `Today is ${todayStr} at ${timeStr} AEST (Australian Eastern Standard Time).

The following Australian sports bet legs need their results determined. All events listed are from the recent past — search the web to find the actual result for each one.

Bet legs:
${desc}

IMPORTANT — Search strategy:
- Search primarily by TEAM NAMES and COMPETITION (e.g. "Manly Sea Eagles vs Newcastle Knights NRL 2026 result"), NOT just by the stored date.
- The stored date may be off by 1-3 days (it could be the bet submission date rather than the actual match date). Search ±3 days around the stored date.
- For NRL: search "[Team A] vs [Team B] NRL 2026 try scorers result" and check nrl.com, foxsports.com.au, leagueunlimited.com, espn.com.au
- For try-scorer props: search "[player name] try [Team A] vs [Team B] NRL 2026" — confirm by checking official match scorecards
- For AFL: search "[Team A] vs [Team B] AFL 2026 goal scorers result" and check afl.com.au
- For soccer/football: search "[Team A] vs [Team B] [competition] 2026 result scorers"
- Always verify the FINAL SCORE and COMPLETE list of scorers before deciding won/lost

Rules:
- If the event was in the recent past, it MUST be marked won, lost, void, or in_progress — NOT pending
- Mark "won" if the selection was correct (team won, player scored the try/goal, etc.)
- Mark "lost" if the selection was incorrect
- Mark "void" if the match was cancelled, postponed, or the player was a late scratching
- Mark "in_progress" ONLY if the match is literally happening right now
- Mark "pending" ONLY if the event is definitely scheduled for the future

Result note format:
- For try-scorer bets: state whether player scored AND list ALL try scorers with counts (e.g. "Ponga scored 1 try. All try scorers: Ponga (1), Young (2), Marzhew (1). Knights won 36-16.")
- For match winner bets: final score (e.g. "Knights won 36-16 over Sea Eagles")
- For goal-scorer bets: confirm score and list all goal scorers with counts
- For any prop: state the exact outcome with key stats
- Always include the final score

Return ONLY a valid JSON array — no other text, no markdown fences:
[{"legNumber":1,"status":"won|lost|void|in_progress|pending","result":"e.g. Broncos won 28-14. Try scorers: Cobbo (2), Staggs (1), Selwyn (1)"}]`;

      let responseText;
      try {
        responseText = await callClaudeWithSearch(prompt);
      } catch (e) {
        console.error('[check-results-bg] Claude error:', e.message);
        continue;
      }
      if (!responseText) continue;

      const updates = parseJSON(responseText);
      if (!Array.isArray(updates)) {
        console.warn('[check-results-bg] Could not parse Claude response:', responseText?.slice(0, 300));
        continue;
      }

      for (const u of updates) {
        const origLeg = (bet.bet_legs || []).find(l => l.leg_number === u.legNumber);
        if (!origLeg || origLeg.status === u.status) continue;
        const { error: legErr } = await supabase
          .from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (!legErr) {
          totalLegsUpdated++;
          console.log(`[check-results-bg] Leg ${u.legNumber} → "${u.status}": ${u.result}`);
        }
      }

      const updatedLegs = (bet.bet_legs || []).map(l => {
        const u = updates.find(x => x.legNumber === l.leg_number);
        return u ? { ...l, status: u.status } : l;
      });
      const settled    = ['won', 'lost', 'void'];
      const allDone    = updatedLegs.every(l => settled.includes(l.status));
      const allWon     = updatedLegs.every(l => l.status === 'won');
      const anyLost    = updatedLegs.some(l => l.status === 'lost');
      const anyLive    = updatedLegs.some(l => l.status === 'in_progress');
      const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';

      if (newOverall !== bet.overall_status) {
        const { error: betErr } = await supabase
          .from('bets').update({ overall_status: newOverall }).eq('id', bet.id);
        if (!betErr) {
          totalBetsUpdated++;
          console.log(`[check-results-bg] Bet ${bet.id} → "${newOverall}"`);
        }
      }
    }

    console.log(`[check-results-bg] Done — ${totalLegsUpdated} legs, ${totalBetsUpdated} bets updated`);
  } catch (err) {
    console.error('[check-results-bg] Unexpected error:', err.stack || err);
  }
};
