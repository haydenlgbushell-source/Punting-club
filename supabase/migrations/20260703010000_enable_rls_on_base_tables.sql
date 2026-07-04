-- Defence-in-depth: enable Row Level Security on the base tables that hold user
-- and competition data. The application accesses these exclusively through the
-- service-role key inside Netlify Functions, which bypasses RLS — so enabling RLS
-- with NO permissive policy denies all anon/authenticated access by default and
-- does not affect the app. This protects the data if the anon/publishable key is
-- ever exposed to the browser.
--
-- Tables that already manage their own RLS/policies (weekly_recaps,
-- competition_requests, admin_notifications) are intentionally omitted.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users', 'teams', 'team_members', 'bets', 'bet_legs',
    'competitions', 'betting_order', 'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;
