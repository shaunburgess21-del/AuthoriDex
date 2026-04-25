ALTER TABLE "insight_comments" DROP COLUMN IF EXISTS "username";--> statement-breakpoint
ALTER TABLE "trending_poll_comments" DROP COLUMN IF EXISTS "username";--> statement-breakpoint
ALTER TABLE "trending_poll_comments" DROP COLUMN IF EXISTS "avatar_url";--> statement-breakpoint
ALTER TABLE "matchup_comments" DROP COLUMN IF EXISTS "username";--> statement-breakpoint
ALTER TABLE "matchup_comments" DROP COLUMN IF EXISTS "avatar_url";--> statement-breakpoint
ALTER TABLE "open_market_comments" DROP COLUMN IF EXISTS "username";--> statement-breakpoint
ALTER TABLE "open_market_comments" DROP COLUMN IF EXISTS "avatar_url";--> statement-breakpoint
ALTER TABLE "opinion_poll_comments" DROP COLUMN IF EXISTS "username";--> statement-breakpoint
ALTER TABLE "opinion_poll_comments" DROP COLUMN IF EXISTS "avatar_url";
