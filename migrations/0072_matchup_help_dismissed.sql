-- One-time dismiss for inactive VersusCard help copy ("Tap an image to vote…").
-- Set when a signed-in user taps X; anonymous dismiss stays in localStorage only.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "matchup_help_dismissed_at" timestamp;
