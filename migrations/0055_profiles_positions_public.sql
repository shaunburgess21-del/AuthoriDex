-- AMM Social Layer (Sprint 1, Phase 15.C.1): per-user privacy toggle.
--
-- `positions_public` controls visibility of *open* AMM positions and
-- trade-direction identity on the four social surfaces (public profile
-- positions panel, per-market activity feed, Town Square, leaderboard).
--
-- Settled history (won/lost/refunded + AMM sell receipts) stays public
-- regardless — the toggle hides where a user is sitting, not how they
-- have performed over time. Defaults to true so existing accounts opt
-- in to the new public positions panel without a settings sweep; users
-- can flip themselves to private via the account settings page.
--
-- See Sprint 1 plan, Phase 15.C, for the cross-surface enforcement
-- contract.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "positions_public" boolean NOT NULL DEFAULT true;
