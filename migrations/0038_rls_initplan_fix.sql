-- Fix Supabase advisor warning `auth_rls_initplan` on 6 RLS policies.
--
-- Background:
-- A policy of the form `USING (auth.uid()::text = user_id)` re-evaluates
-- `auth.uid()` for every row scanned. At scale this turns a cheap index
-- lookup into a per-row function call. Wrapping the call in `(select ...)`
-- lets Postgres execute it once per query (initplan) and cache the result.
-- See https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Behavioural change: none. The predicate is logically identical; only
-- the per-row vs per-query evaluation differs. RLS continues to allow each
-- authenticated user to read/write only their own rows, and the service
-- role (server-side) continues to bypass RLS entirely.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Safe to re-run.

-- ─── user_votes ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_votes_owner_all" ON public.user_votes;
CREATE POLICY "user_votes_owner_all" ON public.user_votes
  FOR ALL
  TO authenticated
  USING ((select auth.uid())::text = user_id)
  WITH CHECK ((select auth.uid())::text = user_id);

-- ─── user_favourites ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_favourites_owner_all" ON public.user_favourites;
CREATE POLICY "user_favourites_owner_all" ON public.user_favourites
  FOR ALL
  TO authenticated
  USING ((select auth.uid())::text = user_id)
  WITH CHECK ((select auth.uid())::text = user_id);

-- ─── notifications (SELECT) ────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_owner_select" ON public.notifications;
CREATE POLICY "notifications_owner_select" ON public.notifications
  FOR SELECT
  TO authenticated
  USING ((select auth.uid())::text = user_id);

-- ─── notifications (UPDATE) ────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_owner_update" ON public.notifications;
CREATE POLICY "notifications_owner_update" ON public.notifications
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid())::text = user_id)
  WITH CHECK ((select auth.uid())::text = user_id);

-- ─── notification_preferences ──────────────────────────────────────────────
DROP POLICY IF EXISTS "notification_preferences_owner_all" ON public.notification_preferences;
CREATE POLICY "notification_preferences_owner_all" ON public.notification_preferences
  FOR ALL
  TO authenticated
  USING ((select auth.uid())::text = user_id)
  WITH CHECK ((select auth.uid())::text = user_id);

-- ─── notification_market_mutes ─────────────────────────────────────────────
DROP POLICY IF EXISTS "notification_market_mutes_owner_all" ON public.notification_market_mutes;
CREATE POLICY "notification_market_mutes_owner_all" ON public.notification_market_mutes
  FOR ALL
  TO authenticated
  USING ((select auth.uid())::text = user_id)
  WITH CHECK ((select auth.uid())::text = user_id);
