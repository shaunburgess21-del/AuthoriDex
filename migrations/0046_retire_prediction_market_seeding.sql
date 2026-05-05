-- Retire prediction-market seeding.
--
-- Background: a hourly cron in server/jobs/seed-engine.ts used to inflate
-- market_entries.totalStake and bump prediction_markets.seedVolume /
-- seed_config.participants without writing real market_bets rows. This
-- produced visible anomalies like "112 staked / 0 bets" on resolved
-- pages. With agent betting now solving the empty-restaurant problem
-- via real market_bets rows, the seed mechanism is redundant.
--
-- Settlement reads only real market_bets (server/jobs/settlement-utils.ts),
-- so dropping these columns has no effect on payouts. Phantom credits
-- already in market_entries.totalStake on currently-open markets are
-- intentionally left in place to age out as those markets resolve.
--
-- IMPORTANT: opinion_poll_options.seed_count is a SEPARATE feature (used
-- by server/agents/voteWorker.ts for popularity-weighted agent voting on
-- opinion polls) and must NOT be touched by this migration.

ALTER TABLE prediction_markets DROP COLUMN IF EXISTS seed_participants;
ALTER TABLE prediction_markets DROP COLUMN IF EXISTS seed_volume;
ALTER TABLE prediction_markets DROP COLUMN IF EXISTS seed_config;

ALTER TABLE market_entries DROP COLUMN IF EXISTS seed_count;
