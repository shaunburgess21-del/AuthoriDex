-- Singleton table holding admin-tunable AMM knobs that we want to be
-- able to change WITHOUT a deploy. See `shared/schema.ts ->
-- ammRuntimeSettings` for full docs.
--
-- Today this is just `pre_resolve_cooldown_ms` — the gap between the
-- AMM trading cutoff and `endAt`. Promoted from a hardcoded 5-minute
-- constant so we can dial it up (e.g. to 10 or 15 minutes) once we
-- observe live last-hour sniping behaviour after Phase 10 wakes the
-- agents. Designed to grow as Phase 10+ adds more tunables (Kelly cap,
-- per-market max loss override, etc.).

CREATE TABLE IF NOT EXISTS "amm_runtime_settings" (
  "id" text PRIMARY KEY DEFAULT 'global',
  "pre_resolve_cooldown_ms" integer NOT NULL DEFAULT 300000,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" varchar
);

INSERT INTO "amm_runtime_settings" ("id", "pre_resolve_cooldown_ms")
VALUES ('global', 300000)
ON CONFLICT ("id") DO NOTHING;
