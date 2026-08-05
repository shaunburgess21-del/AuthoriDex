-- Idempotent ensure for the funnel_events telemetry table (migration 0101).

CREATE TABLE IF NOT EXISTS "funnel_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" text NOT NULL,
  "surface" text NOT NULL,
  "fdx_sid" varchar,
  "user_id" varchar REFERENCES "profiles"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "funnel_events_type_created_idx"
  ON "funnel_events" ("event_type", "created_at");

CREATE INDEX IF NOT EXISTS "funnel_events_sid_created_idx"
  ON "funnel_events" ("fdx_sid", "created_at");

-- Deny-by-default via Data API; service role (Express) bypasses RLS.
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
