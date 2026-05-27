-- Insights product telemetry. Server-only table written via POST /api/insights/event
-- (Express + service_role). RLS enabled with no policies = no anon/authed access,
-- service_role bypasses RLS so server writes/reads still work.

CREATE TABLE IF NOT EXISTS insights_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id varchar REFERENCES profiles(id) ON DELETE SET NULL,
  surface text NOT NULL,
  action text NOT NULL,
  params jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS insights_events_surface_created_idx
  ON insights_events (surface, created_at DESC);

CREATE INDEX IF NOT EXISTS insights_events_user_created_idx
  ON insights_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE insights_events ENABLE ROW LEVEL SECURITY;
