-- Ensure competition_requests table exists (idempotent re-application)
-- This migration guards against the case where the earlier migration
-- (20260318000000_add_competition_requests_and_private.sql) was committed
-- but not yet applied to the database.

-- Ensure is_private column exists on competitions
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- Create competition_requests table if not exists
CREATE TABLE IF NOT EXISTS competition_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code         TEXT NOT NULL UNIQUE,
  contact_name         TEXT NOT NULL DEFAULT '',
  contact_phone        TEXT NOT NULL DEFAULT '',
  contact_email        TEXT NOT NULL DEFAULT '',
  pub_name             TEXT NOT NULL DEFAULT '',
  comp_name            TEXT NOT NULL DEFAULT '',
  estimated_teams      INTEGER,
  preferred_start_date DATE,
  preferred_end_date   DATE,
  buy_in               INTEGER,
  is_private           BOOLEAN NOT NULL DEFAULT false,
  notes                TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'declined')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (service role bypasses it)
ALTER TABLE competition_requests ENABLE ROW LEVEL SECURITY;

-- Create admin_notifications table if not exists
CREATE TABLE IF NOT EXISTS admin_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('new_team', 'competition_request', 'new_member')),
  title       TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  data        JSONB NOT NULL DEFAULT '{}',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (service role bypasses it)
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

-- Indexes for admin_notifications (IF NOT EXISTS guards re-runs)
CREATE INDEX IF NOT EXISTS idx_admin_notifications_read ON admin_notifications(read);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created ON admin_notifications(created_at DESC);
