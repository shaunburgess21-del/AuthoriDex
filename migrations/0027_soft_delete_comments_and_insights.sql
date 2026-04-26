-- C1: add nullable soft-delete timestamps for user-authored comments and insights.
-- Snapshot row counts before and after the DDL to verify no data movement occurs.

DO $$
DECLARE
  pre_comments_count integer;
  pre_insights_count integer;
  post_comments_count integer;
  post_insights_count integer;
  deleted_at_column_count integer;
BEGIN
  SELECT COUNT(*) INTO pre_comments_count FROM "comments";
  SELECT COUNT(*) INTO pre_insights_count FROM "community_insights";

  EXECUTE 'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp';
  EXECUTE 'ALTER TABLE "community_insights" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp';

  SELECT COUNT(*) INTO post_comments_count FROM "comments";
  SELECT COUNT(*) INTO post_insights_count FROM "community_insights";

  SELECT COUNT(*) INTO deleted_at_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'comments' AND column_name = 'deleted_at')
      OR (table_name = 'community_insights' AND column_name = 'deleted_at')
    );

  IF post_comments_count <> pre_comments_count THEN
    RAISE EXCEPTION 'Comments count changed during deleted_at migration: % -> %', pre_comments_count, post_comments_count;
  END IF;

  IF post_insights_count <> pre_insights_count THEN
    RAISE EXCEPTION 'Community insights count changed during deleted_at migration: % -> %', pre_insights_count, post_insights_count;
  END IF;

  IF deleted_at_column_count <> 2 THEN
    RAISE EXCEPTION 'Expected deleted_at columns on comments and community_insights, found %', deleted_at_column_count;
  END IF;
END $$;
