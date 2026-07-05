-- Singleton table of admin-tunable Predict CMS presentation knobs.
-- See `shared/schema.ts -> predictCmsSettings` for full docs.
--
-- First knob: `world_markets_sort_mode` — lets an admin override how the
-- public /api/open-markets feed is sorted for everyone (volume | newest |
-- manual | endAt) without a deploy. Default 'volume' preserves the existing
-- personalised + AMM-volume ordering.

CREATE TABLE IF NOT EXISTS "predict_cms_settings" (
  "id" text PRIMARY KEY DEFAULT 'global',
  "world_markets_sort_mode" text NOT NULL DEFAULT 'volume',
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" varchar
);

INSERT INTO "predict_cms_settings" ("id", "world_markets_sort_mode")
VALUES ('global', 'volume')
ON CONFLICT ("id") DO NOTHING;

-- Backend-only table (read/written exclusively by the Express service role):
-- enable RLS with no policies so PostgREST anon/authenticated callers get
-- deny-by-default (project posture since migration 0074).
ALTER TABLE "predict_cms_settings" ENABLE ROW LEVEL SECURITY;
