// Compare Claude models for Punting Club (default: Haiku 4.5 vs Haiku 5.5).
//
//   1. Web-search smoke test — does the model support the web search tool the
//      results settler relies on? (one tiny search per model)
//   2. Bet-slip reading — reads every image in --slips <dir> with each model using
//      the exact production prompt, then shows where the models disagree and
//      what each one cost. (Put 10–20 real slip screenshots in that folder.)
//
// Settlement accuracy is measured separately with scripts/replay-settlement.mjs
// (run it once per model with --model).
//
// Makes real API calls (roughly US$0.20–0.50 for 20 slips). Requires --yes.
//
// Usage:
//   PUNTING_ANTHROPIC_KEY=... node scripts/compare-haiku.mjs --yes [--slips ./slips] \
//     [--models claude-haiku-4-5-20251001,claude-haiku-5-5]

import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildSlipPrompt } from '../src/lib/slipPrompt.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MODELS = opt('--models', 'claude-haiku-4-5-20251001,claude-haiku-5-5').split(',');
const SLIPS = opt('--slips', null);
const KEY = process.env.PUNTING_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;

// US$ per million tokens (input, output) — list prices.
const PRICE = { 'claude-haiku-4-5-20251001': [1, 5], 'claude-haiku-5-5': [0.10, 0.50] };
const SEARCH_PRICE = 10 / 1000;

if (!KEY) { console.error('Set PUNTING_ANTHROPIC_KEY (or ANTHROPIC_API_KEY).'); process.exit(1); }
if (!args.includes('--yes')) { console.error('This makes paid API calls. Re-run with --yes.'); process.exit(1); }

const supportsEffort = (m) => !/claude-haiku-4-5/.test(m);
const cost = (m, u = {}, searches = 0) => {
  const [i, o] = PRICE[m] || [0, 0];
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o) / 1e6 + searches * SEARCH_PRICE;
};

async function call(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── 1. Web search smoke test ────────────────────────────────────────────────
console.log('== Web search support ==');
for (const model of MODELS) {
  const { ok, status, data } = await call({
    model, max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1,
              allowed_domains: ['afl.com.au', 'nrl.com', 'abc.net.au'],
              user_location: { type: 'approximate', country: 'AU', timezone: 'Australia/Sydney' } }],
    messages: [{ role: 'user', content: 'Use web search once: who won the most recent AFL Grand Final, and what was the score? One sentence.' }],
  });
  if (!ok) { console.log(`${model}: FAILED (HTTP ${status}) ${data?.error?.message || ''}`); continue; }
  const searched = (data.content || []).some(b => b.type === 'web_search_tool_result');
  const searches = data.usage?.server_tool_use?.web_search_requests || (searched ? 1 : 0);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').replace(/\s+/g, ' ').slice(0, 160);
  console.log(`${model}: ${searched ? 'OK — web search worked' : 'NO SEARCH RESULT'} | stop=${data.stop_reason} | ` +
    `in=${data.usage?.input_tokens} out=${data.usage?.output_tokens} | ~US$${cost(model, data.usage, searches).toFixed(4)}\n   "${text}"`);
}

// ── 2. Bet-slip reading ─────────────────────────────────────────────────────
if (!SLIPS) { console.log('\n(No --slips folder given — skipping slip comparison.)'); process.exit(0); }

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const files = readdirSync(SLIPS).filter(f => MEDIA[extname(f).toLowerCase()]).sort();
if (!files.length) { console.log(`\nNo images in ${SLIPS}`); process.exit(0); }

const parseJson = (t) => { const m = /\{[\s\S]*\}/.exec(t || ''); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const totals = Object.fromEntries(MODELS.map(m => [m, { cost: 0, parsed: 0 }]));
const LEG_FIELDS = ['selection', 'market', 'odds', 'eventDate', 'startTime', 'sport', 'homeTeam', 'awayTeam', 'marketType', 'line', 'player', 'runnerNumber'];
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

console.log(`\n== Bet-slip reading (${files.length} image(s)) ==`);
for (const f of files) {
  const data64 = readFileSync(join(SLIPS, f)).toString('base64');
  const out = {};
  for (const model of MODELS) {
    const body = {
      model, max_tokens: 8192,
      messages: [{ role: 'user', content: [
        { type: 'text', text: buildSlipPrompt(1) },
        { type: 'image', source: { type: 'base64', media_type: MEDIA[extname(f).toLowerCase()], data: data64 } },
      ] }],
      ...(supportsEffort(model) ? { output_config: { effort: 'low' } } : {}),
    };
    const t0 = Date.now();
    const { ok, status, data } = await call(body);
    const ms = Date.now() - t0;
    if (!ok) { out[model] = { error: `HTTP ${status} ${data?.error?.message || ''}` }; continue; }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = parseJson(text);
    const c = cost(model, data.usage);
    totals[model].cost += c; if (parsed) totals[model].parsed++;
    out[model] = { parsed, c, ms, usage: data.usage };
  }

  console.log(`\n${f}`);
  for (const m of MODELS) {
    const r = out[m];
    if (r.error) { console.log(`  ${m}: ERROR ${r.error}`); continue; }
    console.log(`  ${m}: ${r.parsed ? `${r.parsed.legs?.length ?? 0} legs, stake ${r.parsed.stake}, return ${r.parsed.estimatedReturn}` : 'UNPARSEABLE'} ` +
      `| ${r.ms} ms | in=${r.usage?.input_tokens} out=${r.usage?.output_tokens} | US$${r.c.toFixed(4)}`);
  }
  // Field-by-field differences between the first two models.
  const [a, b] = MODELS.map(m => out[m]?.parsed);
  if (a && b) {
    const diffs = [];
    for (const k of ['betType', 'stake', 'combinedOdds', 'estimatedReturn']) if (!same(a[k], b[k])) diffs.push(`${k}: "${a[k]}" vs "${b[k]}"`);
    const n = Math.max(a.legs?.length || 0, b.legs?.length || 0);
    for (let i = 0; i < n; i++) {
      const la = a.legs?.[i] || {}, lb = b.legs?.[i] || {};
      for (const k of LEG_FIELDS) if (!same(la[k], lb[k])) diffs.push(`leg ${i + 1} ${k}: "${la[k] ?? ''}" vs "${lb[k] ?? ''}"`);
    }
    console.log(diffs.length ? `  Differences (check against the image):\n    - ${diffs.join('\n    - ')}` : '  Models agree on every field.');
  }
}

console.log('\n== Totals ==');
for (const m of MODELS) {
  console.log(`${m}: parsed ${totals[m].parsed}/${files.length} | US$${totals[m].cost.toFixed(4)} total, ` +
    `~US$${(totals[m].cost / files.length).toFixed(4)} per slip`);
}
