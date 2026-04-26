DO $$
BEGIN
  CREATE TYPE "comment_parent_type" AS ENUM (
    'community_insight',
    'matchup',
    'trending_poll',
    'opinion_poll',
    'open_market'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "comment_vote_type" AS ENUM ('up', 'down');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.comment_votes') IS NOT NULL
     AND to_regclass('public.insight_comment_votes_legacy') IS NULL THEN
    ALTER TABLE "comment_votes" RENAME TO "insight_comment_votes_legacy";
  END IF;
END$$;
--> statement-breakpoint
CREATE TABLE "comments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_type" "comment_parent_type" NOT NULL,
  "parent_id" varchar NOT NULL,
  "parent_comment_id" varchar,
  "user_id" varchar NOT NULL,
  "body" text NOT NULL,
  "upvotes" integer DEFAULT 0 NOT NULL,
  "downvotes" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" ("parent_type", "parent_id");
--> statement-breakpoint
CREATE INDEX "comments_parent_comment_idx" ON "comments" ("parent_comment_id");
--> statement-breakpoint
CREATE TABLE "comment_votes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" varchar NOT NULL,
  "user_id" varchar NOT NULL,
  "vote_type" "comment_vote_type" NOT NULL,
  "voted_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "comment_votes_user_comment_unique" UNIQUE ("user_id", "comment_id")
);
--> statement-breakpoint
CREATE INDEX "comment_votes_comment_idx" ON "comment_votes" ("comment_id");
--> statement-breakpoint
INSERT INTO "comments" (
  "id",
  "parent_type",
  "parent_id",
  "parent_comment_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
)
SELECT
  c."id",
  'community_insight'::"comment_parent_type",
  c."insight_id",
  c."parent_id",
  c."user_id",
  c."content",
  COALESCE(v."upvotes", 0),
  COALESCE(v."downvotes", 0),
  c."created_at",
  c."created_at"
FROM "insight_comments" c
LEFT JOIN (
  SELECT
    "comment_id",
    COUNT(*) FILTER (WHERE "vote_type" = 'up')::integer AS "upvotes",
    COUNT(*) FILTER (WHERE "vote_type" = 'down')::integer AS "downvotes"
  FROM "insight_comment_votes_legacy"
  GROUP BY "comment_id"
) v ON v."comment_id" = c."id";
--> statement-breakpoint
INSERT INTO "comments" (
  "id",
  "parent_type",
  "parent_id",
  "parent_comment_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  'matchup'::"comment_parent_type",
  "matchup_id",
  "parent_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
FROM "matchup_comments";
--> statement-breakpoint
INSERT INTO "comments" (
  "id",
  "parent_type",
  "parent_id",
  "parent_comment_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  'trending_poll'::"comment_parent_type",
  "poll_id",
  "parent_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
FROM "trending_poll_comments";
--> statement-breakpoint
INSERT INTO "comments" (
  "id",
  "parent_type",
  "parent_id",
  "parent_comment_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  'opinion_poll'::"comment_parent_type",
  "poll_id",
  "parent_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
FROM "opinion_poll_comments";
--> statement-breakpoint
INSERT INTO "comments" (
  "id",
  "parent_type",
  "parent_id",
  "parent_comment_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  'open_market'::"comment_parent_type",
  "market_id",
  "parent_id",
  "user_id",
  "body",
  "upvotes",
  "downvotes",
  "created_at",
  "updated_at"
FROM "open_market_comments";
--> statement-breakpoint
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_parent_comment_id_fkey"
  FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;
--> statement-breakpoint
INSERT INTO "comment_votes" ("id", "comment_id", "user_id", "vote_type", "voted_at")
SELECT "id", "comment_id", "user_id", "vote_type"::"comment_vote_type", "voted_at"
FROM "insight_comment_votes_legacy";
--> statement-breakpoint
INSERT INTO "comment_votes" ("id", "comment_id", "user_id", "vote_type", "voted_at")
SELECT "id", "comment_id", "user_id", "vote_type"::"comment_vote_type", "created_at"
FROM "matchup_comment_votes";
--> statement-breakpoint
INSERT INTO "comment_votes" ("id", "comment_id", "user_id", "vote_type", "voted_at")
SELECT "id", "comment_id", "user_id", "vote_type"::"comment_vote_type", "created_at"
FROM "trending_poll_comment_votes";
--> statement-breakpoint
INSERT INTO "comment_votes" ("id", "comment_id", "user_id", "vote_type", "voted_at")
SELECT "id", "comment_id", "user_id", "vote_type"::"comment_vote_type", "created_at"
FROM "opinion_poll_comment_votes";
--> statement-breakpoint
INSERT INTO "comment_votes" ("id", "comment_id", "user_id", "vote_type", "voted_at")
SELECT "id", "comment_id", "user_id", "vote_type"::"comment_vote_type", "created_at"
FROM "open_market_comment_votes";
--> statement-breakpoint
ALTER TABLE "comment_votes"
  ADD CONSTRAINT "comment_votes_comment_id_fkey"
  FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "comment_reports" DROP CONSTRAINT IF EXISTS "fk_comment_reports_comment";
--> statement-breakpoint
ALTER TABLE "comment_reports" DROP CONSTRAINT IF EXISTS "comment_reports_comment_fkey";
--> statement-breakpoint
ALTER TABLE "comment_reports" DROP CONSTRAINT IF EXISTS "comment_reports_comment_id_insight_comments_id_fk";
--> statement-breakpoint
ALTER TABLE "comment_reports"
  ADD CONSTRAINT "fk_comment_reports_comment"
  FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE
  NOT VALID;
--> statement-breakpoint
DO $$
DECLARE
  comment_count integer;
  vote_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO comment_count FROM "comments";
  SELECT COUNT(*)::integer INTO vote_count FROM "comment_votes";

  IF comment_count <> 22 THEN
    RAISE EXCEPTION 'Unified comments backfill expected 22 rows, got %', comment_count;
  END IF;

  IF vote_count <> 8 THEN
    RAISE EXCEPTION 'Unified comment_votes backfill expected 8 rows, got %', vote_count;
  END IF;
END$$;
