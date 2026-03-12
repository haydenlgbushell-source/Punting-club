-- ============================================================
-- Fix team_members schema and ensure all required tables exist
-- ============================================================

-- 1. Add betting_order column to team_members if it doesn't exist
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS betting_order integer;

-- 2. Set betting_order = 1 for any existing captains missing it
UPDATE team_members
  SET betting_order = 1
  WHERE role = 'captain' AND betting_order IS NULL;

-- 3. Create betting_order table if it doesn't exist
--    (stores custom ordering per team, separate from team_members.betting_order)
CREATE TABLE IF NOT EXISTS betting_order (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  position   integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (team_id, user_id)
);

-- 4. Repair any captains who are missing their team_members record
--    (insert failed silently if betting_order column was missing during signup)
INSERT INTO team_members (team_id, user_id, role, can_bet, deposit_paid, betting_order)
  SELECT t.id, t.captain_id, 'captain', true, false, 1
  FROM teams t
  LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = t.captain_id
  WHERE t.captain_id IS NOT NULL
    AND tm.user_id IS NULL
ON CONFLICT DO NOTHING;

-- 5. Make sure captains have the captain role in team_members
UPDATE team_members tm
  SET role = 'captain', can_bet = true
  FROM teams t
  WHERE tm.team_id = t.id
    AND tm.user_id = t.captain_id
    AND tm.role != 'captain';
