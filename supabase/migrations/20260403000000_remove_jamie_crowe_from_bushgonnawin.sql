-- ============================================================
-- Remove Jamie Crowe from the Bushgonnawin team
-- Jamie Crowe is not a member of Bushgonnawin and should not
-- appear in their betting order.
-- ============================================================

DO $$
DECLARE
  v_user_id  uuid;
  v_team_id  uuid;
BEGIN
  -- Resolve Jamie Crowe's user ID
  SELECT id INTO v_user_id
  FROM users
  WHERE lower(first_name) = 'jamie'
    AND lower(last_name)  = 'crowe'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User Jamie Crowe not found — skipping.';
    RETURN;
  END IF;

  -- Resolve the Bushgonnawin team ID
  SELECT id INTO v_team_id
  FROM teams
  WHERE lower(team_name) = 'bushgonnawin'
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE NOTICE 'Team Bushgonnawin not found — skipping.';
    RETURN;
  END IF;

  -- Remove from betting_order
  DELETE FROM betting_order
  WHERE team_id = v_team_id
    AND user_id = v_user_id;

  -- Remove from team_members (unless they are the team captain)
  DELETE FROM team_members
  WHERE team_id = v_team_id
    AND user_id = v_user_id
    AND role != 'captain';

  RAISE NOTICE 'Jamie Crowe removed from Bushgonnawin (team_id=%, user_id=%).', v_team_id, v_user_id;
END;
$$;
