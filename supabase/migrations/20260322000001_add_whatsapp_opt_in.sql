-- Migration: add WhatsApp opt-in preference to users table
-- Allows users to control whether they receive WhatsApp Business notifications.
-- Default is true — users can opt out by replying STOP to a WhatsApp message,
-- or via the app settings screen.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT true;

-- Index so we can efficiently query opted-in users (e.g. bulk notifications)
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_opt_in
  ON users (whatsapp_opt_in)
  WHERE whatsapp_opt_in = true;

COMMENT ON COLUMN users.whatsapp_opt_in IS
  'Whether the user has opted in to WhatsApp Business notifications from Punting Club.';
