ALTER TABLE "celebrity_profiles" ADD COLUMN "prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN "source_urls" text[];--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN "as_of_date" text;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN "validation_notes" text[];
