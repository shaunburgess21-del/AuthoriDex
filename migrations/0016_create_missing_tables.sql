-- Create tables that were added to shared/schema.ts but never got their own
-- CREATE TABLE migration: `comment_reports` and `open_market_comment_votes`.
--
-- Context: both tables are referenced by the codebase (moderation + predict-
-- markets comment voting) but were missing in production, which is why the
-- 0013 FK migration couldn't add its comment_reports FK in the first place.
--
-- All statements use IF NOT EXISTS so this is a safe no-op on any environment
-- that already has these tables (dev, anyone who hand-patched prod). FKs are
-- inlined at CREATE time since the referenced tables (insight_comments,
-- open_market_comments) have existed since 0000.

CREATE TABLE IF NOT EXISTS "comment_reports" (
	"id"           varchar     PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id"   varchar     NOT NULL,
	"entity_type"  text        NOT NULL,
	"reporter_id"  varchar     NOT NULL,
	"reason"       text,
	"created_at"   timestamp   NOT NULL DEFAULT now(),
	CONSTRAINT "comment_reports_comment_fkey"
		FOREIGN KEY ("comment_id") REFERENCES "insight_comments"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reports_comment_idx"
	ON "comment_reports" ("comment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reports_reporter_idx"
	ON "comment_reports" ("reporter_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "open_market_comment_votes" (
	"id"          varchar     PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id"  varchar     NOT NULL,
	"user_id"     varchar     NOT NULL,
	"vote_type"   text        NOT NULL,
	"created_at"  timestamp   NOT NULL DEFAULT now(),
	CONSTRAINT "omc_votes_user_comment_unique" UNIQUE ("user_id", "comment_id"),
	CONSTRAINT "open_market_comment_votes_comment_fkey"
		FOREIGN KEY ("comment_id") REFERENCES "open_market_comments"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "omc_votes_comment_idx"
	ON "open_market_comment_votes" ("comment_id");
