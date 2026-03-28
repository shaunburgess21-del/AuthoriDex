ALTER TABLE "induction_candidates" ADD COLUMN "x_handle" text;--> statement-breakpoint
ALTER TABLE "induction_candidates" ADD COLUMN "induction_status" text DEFAULT 'Queue' NOT NULL;