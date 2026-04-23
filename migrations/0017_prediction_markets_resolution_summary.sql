-- Add AI-generated one-sentence resolution summary to prediction_markets.
--
-- Populated by server/jobs/market-resolver.ts fire-and-forget after a market
-- settles successfully. Nullable so settlement itself never blocks on the AI
-- call, and so historical resolved markets simply show no summary until we
-- decide (optionally) to backfill.
--
-- Uses IF NOT EXISTS so re-running the migration on an environment where
-- the column was patched by hand is a no-op.

ALTER TABLE prediction_markets ADD COLUMN IF NOT EXISTS resolution_summary text;
