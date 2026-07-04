-- Phase 3+4 A3: DB-level guard for jackpot exact-score claims.
-- The route's check-then-insert is racy under concurrency; this partial
-- unique index makes the same (market, predictedScore) claim impossible
-- to double-insert. Scoped to active parimutuel bets carrying a
-- predictedScore so AMM buy/sell rows and settled/void bets are untouched.
-- Verified zero existing duplicates in prod before applying (2026-07-04).
CREATE UNIQUE INDEX IF NOT EXISTS market_bets_jackpot_score_unique_idx
  ON public.market_bets (market_id, (bet_metadata->>'predictedScore'))
  WHERE action_type = 'parimutuel'
    AND status = 'active'
    AND bet_metadata ? 'predictedScore';
