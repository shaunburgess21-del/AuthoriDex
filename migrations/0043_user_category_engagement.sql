-- Phase 3 of the Interest Picker rollout — behavioural blending.
--
-- Creates `public.user_category_engagement`, a per-user per-category
-- aggregate of category-attributed activity. The Phase 3 ranking helper
-- (server/lib/blendedRank.ts) reads this table alongside
-- profiles.stated_interests and blends the two via a first-engagement
-- anchored curve with read-time exponential decay (30-day half-life).
--
-- Design constraints:
--
--   * One row per (user_id, category_id). No event log in v1 — we hold
--     aggregate counts + first/last timestamps and decay at read time
--     so ingest is O(1) and the table stays small (worst case ~12 rows
--     per user, capped at CANONICAL_CATEGORIES.length).
--
--   * category_id is the canonical kebab-lowercase id from
--     shared/constants.ts CANONICAL_CATEGORIES. The CHECK constraint
--     below enforces this structurally — we do not rely on convention
--     or LOWER()-on-read, because silently drifting case is the exact
--     bug class that broke Phase 1 for two weeks.
--
--   * vote_count counts category-attributed vote-like events (matchup,
--     sentiment poll, opinion poll, induction, over/underrated). Each
--     contributes weight 1.
--
--   * bet_weight accumulates prediction-market stake-weighted score
--     (min(3 * log1p(stake_credits), PREDICTION_STAKE_WEIGHT_CAP)) so a
--     1-credit dabble and a 10,000-credit conviction bet are not treated
--     equally. Stored as numeric to avoid integer truncation of the
--     log1p fractional result.
--
--   * first_engaged_at anchors the blend curve (0.7 stated / 0.3
--     behaviour at week 1 → 0.3 stated / 0.7 behaviour at week 4, per
--     the Phase 3 plan). last_engaged_at drives the read-time decay.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + IF NOT EXISTS guards on the
-- constraint and indexes so reruns in dev are harmless.

CREATE TABLE IF NOT EXISTS "user_category_engagement" (
  "user_id"           varchar       NOT NULL,
  "category_id"       text          NOT NULL,
  "vote_count"        integer       NOT NULL DEFAULT 0,
  "bet_weight"        numeric(10,3) NOT NULL DEFAULT 0,
  "first_engaged_at"  timestamp     NOT NULL DEFAULT NOW(),
  "last_engaged_at"   timestamp     NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("user_id", "category_id")
);

-- Canonical category enforcement. Mirrors the CANONICAL_CATEGORIES list
-- in shared/constants.ts (12 kebab-lowercase ids). Keep these in sync by
-- hand if the canonical list ever grows — add a new migration rather
-- than editing this one after it has shipped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_category_engagement_category_check'
  ) THEN
    ALTER TABLE "user_category_engagement"
      ADD CONSTRAINT "user_category_engagement_category_check"
      CHECK ("category_id" IN (
        'tech','politics','business','music','sports','film-tv',
        'gaming','creator','comedy','food-drink','lifestyle','misc'
      ));
  END IF;
END
$$;

-- Speeds up resolveBlendState's per-user lookup on every feed request.
-- (Primary key already indexes user_id as the leading column, but this
-- covering index is explicit for query planners and matches the pattern
-- used elsewhere in the schema for hot-path reads.)
CREATE INDEX IF NOT EXISTS "user_category_engagement_user_id_idx"
  ON "user_category_engagement" ("user_id");

-- Supports the admin debug endpoint's "most recently engaged categories"
-- snapshot without a full-row sort.
CREATE INDEX IF NOT EXISTS "user_category_engagement_user_last_engaged_idx"
  ON "user_category_engagement" ("user_id", "last_engaged_at" DESC);
