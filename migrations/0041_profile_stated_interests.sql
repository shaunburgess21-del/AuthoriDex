-- Phase 1 of the Interest Picker rollout.
--
-- Adds two columns to `public.profiles`:
--
--   * stated_interests           text[]    NOT NULL DEFAULT '{}'
--       Canonical category ids (see shared/constants.ts CANONICAL_CATEGORIES)
--       the user explicitly selected via the InterestsPicker modal. Empty
--       array == "not yet picked" and is treated as cold-start by the
--       backend ordering helper (server/lib/coldStartOrder.ts).
--
--   * interests_prompt_dismissed_at  timestamp
--       Set when the user skips/dismisses the InterestsPicker. The
--       InterestsGate re-prompt logic (App.tsx) reads this together with
--       total_votes / total_predictions and time elapsed so we soft-nudge
--       engaged users instead of nagging on every visit.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so reruns in dev environments are
-- harmless. No backfill required — the NOT NULL DEFAULT '{}' covers all
-- existing rows.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "stated_interests" text[] NOT NULL DEFAULT '{}';

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "interests_prompt_dismissed_at" timestamp;
