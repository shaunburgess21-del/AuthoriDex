-- Per-item public/private overrides for a user's profile.
-- A row means "this specific item is HIDDEN from my public profile".
-- Absence means the item follows the global profiles.is_public setting.

CREATE TABLE IF NOT EXISTS "profile_item_privacy" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"item_type" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_item_privacy_user_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profile_item_privacy_user_item_unique"
	ON "profile_item_privacy" ("user_id", "item_type", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_item_privacy_by_user_idx"
	ON "profile_item_privacy" ("user_id");
