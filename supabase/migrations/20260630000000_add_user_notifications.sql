-- User-facing notifications (bet results, weekly recaps published)
-- Mirrors admin_notifications but scoped to the user/team it concerns.
CREATE TABLE IF NOT EXISTS user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('bet_won', 'bet_lost', 'bet_partial', 'recap_ready')),
  title       TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  data        JSONB NOT NULL DEFAULT '{}',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (service role bypasses it)
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON user_notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_user_notifications_created ON user_notifications(created_at DESC);

-- admin_notifications.type never included 'weekly_recap', so the insert in
-- generate-recap-background.js has been silently failing (swallowed by .catch).
-- Widen the constraint to match actual usage.
ALTER TABLE admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE admin_notifications ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN ('new_team', 'competition_request', 'new_member', 'weekly_recap'));
