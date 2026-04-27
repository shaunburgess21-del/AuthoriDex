CREATE TABLE IF NOT EXISTS "induction_cycle_results" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_close_at" timestamp NOT NULL,
  "status" text NOT NULL,
  "candidate_id" varchar,
  "person_id" varchar,
  "vote_total_at_close" integer,
  "processed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "induction_cycle_results_week_close_at_unique" UNIQUE("week_close_at")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'induction_cycle_results_candidate_id_induction_candidates_id_fk'
  ) THEN
    ALTER TABLE "induction_cycle_results"
      ADD CONSTRAINT "induction_cycle_results_candidate_id_induction_candidates_id_fk"
      FOREIGN KEY ("candidate_id") REFERENCES "public"."induction_candidates"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'induction_cycle_results_person_id_tracked_people_id_fk'
  ) THEN
    ALTER TABLE "induction_cycle_results"
      ADD CONSTRAINT "induction_cycle_results_person_id_tracked_people_id_fk"
      FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "induction_cycle_results_week_close_at_idx"
  ON "induction_cycle_results" ("week_close_at");
