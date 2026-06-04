-- Comments-only pause flag on the agent_runtime_state singleton.
-- Backs the admin "Pause agent commenting" toggle (text comments + comment upvotes).
-- Betting, predictions, and rating/poll votes are unaffected.

ALTER TABLE "agent_runtime_state"
  ADD COLUMN IF NOT EXISTS "comments_paused" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "comments_pause_reason" text,
  ADD COLUMN IF NOT EXISTS "comments_paused_at" timestamp,
  ADD COLUMN IF NOT EXISTS "comments_paused_by" varchar;
