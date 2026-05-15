-- Streak system overhaul (Sprint: streak rebuild).
--
-- Adds two columns that close out long-standing gaps in the streak
-- state machine:
--
--   * longest_streak — peak streak the user has ever reached. Survives
--     resets so the UI can show "your best was N days" and so future
--     leaderboards can rank by historical consistency.
--
--   * last_login_date — authoritative last-checkin date (UTC YYYY-MM-DD).
--     Replaces the previous indirection through xp_ledger lookup of the
--     `daily_login_${yesterday}_${userId}` idempotency key, and unlocks
--     the new grace-period rule: missing a single day no longer resets.
--
-- Defaults are safe: longest_streak seeds from the existing
-- current_streak so users don't appear to "lose" a streak they're
-- already on; last_login_date stays null until the next daily-checkin
-- POST writes it.
--
-- Companion change: prediction win-streak writes (market-resolver,
-- remove-stale-predictions script) are removed in the same change-set
-- so this column is no longer dual-written with conflicting semantics.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "longest_streak" integer NOT NULL DEFAULT 0;

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "last_login_date" text;

-- Backfill longest_streak so accounts mid-streak don't show 0 as their
-- all-time peak. Only updates rows where the existing value is below
-- current_streak, which is always true on first run (default 0).
UPDATE "profiles"
SET "longest_streak" = "current_streak"
WHERE "longest_streak" < "current_streak";
