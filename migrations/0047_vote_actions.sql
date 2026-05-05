CREATE TABLE IF NOT EXISTS "vote_actions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "vote_type" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" varchar NOT NULL,
  "action_kind" text NOT NULL,
  "prev_value" text,
  "next_value" text,
  "source" text DEFAULT 'unknown' NOT NULL,
  "request_id" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "vote_actions_user_created_idx" ON "vote_actions" USING btree ("user_id","created_at");
CREATE INDEX IF NOT EXISTS "vote_actions_type_created_idx" ON "vote_actions" USING btree ("vote_type","created_at");
CREATE INDEX IF NOT EXISTS "vote_actions_target_created_idx" ON "vote_actions" USING btree ("target_type","target_id","created_at");
