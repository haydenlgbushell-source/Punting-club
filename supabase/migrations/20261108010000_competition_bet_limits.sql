-- Per-competition betting limits (previously hard-coded to $50/week in the app).
-- Amounts in cents. final_week_limit_cents is the "boosted" limit for the last
-- week; NULL means the normal weekly limit applies.
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS weekly_limit_cents      INTEGER NOT NULL DEFAULT 5000 CHECK (weekly_limit_cents > 0),
  ADD COLUMN IF NOT EXISTS final_week_limit_cents  INTEGER CHECK (final_week_limit_cents IS NULL OR final_week_limit_cents > 0);
