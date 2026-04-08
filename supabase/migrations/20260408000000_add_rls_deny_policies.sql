-- Add explicit deny-all RLS policies to admin-only tables.
-- The service role (used by Netlify functions) bypasses RLS automatically,
-- so backend operations are unaffected. These policies block the anon/
-- authenticated roles from accessing these tables directly via the client API.

-- competition_requests: admin-only, no public access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'competition_requests'
      AND policyname = 'deny_all_competition_requests'
  ) THEN
    CREATE POLICY deny_all_competition_requests
      ON competition_requests
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false);
  END IF;
END$$;

-- admin_notifications: admin-only, no public access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'admin_notifications'
      AND policyname = 'deny_all_admin_notifications'
  ) THEN
    CREATE POLICY deny_all_admin_notifications
      ON admin_notifications
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false);
  END IF;
END$$;
