-- Tighten RLS posture by disabling RLS on tables that are *only* ever
-- accessed by the backend (service role).
--
-- Background:
-- Migration 0029 enabled RLS on every public table. The service role
-- bypasses RLS by design, so the server kept working — but the Supabase
-- advisor surfaces "RLS enabled, no policy" as INFO findings on every
-- such table because, from its perspective, RLS-without-policies looks
-- like a misconfiguration.
--
-- Two valid postures exist:
--
--   1. Backend-only tables (logs, caches, agent state, ingestion runs,
--      schema versioning, raw metric snapshots): no client should ever
--      see these. Disabling RLS removes the lint noise without changing
--      behaviour, and avoids us having to maintain dummy policies.
--
--   2. User-data and user-facing content tables (profiles, comments,
--      votes, polls, insights, market entries, etc.): we leave RLS
--      ENABLED with no policies. Today the client never queries these
--      directly (everything goes through Express + service role), so
--      this is a no-op. But if a future contributor wires up a
--      `supabase.from('profiles')…` call on the client, they'll get
--      an empty result instead of silently leaking data — that's
--      defense-in-depth worth keeping.
--
-- This migration handles posture #1 only. Posture #2 is preserved as-is.
-- See SECURITY.md for the project's overall data-access pattern.
--
-- Idempotent: ALTER TABLE ... DISABLE RLS is a no-op when RLS is already
-- disabled. Wrapped in `to_regclass` checks so missing tables in dev
-- environments don't crash the deploy.

DO $$
DECLARE
  t text;
  server_only_tables text[] := ARRAY[
    'admin_audit_log',           -- audit trail, written by server only
    'agent_configs',             -- AI-agent runtime configuration
    'agent_memory',              -- AI-agent persistent memory
    'agent_performance',         -- AI-agent metrics
    'api_cache',                 -- HTTP/external-API response cache
    'approval_snapshots',        -- daily approval-rating snapshots
    'celebrity_metrics',         -- raw metric rollups
    'ingestion_runs',            -- batch-ingestion bookkeeping
    'page_views',                -- analytics
    'platform_status',           -- system status banners (server-managed)
    'scheduled_agent_actions',   -- AI-agent scheduling queue
    'schema_migrations',         -- migration tracker (this very script writes it)
    'tier1_overrides',           -- editorial overrides
    'trend_snapshots',           -- daily trend score snapshots
    'trending_people',           -- materialised trending list
    'xp_actions'                 -- XP rule definitions
  ];
BEGIN
  FOREACH t IN ARRAY server_only_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    ELSE
      RAISE NOTICE 'Skipping %.%: table not present in this environment.', 'public', t;
    END IF;
  END LOOP;
END $$;
