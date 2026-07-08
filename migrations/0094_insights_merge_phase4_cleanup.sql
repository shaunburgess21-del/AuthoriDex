-- Phase 4: cleanup drop for community_insights → comments merge.
--
-- DEPLOY NOTE: this file is intentionally NOT in migrations/meta/_journal.json
-- for the initial merge deploy. The first deploy runs 0092 + 0093 plus the
-- Phase 3 code cutover; the legacy tables stay in place (dormant, unreferenced)
-- so the previous release can still be rolled back cleanly. Once production is
-- confirmed stable, add this file's journal entry (idx 96) and deploy again —
-- the deploy migration runner will then apply the drop.
--
-- Drops the legacy community_insights + insight_votes tables after the Phase 3
-- code cutover confirmed all reads/writes now flow through the unified comments
-- + comment_votes tables. RLS policies go with the tables.
--
-- Prerequisites (must all be true before running):
--   * Phase 1 (0092) partial index is in place.
--   * Phase 2 (0093) backfill migrated all community_insights → comments rows
--     and insight_votes → comment_votes rows (validation guards passed).
--   * Phase 3 code cutover is deployed: no code reads from or writes to
--     community_insights or insight_votes. The 5 /api/community-insights*
--     routes are gone; the admin moderation Insights tab is gone; the agent
--     insight sweep is gone; all services (badges, voices, credit-history,
--     vote-action, most-discussed) read from comments.
--
-- Order: drop insight_votes first (it has a FK to community_insights with
-- ON DELETE CASCADE, so dropping community_insights first would cascade-drop
-- insight_votes anyway, but explicit is safer and clearer).
--
-- CASCADE on the DROP handles any remaining FK references from other tables
-- (none expected at this point — Phase 3 removed all code references).

DROP TABLE IF EXISTS public.insight_votes CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS public.community_insights CASCADE;
--> statement-breakpoint

-- Validation: both tables must be gone.
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('community_insights', 'insight_votes');

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'Phase 4 cleanup incomplete: % of 2 legacy tables still present', remaining;
  END IF;

  RAISE NOTICE 'Phase 4 cleanup complete: community_insights + insight_votes dropped';
END$$;
