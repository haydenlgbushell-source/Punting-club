// netlify/functions/market-report.js
// Scheduled background function — runs daily at 8 AM AEST (22:00 UTC Sun–Thu).
// Uses Claude Sonnet + web search to generate an overnight market brief, then
// emails it via Gmail SMTP (App Password auth).
//
// Required env vars:
//   ANTHROPIC_API_KEY      — Anthropic API key
//   GMAIL_USER             — Gmail address to send from (e.g. you@gmail.com)
//   GMAIL_APP_PASSWORD     — Gmail App Password (not your login password)

const nodemailer = require('nodemailer');

const RECIPIENT = 'haydenlgbushell@gmail.com';

const SEARCH_HEADERS = (apiKey) => ({
  'Content-Type':      'application/json',
  'x-api-key':         apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-beta':    'web-search-2025-03-05',
});

function getAESTDateString() {
  const now  = new Date();
  const aest = new Date(now.getTime() + 10 * 60 * 60 * 1000);
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[aest.getUTCDay()]} ${aest.getUTCDate()} ${months[aest.getUTCMonth()]} ${aest.getUTCFullYear()}`;
}

function buildPrompt(dateStr) {
  return `You are a financial market analyst. Today is ${dateStr} AEST. Prepare an overnight market brief for an Australian investor.

Use web search to fetch the latest data and news, then produce a clean formatted report using EXACTLY this structure:

## 🌏 Morning Market Brief — ${dateStr}

**Overnight Sentiment:** [BULLISH / BEARISH / MIXED / FLAT]
**Headline:** [One punchy sentence summarising overnight action]

---

### 📊 Markets

| Index | Last | Change |
|---|---|---|
| ASX 200 | … | …% |
| S&P 500 | … | …% |
| NASDAQ | … | …% |
| Nikkei 225 | … | …% |

### 💱 FX & Commodities

| Asset | Price | Change |
|---|---|---|
| AUD/USD | … | …% |
| Gold | … | …% |
| WTI Oil | … | …% |
| Bitcoin | … | …% |

### 📰 Key Themes

1. [Theme 1 — one sentence]
2. [Theme 2 — one sentence]
3. [Theme 3 — one sentence]

### 📋 Summary

[3 sentences. What happened overnight, why it matters, and the overall tone heading into the ASX open.]

### 👀 Watch Today

[2 sentences on what ASX investors should keep an eye on during today's session.]

---

*Generated at 8:00 AM AEST | Data sourced via web search*

Rules:
- If a market is closed (weekend/public holiday) note it and omit that row
- Write N/A rather than guessing if no data is found
- Keep the tone professional but direct`;
}

async function generateMarketReport(apiKey, dateStr) {
  let messages = [{ role: 'user', content: buildPrompt(dateStr) }];

  for (let turn = 0; turn < 8; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: SEARCH_HEADERS(apiKey),
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Anthropic API ${res.status}`);

    const contentTypes = (data.content || []).map(b => b.type).join(', ');
    console.log(`[market-report] Turn ${turn + 1}: stop_reason=${data.stop_reason} content=[${contentTypes}]`);

    if (data.stop_reason === 'end_turn') {
      return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    }

    if (data.stop_reason === 'tool_use') {
      const toolBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        {
          role:    'user',
          content: toolBlocks.map(b => ({
            type:        'tool_result',
            tool_use_id: b.id,
            content:     `Tool ${b.name} executed.`,
          })),
        },
      ];
      continue;
    }

    // Any other stop reason — return whatever text we have
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return text || null;
  }

  return null;
}

function markdownToHtml(md) {
  const lines = md.split('\n');
  const out   = [];
  let inTable = false;
  let inOl    = false;
  let headerDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table row
    if (/^\|/.test(line)) {
      if (!inTable) { out.push('<table>'); inTable = true; }
      // Skip separator rows
      if (/^\|[-| :]+\|$/.test(line)) continue;
      const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const tag   = !headerDone && i > 0 && /^\|[-| :]+\|$/.test(lines[i + 1] || '') ? 'th' : 'td';
      if (tag === 'th') headerDone = true;
      out.push(`<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`);
      continue;
    } else if (inTable) {
      out.push('</table>');
      inTable    = false;
      headerDone = false;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${applyInline(line.replace(/^\d+\. /, ''))}</li>`);
      continue;
    } else if (inOl) {
      out.push('</ol>');
      inOl = false;
    }

    // Headings
    if (/^## /.test(line))  { out.push(`<h2>${applyInline(line.slice(3))}</h2>`); continue; }
    if (/^### /.test(line)) { out.push(`<h3>${applyInline(line.slice(4))}</h3>`); continue; }

    // HR
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); continue; }

    // Italic footer line
    if (/^\*[^*]/.test(line) && line.endsWith('*')) {
      out.push(`<p class="footer">${line.slice(1, -1)}</p>`); continue;
    }

    // Blank line
    if (line.trim() === '') { out.push(''); continue; }

    // Regular paragraph
    out.push(`<p>${applyInline(line)}</p>`);
  }

  if (inTable) out.push('</table>');
  if (inOl)    out.push('</ol>');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;margin:0 auto;padding:24px 20px;color:#111;background:#fff;font-size:15px;line-height:1.55}
  h2{font-size:22px;margin:0 0 4px;border-bottom:2px solid #e5e7eb;padding-bottom:10px}
  h3{font-size:15px;font-weight:700;margin:22px 0 6px;color:#374151;text-transform:uppercase;letter-spacing:.4px}
  table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:14px}
  th{background:#f3f4f6;text-align:left;padding:7px 12px;font-weight:600;border-bottom:2px solid #e5e7eb}
  td{padding:7px 12px;border-bottom:1px solid #f3f4f6}
  tr:last-child td{border-bottom:none}
  p{margin:6px 0}
  ol{padding-left:20px;margin:6px 0}
  li{margin:4px 0}
  hr{border:none;border-top:1px solid #e5e7eb;margin:20px 0}
  .footer{color:#9ca3af;font-size:12px;font-style:italic;margin-top:16px}
  strong{font-weight:600}
</style>
</head>
<body>
${out.join('\n')}
</body></html>`;
}

function applyInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

exports.handler = async () => {
  console.log('[market-report] Starting');

  const apiKey    = process.env.ANTHROPIC_API_KEY;
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!apiKey)    { console.error('[market-report] Missing ANTHROPIC_API_KEY'); return; }
  if (!gmailUser) { console.error('[market-report] Missing GMAIL_USER'); return; }
  if (!gmailPass) { console.error('[market-report] Missing GMAIL_APP_PASSWORD'); return; }

  const dateStr = getAESTDateString();
  console.log(`[market-report] Generating brief for ${dateStr}`);

  let report;
  try {
    report = await generateMarketReport(apiKey, dateStr);
  } catch (err) {
    console.error('[market-report] Generation error:', err.message);
    return;
  }

  if (!report?.trim()) {
    console.error('[market-report] Empty report — aborting email send');
    return;
  }

  console.log('[market-report] Report ready, sending email…');

  const transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    auth:   { user: gmailUser, pass: gmailPass },
  });

  try {
    const info = await transporter.sendMail({
      from:    `"Morning Market Brief" <${gmailUser}>`,
      to:      RECIPIENT,
      subject: `🌏 Morning Market Brief — ${dateStr}`,
      text:    report,
      html:    markdownToHtml(report),
    });
    console.log(`[market-report] Email sent — messageId: ${info.messageId}`);
  } catch (err) {
    console.error('[market-report] Email error:', err.message);
  }
};
