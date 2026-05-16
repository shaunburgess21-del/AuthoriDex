-- Extended profile fields for the Settings overhaul.
--
-- Adds Account-tab fields (recovery email + phone) and About-Me-tab
-- discoverability fields (social handles + occupation/industry) plus
-- two visibility toggles. Visibility on demographics
-- (`profile_fields_public`) was added in 0060_badge_system.sql; the
-- two new toggles (`social_handles_public`, `occupation_public`)
-- mirror the same shape so each privacy-sensitive bucket gets its
-- own opt-in.
--
-- recovery_email_verified is gated false today and will be flipped
-- by the verification flow shipped in a follow-up. The runtime
-- PATCH handler always resets verified=false when recovery_email
-- changes, so a stale verified flag can never survive an edit.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "recovery_email" text,
  ADD COLUMN IF NOT EXISTS "recovery_email_verified" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "phone_number" text,
  ADD COLUMN IF NOT EXISTS "social_x_handle" text,
  ADD COLUMN IF NOT EXISTS "social_instagram_handle" text,
  ADD COLUMN IF NOT EXISTS "occupation_industry" text,
  ADD COLUMN IF NOT EXISTS "social_handles_public" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "occupation_public" boolean NOT NULL DEFAULT false;
