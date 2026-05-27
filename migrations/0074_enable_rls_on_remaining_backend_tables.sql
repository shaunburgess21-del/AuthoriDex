-- Enable RLS on four backend-only tables that were still RLS-disabled in
-- `public`. Supabase's `rls_disabled_in_public` advisor flags any table in
-- the `public` schema (which is exposed via PostgREST / the Data API) that
-- has RLS disabled as a CRITICAL security issue — without RLS, anyone with
-- the project's anon key could read/write these rows directly.
--
-- The project convention (see migration 0040) used to be DISABLE RLS on
-- server-only tables to silence the older `rls_enabled_no_policy` INFO
-- lint. The newer advisor rule makes that posture unsafe for anything in
-- `public`, so we flip these to ENABLE RLS with no policies:
--
--   - Backend continues to work because it uses the service role, which
--     bypasses RLS by design (see server/supabase.ts).
--   - Anon / authenticated callers hitting these tables via PostgREST get
--     zero rows back (deny-by-default), which is the desired posture for
--     tables that should never be reached from the client.
--
-- Tables covered (all written / read exclusively by the Express backend):
--   - amm_health_check_runs   (AMM operational health audit log, 0063)
--   - site_announcements      (site-wide banner content,            0067)
--   - email_send_log          (outbound-email idempotency log,      0068)
--   - user_rank_snapshots     (weekly rank-delta snapshots,         0071)
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op when already enabled,
-- and `to_regclass` checks keep this safe for environments where any of
-- the tables don't yet exist.

DO $$
DECLARE
  t text;
  backend_only_tables text[] := ARRAY[
    'amm_health_check_runs',
    'site_announcements',
    'email_send_log',
    'user_rank_snapshots'
  ];
BEGIN
  FOREACH t IN ARRAY backend_only_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    ELSE
      RAISE NOTICE 'Skipping %.%: table not present in this environment.', 'public', t;
    END IF;
  END LOOP;
END $$;
