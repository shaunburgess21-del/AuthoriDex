-- Phase 12 of the parimutuel -> AMM rebuild: price-history infra.
--
-- Adds an append-only table for LMSR price snapshots. Two writers
-- populate this table:
--   1. The post-trade hook in `executeBuy`/`executeSell` (inserts one
--      row per outcome inside the trade transaction, source='trade').
--   2. The 5-minute sampler cron (`server/jobs/amm-price-sampler.ts`)
--      that fills gaps on quiet markets so the chart looks smooth
--      (source='sampler').
--
-- Read path: `/api/markets/:id/price-history?bucket=5m|1h|1d&from=…`
-- powers card sparklines and detail-page charts (Phase 12.3).
--
-- The composite index on (market_id, recorded_at) covers the only
-- access pattern we have today (range scan within a single market).
--
-- NOTE: drizzle-kit also re-emitted CREATE TABLE statements for
-- objects added in 0051/0052/0053 because those were hand-written
-- and did not update the meta snapshot. Those duplicates have been
-- removed from this migration; the corresponding objects already
-- exist in every environment that ran 0051-0053.

CREATE TABLE IF NOT EXISTS "amm_price_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar NOT NULL,
	"entry_id" varchar NOT NULL,
	"price" numeric NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- FK is wrapped in a pg_constraint guard so this migration is safe
-- to re-apply on partially-applied environments. The unconditional
-- ALTER TABLE in the original commit fails with `constraint already
-- exists` on retry; this guard is the same shape used in 0059.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'amm_price_snapshots_market_id_prediction_markets_id_fk'
  ) THEN
    ALTER TABLE "amm_price_snapshots"
      ADD CONSTRAINT "amm_price_snapshots_market_id_prediction_markets_id_fk"
      FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "amm_price_snapshots_market_time_idx" ON "amm_price_snapshots" USING btree ("market_id","recorded_at");
