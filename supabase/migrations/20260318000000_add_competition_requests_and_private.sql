-- Add is_private column to competitions table
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- Create competition_requests table
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

-- Enable RLS (service role bypasses it anyway)
ALTER TABLE competition_requests ENABLE ROW LEVEL SECURITY;
