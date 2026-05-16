-- Parimutuel sunset, Phase 1.5: flip the prediction_markets.engine
-- column default from 'parimutuel' to 'amm'.
--
-- Existing rows are unaffected (jackpot rows that were created with
-- engine='parimutuel' keep that value). The default only matters for
-- forgotten code paths — and after the sunset, the only path that
-- still wants parimutuel is `generateWeeklyJackpot`, which now sets
-- the value explicitly.
--
-- Pairs with the schema.ts change in the same commit:
--   shared/schema.ts -> predictionMarkets.engine.default("amm")
--
-- A CHECK constraint to enforce "engine = 'amm' OR market_type =
-- 'jackpot'" lands in a follow-up migration ONCE the wipe script has
-- removed every legacy parimutuel non-jackpot row, so we don't risk
-- the migration failing mid-deploy if data ops haven't run yet.

ALTER TABLE "prediction_markets"
  ALTER COLUMN "engine" SET DEFAULT 'amm';
