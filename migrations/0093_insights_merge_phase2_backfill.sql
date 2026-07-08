-- Phase 2: data backfill for community_insights → comments merge.
--
-- Migrates community_insights rows + insight_votes rows into the unified
-- comments + comment_votes tables, preserving UUIDs so deep links,
-- XP/credit idempotency keys, notifications, and vote-action history all
-- keep matching.
--
-- Three steps inside one DO block:
--   1. Insert insights → comments (top-level profile posts). parent_id becomes
--      the personId; parent_comment_id is NULL; upvotes/downvotes are backfilled
--      from insight_votes counts. sentiment_vote is dropped (0 rows have it set).
--   2. Rewire existing reply comments. parent_id was the insightId, becomes the
--      personId; parent_comment_id was null for top-level replies, becomes the
--      old insightId (which is now the top-level comment id via the id-preserved
--      insert above). Nested replies (parent_comment_id already set) get only
--      the parent_id update via COALESCE.
--   3. Migrate insight_votes → comment_votes preserving UUIDs. vote_type is text
--      in insight_votes, cast to comment_vote_type enum. Fallback insert with a
--      fresh UUID handles the rare case of UUID collision with an existing
--      comment_votes row.
--
-- Old community_insights + insight_votes tables STILL EXIST after this phase;
-- old code still reads/writes them; new rows in comments + comment_votes are
-- dormant duplicates. App behavior is unchanged.
--
-- Idempotent: re-running is a no-op (ON CONFLICT DO NOTHING on the inserts;
-- the UPDATE is a no-op once parent_id no longer matches a community_insights
-- row, because the WHERE clause `c.parent_id = ci.id` filters it out).
-- Validation guards RAISE EXCEPTION if any row failed to migrate.
--
-- Pattern follows 0025_unified_comments_backfill.sql. Take a pg_dump backup of
-- community_insights + insight_votes immediately before running on staging/prod.

DO $$
DECLARE
  pre_insights integer;
  pre_comment_votes integer;
  migrated_insights integer;
  rewired_replies integer;
  migrated_votes integer;
BEGIN
  -- Snapshot pre-migration counts for the validation log.
  SELECT COUNT(*) INTO pre_insights FROM community_insights;
  SELECT COUNT(*) INTO pre_comment_votes FROM comment_votes;

  -- 1. Insert insights → comments preserving UUIDs.
  INSERT INTO comments (id, parent_type, parent_id, parent_comment_id, user_id, body, upvotes, downvotes, deleted_at, created_at, updated_at)
  SELECT
    ci.id,
    'community_insight'::comment_parent_type,
    ci.person_id,
    NULL,
    ci.user_id,
    ci.content,
    COALESCE((SELECT COUNT(*)::int FROM insight_votes WHERE insight_id = ci.id AND vote_type = 'up'), 0),
    COALESCE((SELECT COUNT(*)::int FROM insight_votes WHERE insight_id = ci.id AND vote_type = 'down'), 0),
    ci.deleted_at,
    ci.created_at,
    ci.created_at
  FROM community_insights ci
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS migrated_insights = ROW_COUNT;

  -- 2. Rewire existing reply comments.
  --    For top-level replies (parent_comment_id IS NULL): parent_id was the
  --    insightId, becomes the personId; parent_comment_id was NULL, becomes the
  --    old insightId (which is now the top-level comment id — preserved via the
  --    id-preserving insert above).
  --    For nested replies (parent_comment_id IS NOT NULL): only parent_id
  --    changes; parent_comment_id stays via COALESCE.
  --    In Postgres, SET expressions read from the OLD row state, so
  --    `c.parent_id` in the COALESCE refers to the pre-update insightId.
  UPDATE comments c
  SET parent_id = ci.person_id,
      parent_comment_id = COALESCE(c.parent_comment_id, c.parent_id)
  FROM community_insights ci
  WHERE c.parent_type = 'community_insight'
    AND c.parent_id = ci.id;

  GET DIAGNOSTICS rewired_replies = ROW_COUNT;

  -- 3. Migrate insight_votes → comment_votes preserving UUIDs.
  INSERT INTO comment_votes (id, comment_id, user_id, vote_type, voted_at)
  SELECT iv.id, iv.insight_id, iv.user_id, iv.vote_type::comment_vote_type, iv.voted_at
  FROM insight_votes iv
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS migrated_votes = ROW_COUNT;

  -- Fallback for the rare case where an insight_votes UUID collided with an
  -- existing comment_votes UUID (ON CONFLICT (id) DO NOTHING skipped it above).
  -- Insert with a fresh UUID (default gen_random_uuid()) to preserve the vote.
  -- The (user_id, comment_id) unique constraint catches any actual duplicate.
  INSERT INTO comment_votes (comment_id, user_id, vote_type, voted_at)
  SELECT iv.insight_id, iv.user_id, iv.vote_type::comment_vote_type, iv.voted_at
  FROM insight_votes iv
  WHERE NOT EXISTS (
    SELECT 1 FROM comment_votes cv
    WHERE cv.comment_id = iv.insight_id AND cv.user_id = iv.user_id
  )
  ON CONFLICT (user_id, comment_id) DO NOTHING;

  RAISE NOTICE 'Phase 2 backfill: % insights inserted, % reply rewires, % votes migrated (pre: % insights, % comment_votes)',
    migrated_insights, rewired_replies, migrated_votes, pre_insights, pre_comment_votes;
