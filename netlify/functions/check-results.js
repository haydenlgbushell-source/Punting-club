// netlify/functions/check-results.js
// Scheduled function — runs every 3 hours to auto-check pending bet results via Claude AI.
// Netlify schedule is configured in netlify.toml: schedule = "0 */3 * * *"

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UNSETTLED = ['pending', 'in_progress'];

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || null;
}

function parseJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

exports.handler = async () => {
  console.log('[check-results] Starting scheduled bet result check');
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  try {
    // Fetch all bets with unsettled legs
    const { data: bets, error: betsErr } = await supabase
      .from('bets')
      .select('id, overall_status, teams(team_name), bet_legs(*)')
      .in('overall_status', [...UNSETTLED, 'partial'])
      .order('submitted_at', { ascending: false });

    if (betsErr) { console.error('[check-results] DB fetch error:', betsErr.message); return { statusCode: 500 }; }
    if (!bets?.length) { console.log('[check-results] No unsettled bets found'); return { statusCode: 200 }; }

    let totalLegsUpdated = 0;
    let totalBetsUpdated = 0;

    for (const bet of bets) {
      const unsettledLegs = (bet.bet_legs || []).filter(l => UNSETTLED.includes(l.status));
      if (!unsettledLegs.length) continue;

      // Only check bets whose earliest event has started
      const hasStartedEvent = unsettledLegs.some(l => {
        if (!l.event_date) return true; // no date stored — always check
        const timeStr = l.start_time ? l.start_time.substring(0, 5) : '00:00';
        const eventStart = new Date(`${l.event_date}T${timeStr}`);
        return !isNaN(eventStart.getTime()) && eventStart.getTime() <= now.getTime();
      });
      if (!hasStartedEvent) continue;

      const desc = (bet.bet_legs || []).map(l => {
        const eventDateStr = l.event_date ? ` — date: ${l.event_date}${l.start_time ? ' ' + l.start_time : ''}` : '';
        return `Leg ${l.leg_number}: ${l.selection} — ${l.event} — ${l.market} — @ ${l.odds} — status: ${l.status}${eventDateStr}`;
      }).join('\n');

      const prompt = `Today: ${todayStr}. Current time: ${now.toLocaleTimeString('en-AU')}.\nIMPORTANT: Only use results from the year ${now.getFullYear()}. Do not use results from any previous year.\n\nBet legs:\n${desc}\n\nFor each unsettled leg (pending or in_progress) determine its current state:\n- "won" if the selection won\n- "lost" if the selection lost\n- "void" if the bet was voided/cancelled\n- "in_progress" if the event has started but not yet concluded (live right now)\n- "pending" if the event hasn't started yet\n\nReturn ONLY a JSON array:\n[{"legNumber":1,"status":"won"|"lost"|"void"|"in_progress"|"pending","result":"brief note"}]\nOnly mark won/lost/void if fully confident the event is concluded. Return all legs.`;

      let responseText;
      try { responseText = await callClaude(prompt); } catch(e) { console.error('[check-results] Claude error:', e.message); continue; }
      if (!responseText) continue;

      const updates = parseJSON(responseText);
      if (!Array.isArray(updates)) continue;

      // Update each changed leg in DB
      for (const u of updates) {
        const origLeg = (bet.bet_legs || []).find(l => l.leg_number === u.legNumber);
        if (!origLeg || origLeg.status === u.status) continue;
        const { error: legErr } = await supabase
          .from('bet_legs')
          .update({ status: u.status, result_note: u.result || '', updated_at: now.toISOString() })
          .eq('id', origLeg.id);
        if (legErr) console.error('[check-results] Leg update error:', legErr.message);
        else totalLegsUpdated++;
      }

      // Recalculate overall bet status from updated legs
      const updatedLegs = (bet.bet_legs || []).map(l => {
        const u = updates.find(x => x.legNumber === l.leg_number);
        return u ? { ...l, status: u.status } : l;
      });
      const settled = ['won', 'lost', 'void'];
      const allDone  = updatedLegs.every(l => settled.includes(l.status));
      const allWon   = updatedLegs.every(l => l.status === 'won');
      const anyLost  = updatedLegs.some(l => l.status === 'lost');
      const anyLive  = updatedLegs.some(l => l.status === 'in_progress');
      const newOverall = allDone ? (allWon ? 'won' : anyLost ? 'lost' : 'partial') : anyLive ? 'in_progress' : 'pending';

      if (newOverall !== bet.overall_status) {
        const { error: betErr } = await supabase
          .from('bets')
          .update({ overall_status: newOverall })
          .eq('id', bet.id);
        if (betErr) console.error('[check-results] Bet update error:', betErr.message);
        else totalBetsUpdated++;
      }
    }

    console.log(`[check-results] Done — ${totalLegsUpdated} legs updated, ${totalBetsUpdated} bets updated`);
    return { statusCode: 200, body: JSON.stringify({ legsUpdated: totalLegsUpdated, betsUpdated: totalBetsUpdated }) };
  } catch (err) {
    console.error('[check-results] Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
