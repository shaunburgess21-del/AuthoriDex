-- Funnel telemetry for first-visit onboarding / Quick Vote overlay / signup attribution.
-- Additive only; safe to run once per environment (see server/sql/ensure/003_funnel_events.sql
-- for the idempotent replay variant).

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
-- (Also applied by 0102 for environments that already ran 0101 without this.)
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