END$$;
--> statement-breakpoint

-- Validation guards. RAISE EXCEPTION if any row failed to migrate.
-- The whole migration runs in one txn, so a failure here rolls back step 1-3.
DO $$
DECLARE
  top_level_insights integer;
  top_level_comments integer;
  orphan_insight_votes integer;
  orphan_reply_comments integer;
BEGIN
  -- Every community_insights row should have a matching top-level comments row.
  SELECT COUNT(*) INTO top_level_insights FROM community_insights;
  SELECT COUNT(*) INTO top_level_comments FROM comments
    WHERE parent_type = 'community_insight' AND parent_comment_id IS NULL;

  IF top_level_comments < top_level_insights THEN
    RAISE EXCEPTION 'Phase 2 backfill incomplete: % community_insights rows but only % top-level community_insight comments',
      top_level_insights, top_level_comments;
  END IF;

  -- Every insight_vote must have a matching comment_vote row (by comment_id + user_id).
  SELECT COUNT(*) INTO orphan_insight_votes
  FROM insight_votes iv
  WHERE NOT EXISTS (
    SELECT 1 FROM comment_votes cv
    WHERE cv.comment_id = iv.insight_id AND cv.user_id = iv.user_id
  );

  IF orphan_insight_votes > 0 THEN
    RAISE EXCEPTION 'Phase 2 backfill incomplete: % insight_votes rows have no matching comment_votes row',
      orphan_insight_votes;
  END IF;

  -- No reply comment should still reference a community_insights.id as its parent_id.
  -- (After rewire, all reply comments have parent_id = personId, not insightId.)
  SELECT COUNT(*) INTO orphan_reply_comments
  FROM comments c
  WHERE c.parent_type = 'community_insight'
    AND c.parent_comment_id IS NULL
    AND EXISTS (SELECT 1 FROM community_insights ci WHERE ci.id = c.parent_id);

  IF orphan_reply_comments > 0 THEN
    RAISE EXCEPTION 'Phase 2 backfill incomplete: % reply comments still reference community_insights.id as parent_id (rewire missed them)',
      orphan_reply_comments;
  END IF;

  RAISE NOTICE 'Phase 2 validation passed: % insights, % top-level comments, 0 orphan votes, 0 orphan reply comments',
    top_level_insights, top_level_comments;
END$$;
