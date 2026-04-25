-- Backfill `tos_accepted_at` for legacy users.
--
-- Migration 0021 added `profiles.tos_accepted_at` so we could route
-- first-time signups through `/login/welcome` (NewUserGate gates on
-- a NULL value). Without a backfill, every user who joined VoxDex
-- before that migration also has NULL — and would be re-routed
-- through the welcome screen on their next login, AND triggered the
-- one-time welcome email.
--
-- Treat anyone already in the database as having implicitly accepted
-- ToS at account creation. They skip the welcome flow on their next
-- visit and don't receive a "Welcome to VoxDex" email months after
-- joining.
--
-- Falls back to NOW() for the rare row missing `created_at` (defensive;
-- the column is NOT NULL with a default but cheap insurance).
--
-- Idempotent: re-runs are no-ops because the WHERE clause filters
-- anyone already backfilled.

UPDATE "profiles"
SET "tos_accepted_at" = COALESCE("created_at", NOW())
WHERE "tos_accepted_at" IS NULL;
