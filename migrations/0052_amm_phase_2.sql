-- Phase 2 of the parimutuel -> AMM rebuild.
--
-- Adds the schema needed for LMSR-based AMM markets:
--   1. `profiles.is_house` flag + the singleton "house" profile that
--      seeds AMM markets with virtual liquidity. Mirrors the existing
--      `is_agent` flag; user-facing listings should filter both out.
--   2. `prediction_markets.engine` ('parimutuel' | 'amm', default
--      parimutuel). Phase 4+ flips specific market types to 'amm' as
--      the rebuild rolls out.
--   3. AMM-only fields on `market_bets` (action_type, share_count,
--      price_per_share). NULL on legacy parimutuel rows.
--   4. New `market_amm_state` table — one row per AMM market holding
--      the LMSR state (liquidity_b, outcome_order, share_quantities,
--      seed amount, running net user credits in).
--
-- Idempotent. Zero behavioural impact until Phase 3 wires buy/sell.

-- 1. House sentinel flag on profiles
ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "is_house" boolean NOT NULL DEFAULT false;

-- 2. Singleton house profile row. Fixed UUID matches HOUSE_PROFILE_ID
-- in server/services/amm-house.ts. Initial 1B virtual credits is far
-- more than any per-market seed; lets us monitor for drift trivially.
INSERT INTO "profiles" (
  "id", "username", "role", "is_public", "is_house",
  "predict_credits", "rank"
) VALUES (
  '00000000-0000-0000-0000-0000000000aa',
  '__house__', 'system', false, true,
  1000000000, 'Citizen'
)
ON CONFLICT ("id") DO NOTHING;

-- 2a. Matching `initial_grant` ledger entry so /api/admin/credit-reconciliation
-- sees a clean (profile.predict_credits == sum(ledger.amount)) for the
-- house. Same idempotency-key convention as signup grants.
INSERT INTO "credit_ledger" (
  "user_id", "txn_type", "amount", "wallet_type",
  "balance_after", "source", "idempotency_key", "metadata"
) VALUES (
  '00000000-0000-0000-0000-0000000000aa',
  'initial_grant', 1000000000, 'VIRTUAL',
  1000000000, 'amm_house_seed',
  'initial_grant_00000000-0000-0000-0000-0000000000aa',
  '{"reason": "AMM house initial liquidity (Phase 2 of AMM rebuild)"}'::jsonb
)
ON CONFLICT ("user_id", "idempotency_key") DO NOTHING;

-- 3. Engine selector on prediction_markets
ALTER TABLE "prediction_markets"
  ADD COLUMN IF NOT EXISTS "engine" text NOT NULL DEFAULT 'parimutuel';

-- 4. AMM-only columns on market_bets
ALTER TABLE "market_bets"
  ADD COLUMN IF NOT EXISTS "action_type" text NOT NULL DEFAULT 'parimutuel',
  ADD COLUMN IF NOT EXISTS "share_count" numeric,
  ADD COLUMN IF NOT EXISTS "price_per_share" numeric;

-- 5. Per-market AMM state
CREATE TABLE IF NOT EXISTS "market_amm_state" (
  "market_id" varchar PRIMARY KEY REFERENCES "prediction_markets"("id") ON DELETE CASCADE,
  "liquidity_b" numeric NOT NULL,
  "outcome_order" text[] NOT NULL,
  "share_quantities" jsonb NOT NULL,
  "house_seed_amount" integer NOT NULL,
  "total_user_credits_in" numeric NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
