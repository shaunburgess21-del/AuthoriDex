-- Author-timeline index for /me/comments history + profile comment count.
-- Mirrors index("comments_user_created_idx") in shared/schema.ts.
-- Idempotent (IF NOT EXISTS) so re-running on deploy is a safe no-op.
-- Not CONCURRENTLY: db-deploy-migrate.cjs runs each migration in a txn.

CREATE INDEX IF NOT EXISTS comments_user_created_idx
  ON public.comments (user_id, created_at);
