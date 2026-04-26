-- C3: remove legacy per-surface comment tables after unified comments rollout.
-- Drop FK constraints dynamically so the migration is robust across constraint
-- name truncation differences, then drop vote tables before comment tables.

DO $$
DECLARE
  constraint_record record;
  pre_drop_comments integer;
  pre_drop_votes integer;
  post_drop_comments integer;
  post_drop_votes integer;
  legacy_table_count integer;
BEGIN
  SELECT COUNT(*) INTO pre_drop_comments FROM "comments";
  SELECT COUNT(*) INTO pre_drop_votes FROM "comment_votes";

  FOR constraint_record IN
    WITH legacy_tables(table_name) AS (
      VALUES
        ('insight_comments'),
        ('matchup_comments'),
        ('trending_poll_comments'),
        ('opinion_poll_comments'),
        ('open_market_comments'),
        ('insight_comment_votes_legacy'),
        ('matchup_comment_votes'),
        ('trending_poll_comment_votes'),
        ('opinion_poll_comment_votes'),
        ('open_market_comment_votes')
    ),
    legacy_regclasses AS (
      SELECT to_regclass(format('public.%I', table_name)) AS table_oid
      FROM legacy_tables
      WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL
    )
    SELECT
      con.conname,
      con.conrelid::regclass AS source_table
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND (
        con.conrelid IN (SELECT table_oid FROM legacy_regclasses)
        OR con.confrelid IN (SELECT table_oid FROM legacy_regclasses)
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I',
      constraint_record.source_table,
      constraint_record.conname
    );
  END LOOP;

  EXECUTE 'DROP TABLE IF EXISTS "insight_comment_votes_legacy"';
  EXECUTE 'DROP TABLE IF EXISTS "matchup_comment_votes"';
  EXECUTE 'DROP TABLE IF EXISTS "trending_poll_comment_votes"';
  EXECUTE 'DROP TABLE IF EXISTS "opinion_poll_comment_votes"';
  EXECUTE 'DROP TABLE IF EXISTS "open_market_comment_votes"';

  EXECUTE 'DROP TABLE IF EXISTS "insight_comments"';
  EXECUTE 'DROP TABLE IF EXISTS "matchup_comments"';
  EXECUTE 'DROP TABLE IF EXISTS "trending_poll_comments"';
  EXECUTE 'DROP TABLE IF EXISTS "opinion_poll_comments"';
  EXECUTE 'DROP TABLE IF EXISTS "open_market_comments"';

  SELECT COUNT(*) INTO legacy_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'insight_comments',
      'matchup_comments',
      'trending_poll_comments',
      'opinion_poll_comments',
      'open_market_comments',
      'insight_comment_votes_legacy',
      'matchup_comment_votes',
      'trending_poll_comment_votes',
      'opinion_poll_comment_votes',
      'open_market_comment_votes'
    );

  SELECT COUNT(*) INTO post_drop_comments FROM "comments";
  SELECT COUNT(*) INTO post_drop_votes FROM "comment_votes";

  IF legacy_table_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 legacy comment tables after drop, found %', legacy_table_count;
  END IF;

  IF post_drop_comments <> pre_drop_comments THEN
    RAISE EXCEPTION 'Comments count changed during legacy drop: % -> %', pre_drop_comments, post_drop_comments;
  END IF;

  IF post_drop_votes <> pre_drop_votes THEN
    RAISE EXCEPTION 'Comment_votes count changed during legacy drop: % -> %', pre_drop_votes, post_drop_votes;
  END IF;
END $$;
