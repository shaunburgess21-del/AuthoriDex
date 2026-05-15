-- Shares + referral system foundation.
--
-- Adds four columns to profiles for the referral funnel and a new
-- share_clicks table for share-link attribution. Both feed the
-- SOCIAL credit actions (share_click, referral_completed,
-- referral_signup_bonus) seeded by shared/credit-config.ts.
--
-- The referral funnel is intentionally append-only on the credit
-- side: referral_completed and referral_signup_bonus are awarded
-- exactly once per user pair via credit_ledger idempotency keys.
-- The two `*_fired_at` / `first_action_at` timestamps on profiles
-- are defence-in-depth so the runtime helper can short-circuit
-- before even hitting the ledger uniqueness check.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "referral_code" text UNIQUE,
  ADD COLUMN IF NOT EXISTS "referred_by" text,
  ADD COLUMN IF NOT EXISTS "first_action_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "referral_credit_fired_at" timestamptz;

-- Self-FK: when a referrer's account is deleted we keep the
-- referred user's row but null out their `referred_by` so the
-- attribution link is severed without a cascade. Drizzle can't
-- express this in the column builder cleanly because the table
-- references itself, so it lives here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_referred_by_fkey'
  ) THEN
    ALTER TABLE "profiles"
      ADD CONSTRAINT "profiles_referred_by_fkey"
      FOREIGN KEY ("referred_by") REFERENCES "profiles"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "share_clicks" (
  "id" serial PRIMARY KEY NOT NULL,
  "sharer_user_id" text NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "share_surface" text NOT NULL,
  "share_url" text NOT NULL,
  "clicked_at" timestamptz DEFAULT now(),
  "external_referrer" text,
  "ip_hash" text,
  "credited" boolean NOT NULL DEFAULT false,
  "credit_idempotency_key" text UNIQUE
);

CREATE INDEX IF NOT EXISTS "share_clicks_sharer_idx"
  ON "share_clicks" ("sharer_user_id", "clicked_at");
