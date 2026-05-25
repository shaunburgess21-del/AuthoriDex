ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "net_worth_updated_at" timestamptz;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD COLUMN IF NOT EXISTS "net_worth_volatility" text DEFAULT 'standard' NOT NULL;
