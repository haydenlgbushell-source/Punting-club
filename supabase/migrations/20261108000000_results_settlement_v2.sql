-- Results settlement v2
--
-- 1) Structured bet-leg fields, extracted by the AI when a slip is uploaded, so
--    the settler can build precise searches and settle most markets in code.
-- 2) Evidence / review fields so every automatic result carries a quote and a
--    source link, and anything uncertain is flagged for an admin instead of guessed.
-- 3) An event_results cache: each match/race is looked up once and every bet
--    on it reuses the stored facts.
--
-- The application code tolerates this migration not being applied yet (it falls
-- back to the old columns), but the new accuracy features need it.

ALTER TABLE bet_legs
  ADD COLUMN IF NOT EXISTS sport              TEXT,
  ADD COLUMN IF NOT EXISTS competition        TEXT,
  ADD COLUMN IF NOT EXISTS home_team          TEXT,
  ADD COLUMN IF NOT EXISTS away_team          TEXT,
  ADD COLUMN IF NOT EXISTS market_type        TEXT,
  ADD COLUMN IF NOT EXISTS line               NUMERIC,
  ADD COLUMN IF NOT EXISTS player             TEXT,
  ADD COLUMN IF NOT EXISTS venue              TEXT,
  ADD COLUMN IF NOT EXISTS race_number        INTEGER,
  ADD COLUMN IF NOT EXISTS runner_number      INTEGER,
  ADD COLUMN IF NOT EXISTS result_source_url  TEXT,
  ADD COLUMN IF NOT EXISTS result_evidence    TEXT,
  ADD COLUMN IF NOT EXISTS settled_by         TEXT,      -- 'auto' | 'admin'
  ADD COLUMN IF NOT EXISTS needs_review       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS check_attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checked_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bet_legs_needs_review ON bet_legs(needs_review) WHERE needs_review;

CREATE TABLE IF NOT EXISTS event_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key     TEXT NOT NULL UNIQUE,
  sport         TEXT,
  event         TEXT,
  event_date    DATE,
  finished      BOOLEAN NOT NULL DEFAULT false,
  facts         JSONB NOT NULL DEFAULT '{}',
  source_url    TEXT,
  evidence      TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role only (same model as the other base tables).
ALTER TABLE event_results ENABLE ROW LEVEL SECURITY;

-- Allow the settler to notify admins about legs that need a manual decision.
ALTER TABLE admin_notifications
  DROP CONSTRAINT IF EXISTS admin_notifications_type_check;

ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN ('new_team', 'competition_request', 'new_member', 'weekly_recap', 'results_review'));
