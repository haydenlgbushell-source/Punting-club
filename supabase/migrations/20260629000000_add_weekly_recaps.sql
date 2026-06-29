CREATE TABLE IF NOT EXISTS weekly_recaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  week_number     INTEGER NOT NULL CHECK (week_number > 0),
  headline        TEXT NOT NULL DEFAULT '',
  summary_html    TEXT NOT NULL DEFAULT '',
  stats           JSONB NOT NULL DEFAULT '{}',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(competition_id, week_number)
);

ALTER TABLE weekly_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON weekly_recaps
  FOR SELECT USING (published = true);

CREATE INDEX IF NOT EXISTS idx_weekly_recaps_comp_week
  ON weekly_recaps(competition_id, week_number DESC);
