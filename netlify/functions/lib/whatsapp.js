// netlify/functions/lib/whatsapp.js
// WhatsApp Business Cloud API service helper
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
const API_VERSION     = 'v21.0';
const BASE_URL        = `https://graph.facebook.com/${API_VERSION}`;

// Convert Australian local format (04XXXXXXXX) to WhatsApp E.164 (no +)
const toWhatsAppNumber = (phone) => {
  const digits = (phone || '').replace(/\D/g, '');
  if (/^04\d{8}$/.test(digits))  return '61' + digits.slice(1); // 0412... → 61412...
  if (/^614\d{8}$/.test(digits)) return digits;                 // already international
  return null;
};

const isConfigured = () => !!(PHONE_NUMBER_ID && ACCESS_TOKEN);

// Send a free-form text message (only valid within 24-hour user-initiated window)
const sendTextMessage = async (toPhone, text) => {
  if (!isConfigured()) {
    console.warn('WhatsApp: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set');
    return null;
  }
  const waNumber = toWhatsAppNumber(toPhone);
  if (!waNumber) {
    console.warn('WhatsApp: invalid phone number', toPhone);
    return null;
  }
  try {
    const res = await fetch(`${BASE_URL}/${PHONE_NUMBER_ID}/messages`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   waNumber,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('WhatsApp sendText error:', JSON.stringify(data)); return null; }
    return data;
  } catch (err) {
    console.error('WhatsApp sendText fetch error:', err.message);
    return null;
  }
};

// Send a pre-approved message template (works at any time, no 24-hr restriction)
// components: array of { type: 'body', parameters: [{ type: 'text', text: '...' }] }
const sendTemplate = async (toPhone, templateName, languageCode = 'en', components = []) => {
  if (!isConfigured()) return null;
  const waNumber = toWhatsAppNumber(toPhone);
  if (!waNumber) return null;
  try {
    const body = {
      messaging_product: 'whatsapp',
      to:   waNumber,
      type: 'template',
      template: {
        name:     templateName,
        language: { code: languageCode },
        ...(components.length > 0 && { components }),
      },
    };
    const res = await fetch(`${BASE_URL}/${PHONE_NUMBER_ID}/messages`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { console.error('WhatsApp sendTemplate error:', JSON.stringify(data)); return null; }
    return data;
  } catch (err) {
    console.error('WhatsApp sendTemplate fetch error:', err.message);
    return null;
  }
};

// ── Convenience notification helpers ──────────────────────────────────────────

// Welcome a new member after sign-up
const sendWelcome = (phone, firstName) =>
  sendTemplate(phone, 'punting_club_welcome', 'en', [
    { type: 'body', parameters: [{ type: 'text', text: firstName }] },
  ]);

// Confirm a bet was successfully submitted
const sendBetConfirmation = (phone, teamName, stake, legs) =>
  sendTemplate(phone, 'punting_club_bet_submitted', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: teamName },
        { type: 'text', text: `$${(stake / 100).toFixed(2)}` },
        { type: 'text', text: String(legs) },
      ],
    },
  ]);

// Notify about a bet result (won / lost / void / partial)
const sendBetResult = (phone, teamName, result, estimatedReturn) => {
  const emoji  = result === 'won' ? '🎉' : result === 'lost' ? '😔' : 'ℹ️';
  const detail = result === 'won'
    ? `Your bet WON! Estimated return: $${(estimatedReturn / 100).toFixed(2)}`
    : result === 'lost' ? 'Your bet was a loss this week.'
    : result === 'void' ? 'Your bet has been voided.'
    : 'Your bet result has been updated.';
  return sendTemplate(phone, 'punting_club_bet_result', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: teamName },
        { type: 'text', text: emoji },
        { type: 'text', text: detail },
      ],
    },
  ]);
};

// Notify user of KYC status change
const sendKycUpdate = (phone, firstName, status) => {
  const message = status === 'approved'
    ? 'Your identity has been verified — you\'re all set to play!'
    : status === 'rejected'
    ? 'Unfortunately your ID could not be verified. Please contact support.'
    : 'Your KYC verification is pending review.';
  return sendTemplate(phone, 'punting_club_kyc_update', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: message },
      ],
    },
  ]);
};

// Notify user they've been approved to join a team
const sendMemberApproved = (phone, firstName, teamName) =>
  sendTemplate(phone, 'punting_club_member_approved', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: teamName },
      ],
    },
  ]);

// Notify user their request to join a team was rejected
const sendMemberRejected = (phone, firstName, teamName) =>
  sendTemplate(phone, 'punting_club_member_rejected', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: teamName },
      ],
    },
  ]);

module.exports = {
  toWhatsAppNumber,
  isConfigured,
  sendTextMessage,
  sendTemplate,
  sendWelcome,
  sendBetConfirmation,
  sendBetResult,
  sendKycUpdate,
  sendMemberApproved,
  sendMemberRejected,
};
