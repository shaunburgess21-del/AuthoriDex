-- Singleton table holding the global pause state for ALL agent activity.
-- See `shared/schema.ts -> agentRuntimeState` for full docs.
--
-- Backs the admin "Pause agents" kill switch in the Agents tab. Used during
-- the parimutuel -> AMM rebuild (May 2026) to silence the simulation cohort
-- so we can ship in batches without their bets / comments / votes
-- interfering. Designed to outlive that specific rebuild — useful any time
-- ops needs to put the cohort to sleep without a deploy.

CREATE TABLE IF NOT EXISTS "agent_runtime_state" (
  "id" text PRIMARY KEY DEFAULT 'global',
  "paused" boolean NOT NULL DEFAULT false,
  "reason" text,
  "paused_at" timestamp,
  "paused_by" varchar,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Seed the singleton row in the unpaused state. Idempotent.
INSERT INTO "agent_runtime_state" ("id", "paused")
VALUES ('global', false)
ON CONFLICT ("id") DO NOTHING;
