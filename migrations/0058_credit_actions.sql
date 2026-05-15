-- Credits foundation + earn loop (Sprint: credits rebuild).
--
-- Two paired changes:
--
--   1. credit_actions config table — admin-tunable engagement
--      rewards mirroring the shape of xp_actions. Runtime
--      adjustCredits() reads `proposed_credits` and `daily_cap`
--      from this table so admin edits take effect without redeploy.
--      Seed defaults live in shared/credit-config.ts and are
--      upserted by server/scripts/seed-gamification.ts.
--
--   2. profiles.predict_credits default -> 0. The runtime signup
--      grant in POST /api/profile/sync awards SIGNUP_CREDIT_GRANT
--      (10,000) and writes the matching credit_ledger row.
--      The DB default of 1000 conflicted with the grant — any
--      user created via direct INSERT (admin tools, tests) ended
--      up with 1000 silently. Drop to 0 so the only source of
--      truth for "how many credits does a fresh user have" is
--      the runtime grant + ledger insert.

CREATE TABLE IF NOT EXISTS "credit_actions" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "proposed_credits" integer NOT NULL DEFAULT 0,
  "daily_cap" integer,
  "category" text NOT NULL,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "requires_approval" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

ALTER TABLE "profiles"
  ALTER COLUMN "predict_credits" SET DEFAULT 0;
