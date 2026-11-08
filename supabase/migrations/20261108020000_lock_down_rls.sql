-- Lock down direct database access.
--
-- The app reads and writes ONLY through the Netlify functions, which use the
-- service-role key (that key bypasses Row Level Security). Nothing should be
-- readable with the public anon/publishable key — which the browser needs for
-- Google / Apple sign-in.
--
-- Found on the live database (Nov 2026): RLS was DISABLED on users, teams,
-- team_members, bets, bet_legs, competitions and audit_log, so anyone with the
-- anon key could read every member's phone number and date of birth. The
-- earlier migration 20260703010000 that enabled RLS had never been applied.
--
-- This migration:
--   1. enables RLS on every table in the public schema, and
--   2. drops the old client-side policies. The app doesn't use them, and two of
--      them were unsafe once RLS is on: "users_own_record" (FOR ALL) would let a
--      signed-in member edit their own role / KYC status directly, and
--      "see_team_members" queries its own table (infinite recursion).
-- weekly_recaps keeps its "Public read access" policy (published recaps only).

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS users_own_record      ON public.users;
DROP POLICY IF EXISTS team_members_see_team ON public.teams;
DROP POLICY IF EXISTS see_team_members      ON public.team_members;
DROP POLICY IF EXISTS see_team_bets         ON public.bets;
DROP POLICY IF EXISTS see_active_competitions ON public.competitions;
