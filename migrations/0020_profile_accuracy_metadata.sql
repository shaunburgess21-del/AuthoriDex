ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "source_hash" text;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "source_urls" text[];--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "confidence" real;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "as_of_date" text;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "validation_notes" text[];
