-- Add VoxMax Legend (tier 8) and backfill rank descriptions.
-- Also closes Hall of Famer's max_xp at 149999 so Legend owns 150000+.

ALTER TABLE "ranks" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
UPDATE "ranks" SET "description" = 'Welcome to VoxDex. Every VoxMaxxer starts here.' WHERE "tier" = 1;
--> statement-breakpoint
UPDATE "ranks" SET "description" = 'You''re finding your voice. Keep VoxMaxxing.' WHERE "tier" = 2;
--> statement-breakpoint
UPDATE "ranks" SET "description" = 'You know how VoxDex works. Your perspective matters.' WHERE "tier" = 3;
--> statement-breakpoint
UPDATE "ranks" SET "description" = 'A sharp read on the room. Your votes carry weight.' WHERE "tier" = 4;
--> statement-breakpoint
UPDATE "ranks" SET "description" = 'Deep knowledge, consistent takes. Others follow your lead.' WHERE "tier" = 5;
--> statement-breakpoint
UPDATE "ranks" SET "description" = 'Elite tier. Your predictions and calls set the pace.' WHERE "tier" = 6;
--> statement-breakpoint
UPDATE "ranks" SET "description" = 'Legendary status. A veteran of the VoxDex arena.', "max_xp" = 149999 WHERE "tier" = 7;
--> statement-breakpoint
INSERT INTO "ranks" ("tier", "name", "min_xp", "max_xp", "vote_multiplier", "color", "icon", "description")
VALUES (8, 'VoxMax Legend', 150000, NULL, 3.0, '#E5E4E2', 'sparkles', 'The rarest status on VoxDex — reserved for those who reach the summit.')
ON CONFLICT ("tier") DO UPDATE SET
  "name" = EXCLUDED."name",
  "min_xp" = EXCLUDED."min_xp",
  "max_xp" = EXCLUDED."max_xp",
  "vote_multiplier" = EXCLUDED."vote_multiplier",
  "color" = EXCLUDED."color",
  "icon" = EXCLUDED."icon",
  "description" = EXCLUDED."description";
