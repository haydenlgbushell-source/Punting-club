-- Add pub admin credentials to competitions table.
-- When a competition request is approved, auto-generated credentials are stored here
-- so the requester can log in as a pub_admin scoped to their competition.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS admin_username TEXT,
  ADD COLUMN IF NOT EXISTS admin_password TEXT;

-- Unique constraint so no two competitions share the same admin username
CREATE UNIQUE INDEX IF NOT EXISTS competitions_admin_username_idx
  ON competitions (admin_username)
  WHERE admin_username IS NOT NULL;
