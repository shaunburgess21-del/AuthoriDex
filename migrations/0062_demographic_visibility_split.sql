-- Per-field visibility toggles for demographic fields, replacing the
-- single `profile_fields_public` switch with one toggle per bucket so
-- a user can share country/gender publicly while keeping DOB or
-- ethnicity private (or vice versa).
--
-- Defaults match the spec:
--   gender_public = true, country_public = true (visible by default)
--   dob_public = false, ethnicity_public = false (hidden by default)
--
-- Backfill rule: any row that previously opted in via the legacy
-- `profile_fields_public = true` flag has all four new flags set to
-- true so existing public profiles do not silently lose visibility.
-- The legacy column is left in place as a deprecated mirror; new
-- application code stops reading it.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "dob_public" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "gender_public" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "country_public" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "ethnicity_public" boolean NOT NULL DEFAULT false;

UPDATE "profiles"
SET "dob_public" = true,
    "gender_public" = true,
    "country_public" = true,
    "ethnicity_public" = true
WHERE "profile_fields_public" = true;
