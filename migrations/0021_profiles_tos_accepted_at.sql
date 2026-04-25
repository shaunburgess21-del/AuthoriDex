-- Adds the timestamp written by /login/welcome when a user first accepts the
-- ToS + Privacy Policy. NULL means we have not yet captured acceptance for
-- this user (legacy rows pre-dating the welcome screen). Idempotent so the
-- deploy runner can safely re-execute against environments that were patched
-- by hand or already had the column added.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "tos_accepted_at" timestamp;
