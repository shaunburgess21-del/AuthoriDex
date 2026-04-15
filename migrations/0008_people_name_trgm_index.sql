CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracked_people_name_trgm_idx" ON "tracked_people" USING gin ("name" gin_trgm_ops);
