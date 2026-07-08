-- Phase 1: schema prep for community_insights → comments merge.
--
-- Adds a partial index on comments for the "list top-level profile posts for a
-- person" query that becomes the primary read path after Phase 3 cutover
-- (replaces GET /api/community-insights/:personId, which currently scans
-- community_insights with a group-by + order-by upvote net).
--
-- After cutover, GET /api/comments?parentType=community_insight&parentId=<personId>&topLevelOnly=true
-- uses this index: it scopes to top-level profile posts (parent_comment_id IS NULL)
-- for one person, newest-first. The existing comments_parent_idx on
-- (parent_type, parent_id) keeps covering replies.
--
-- Idempotent (IF NOT EXISTS). Safe to deploy independently. Zero risk to the
-- running app — no code reads this index until Phase 3.
-- Not CONCURRENTLY: db-deploy-migrate.cjs runs each migration in a txn.

CREATE INDEX IF NOT EXISTS comments_community_insight_top_level_idx
  ON public.comments (parent_id, created_at DESC)
  WHERE parent_type = 'community_insight' AND parent_comment_id IS NULL;
