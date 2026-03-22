// netlify/functions/whatsapp.js
// WhatsApp Business webhook handler
//
// Meta requires a public HTTPS endpoint that:
//   GET  /api/whatsapp  — verifies the webhook with a hub.challenge
//   POST /api/whatsapp  — receives incoming message events
//
// Required environment variables:
//   WHATSAPP_PHONE_NUMBER_ID  — your WhatsApp Business phone number ID
//   WHATSAPP_ACCESS_TOKEN     — permanent system user access token
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN — arbitrary secret you set in Meta dashboard

const { createClient } = require('@supabase/supabase-js');
const { sendTextMessage } = require('./lib/whatsapp');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  // ── Webhook Verification (GET) ─────────────────────────────────────────────
  // Meta sends a GET with hub.mode=subscribe, hub.verify_token, hub.challenge
  if (event.httpMethod === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } =
      event.queryStringParameters || {};

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WhatsApp webhook verified');
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: challenge };
    }
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // ── Incoming Message Events (POST) ────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    // Acknowledge immediately — Meta requires a 200 within 5 seconds
    // Process asynchronously (best-effort, errors are logged but not re-thrown)
    processIncomingWebhook(body).catch(err =>
      console.error('WhatsApp webhook processing error:', err.message)
    );

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'ok' }) };
  }

  return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
};

// ── Process incoming webhook payload ─────────────────────────────────────────
async function processIncomingWebhook(payload) {
  const entry = payload?.entry?.[0];
  const changes = entry?.changes?.[0];
  if (changes?.field !== 'messages') return;

  const value    = changes.value || {};
  const messages = value.messages || [];
  const contacts = value.contacts || [];

  for (const msg of messages) {
    const fromNumber = msg.from; // E.164 format without +, e.g. "61412345678"
    const msgType    = msg.type;
    const msgText    = msg.text?.body || '';

    console.log(`WhatsApp inbound from ${fromNumber}: [${msgType}] ${msgText.slice(0, 100)}`);

    // Look up user by phone number
    const localPhone = fromNumberToLocal(fromNumber);
    const { data: user } = localPhone
      ? await supabase.from('users').select('id, first_name, phone, whatsapp_opt_in').eq('phone', localPhone).maybeSingle()
      : { data: null };

    if (!user) {
      // Unknown number — send a generic reply
      await sendTextMessage(fromNumber, '👋 Hi! This is Punting Club. We couldn\'t find an account linked to this number. Sign up at puntingclub.app');
      continue;
    }

    // Handle opt-out keywords (STOP / UNSUBSCRIBE)
    if (msgType === 'text' && /^(stop|unsubscribe|optout|opt.?out)$/i.test(msgText.trim())) {
      await supabase.from('users').update({ whatsapp_opt_in: false }).eq('id', user.id);
      await sendTextMessage(fromNumber, `You've been unsubscribed from Punting Club WhatsApp notifications. Reply START to re-subscribe.`);
      continue;
    }

    // Handle opt-in keyword
    if (msgType === 'text' && /^(start|subscribe|yes)$/i.test(msgText.trim())) {
      await supabase.from('users').update({ whatsapp_opt_in: true }).eq('id', user.id);
      await sendTextMessage(fromNumber, `Welcome back, ${user.first_name}! 🎉 You're now subscribed to Punting Club notifications.`);
      continue;
    }

    // Log inbound message to admin notifications so admins can see engagement
    await supabase.from('admin_notifications').insert({
      type:    'whatsapp_inbound',
      title:   `WhatsApp message from ${user.first_name}`,
      message: msgText.slice(0, 500) || `[${msgType}]`,
      data:    { userId: user.id, phone: localPhone, fromNumber, msgType },
    });

    // Auto-reply for unrecognised messages
    if (msgType === 'text') {
      await sendTextMessage(fromNumber,
        `Hi ${user.first_name}! 👋 Thanks for reaching out. For support visit puntingclub.app or contact your competition admin. Reply STOP to unsubscribe from notifications.`
      );
    }
  }
}

// Convert WhatsApp E.164-style number (61412...) back to Australian local (04...)
function fromNumberToLocal(waNumber) {
  const digits = (waNumber || '').replace(/\D/g, '');
  if (/^614\d{8}$/.test(digits)) return '0' + digits.slice(2);
  if (/^04\d{8}$/.test(digits))  return digits;
  return null;
}
