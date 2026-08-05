-- Close Supabase advisor CRITICAL finding `rls_disabled_in_public` on
-- funnel_events (added in 0101 without RLS).
--
-- Posture matches migration 0074 / SECURITY.md: ENABLE RLS with no policies.
-- Express uses the service role (bypasses RLS). Anon/authenticated Data API
-- callers get deny-by-default.

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
