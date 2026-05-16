-- Badges system foundation.
--
-- Adds two tables (`badges` for definitions, `user_badges` for awards)
-- and six demographic columns on `profiles` that several profile-tier
-- badges (community_member, full_voxmaxer) gate on. Badge definitions
-- are seeded from `shared/badge-config.ts` via `seedBadges()` in
-- `server/scripts/seed-gamification.ts`; the canonical 42-badge list
-- lives in code, not in the DB, so this migration only sets up the
-- shape — the seed script populates rows.
--
-- Idempotency: every `user_badges` row carries an `idempotency_key`
-- that the runtime helper (`awardBadge`) constructs deterministically
-- as `badge_${userId}_${badgeKey}` for automatic awards and
-- `badge_manual_${userId}_${badgeKey}` for admin-issued ones. The
-- composite UNIQUE on (user_id, badge_key) is the second guard rail
-- so we can't double-award a badge even if a caller forgets to pass
-- the idempotency key.

CREATE TABLE IF NOT EXISTS "badges" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text UNIQUE NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "category" text NOT NULL,
  "rarity" text NOT NULL,
  "icon" text NOT NULL,
  "criteria_json" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "visible_on_frontend" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_badges" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "badge_key" text NOT NULL REFERENCES "badges"("key") ON DELETE CASCADE,
  "earned_at" timestamptz DEFAULT now(),
  "idempotency_key" text UNIQUE NOT NULL,
  "metadata" jsonb,
  CONSTRAINT "user_badges_user_badge_key_unique" UNIQUE ("user_id", "badge_key")
);

CREATE INDEX IF NOT EXISTS "user_badges_user_id_idx"
  ON "user_badges" ("user_id");

CREATE INDEX IF NOT EXISTS "user_badges_badge_key_idx"
  ON "user_badges" ("badge_key");

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "bio" text,
  ADD COLUMN IF NOT EXISTS "date_of_birth" date,
  ADD COLUMN IF NOT EXISTS "gender" text,
  ADD COLUMN IF NOT EXISTS "country_of_origin" text,
  ADD COLUMN IF NOT EXISTS "country_of_residence" text,
  ADD COLUMN IF NOT EXISTS "ethnicity" text,
  ADD COLUMN IF NOT EXISTS "profile_fields_public" boolean NOT NULL DEFAULT false;
