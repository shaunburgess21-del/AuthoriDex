CREATE TABLE "suggestions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"submitted_by" varchar NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"admin_notes" text,
	"approved_as_id" text,
	"approved_as_type" text,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suggestions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "profiles"("id") ON DELETE CASCADE,
	CONSTRAINT "suggestions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "profiles"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX "suggestions_submitter_idx" ON "suggestions" ("submitted_by", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "suggestions_status_idx" ON "suggestions" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "suggestions_type_status_idx" ON "suggestions" ("type", "status");
--> statement-breakpoint
INSERT INTO "xp_actions" ("action_key", "display_name", "xp_value", "daily_cap", "description", "is_active")
VALUES ('submit_suggestion', 'Submit Suggestion', 5, 3, 'Earn XP for submitting content suggestions for admin review', true)
ON CONFLICT ("action_key") DO NOTHING;
