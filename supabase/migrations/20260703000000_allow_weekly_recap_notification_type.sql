-- The recap generator inserts admin_notifications rows with type 'weekly_recap',
-- but the original CHECK constraint only permitted new_team/competition_request/new_member,
-- so those inserts silently failed and admins never saw recap notifications.
-- Widen the allowed set to include 'weekly_recap'.

ALTER TABLE admin_notifications
  DROP CONSTRAINT IF EXISTS admin_notifications_type_check;

ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN ('new_team', 'competition_request', 'new_member', 'weekly_recap'));
