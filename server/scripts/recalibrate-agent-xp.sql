-- ============================================================================
-- One-time pre-launch recalibration of simulation-agent XP
-- ============================================================================
--
-- Context
-- -------
-- `prediction_win` (100 XP, uncapped) was historically awarded per winning
-- BET ROW rather than once per market. Simulation agents that place multiple
-- buys on the same market therefore multiplied the uncapped win bonus, which
-- pushed ~65% of agents (51/78) to "Hall of Famer". Fleet-wide there were
-- ~89.9k prediction_win awards vs ~48.2k unique (user, market) wins — a
-- ~1.87x overcount (~41.7k duplicate rows, ~4.43M inflated XP).
--
-- The code path is fixed in the same change set via
-- `gamificationService.awardPredictionWinXp` (canonical key
-- `prediction_win_<marketId>_<userId>`) in:
--   - server/services/amm-resolver.ts
--   - server/jobs/market-resolver.ts
-- This script performs the matching ONE-TIME cleanup of historical data.
--
-- Method (chosen): "subtract the duplicate deltas"
-- --------------------------------------------------
-- We do NOT recompute xp_points from the ledger sum. Investigation showed
-- profiles.xp_points does not reconcile 1:1 with the ledger — notably
-- `legacy_migration` seed XP (~17k/agent) is present in the ledger but not
-- reflected in xp_points, plus a small residual (avg ~+541). Recomputing
-- from the ledger would wrongly re-add the legacy seed. Because every
-- awardXp() atomically incremented xp_points, the duplicate deltas are
-- included in the current xp_points, so we surgically subtract exactly
-- those and leave legacy XP and the residual untouched.
--
-- Steps:
--   1. Identify duplicate `prediction_win` xp_ledger rows; keep the earliest
--      row per (agent, market); capture the rest for deletion.
--   2. Delete the duplicate rows.
--   3. Subtract the removed duplicate deltas from each agent's xp_points
--      (floored at 0).
--   4. Normalize kept rows to the canonical idempotency key
--      `prediction_win_<marketId>_<userId>` so a future awardXp with the
--      new key cannot double-pay against a leftover bet-keyed row.
--   5. Re-derive `rank` and reset `highest_rank` from the corrected XP using
--      the live `ranks` thresholds (peak reset — the inflated peak was never
--      legitimately earned).
--
-- Scope: simulation agents only (is_agent = true AND is_house = false). Human
-- and house profiles are untouched. `legacy_migration` seed XP is intentionally
-- LEFT AS-IS. (Humans only have ~4 extra duplicate rows fleet-wide — negligible.)
--
-- Expected outcome (previewed read-only): 0 Hall of Famers; agents land at
-- Aspirant(2) / Insider(8) / Analyst(3) / Expert(12) / Maven(53); top agent
-- ~104k XP; no agent goes negative (min ~3,894).
--
-- Safety:
--   * Single transaction — all-or-nothing.
--   * Deletion / keepers guarded on market_id IS NOT NULL (0 rows had a null
--     market id in preview) so a row whose market id cannot be resolved is
--     never collapsed.
--   * In-effect idempotent: a re-run finds no remaining duplicates to remove,
--     and kept keys already match the canonical form.
--
-- Run via the Supabase MCP execute_sql tool (data change, not a schema
-- migration) AFTER the code fix has deployed, so no new bet-keyed awards
-- accrue between deploy and cleanup.
-- ============================================================================

BEGIN;

-- Agents in scope (leaderboard simulation agents, excludes the AMM house).
CREATE TEMP TABLE _recal_agents ON COMMIT DROP AS
SELECT id
FROM profiles
WHERE is_agent = true
  AND COALESCE(is_house, false) = false;

-- Resolve market_id for every agent prediction_win row. Prefer metadata,
-- fall back to the first UUID in the legacy/canonical idempotency key
-- (`prediction_win_<marketId>_<betOrUserId>` — marketId is always first).
CREATE TEMP TABLE _recal_pw ON COMMIT DROP AS
SELECT
  xl.id,
  xl.user_id,
  COALESCE(
    xl.metadata->>'marketId',
    (regexp_match(xl.idempotency_key, 'prediction_win_([0-9a-fA-F-]{36})_'))[1]
  ) AS market_id,
  xl.xp_delta,
  xl.created_at,
  xl.idempotency_key,
  xl.metadata
FROM xp_ledger xl
WHERE xl.action_type = 'prediction_win'
  AND xl.user_id IN (SELECT id FROM _recal_agents);

-- Rank within (agent, market). rn=1 is the keeper; rn>1 are duplicates.
CREATE TEMP TABLE _recal_ranked ON COMMIT DROP AS
SELECT
  id,
  user_id,
  market_id,
  xp_delta,
  idempotency_key,
  metadata,
  row_number() OVER (
    PARTITION BY user_id, market_id
    ORDER BY created_at ASC, id ASC
  ) AS rn
FROM _recal_pw
WHERE market_id IS NOT NULL;

CREATE TEMP TABLE _recal_dupes ON COMMIT DROP AS
SELECT id, user_id, market_id, xp_delta
FROM _recal_ranked
WHERE rn > 1;

CREATE TEMP TABLE _recal_keepers ON COMMIT DROP AS
SELECT id, user_id, market_id, idempotency_key, metadata
FROM _recal_ranked
WHERE rn = 1;

-- 1. Remove the duplicate rows from the ledger.
DELETE FROM xp_ledger
WHERE id IN (SELECT id FROM _recal_dupes);

-- 2. Subtract ONLY the removed duplicate deltas from the current xp_points.
--    Floor at 0 as defence-in-depth (preview showed min projected XP ~3,894).
UPDATE profiles p
SET xp_points = GREATEST(0, p.xp_points - d.removed_xp)
FROM (
  SELECT user_id, SUM(xp_delta)::int AS removed_xp
  FROM _recal_dupes
  GROUP BY user_id
) d
WHERE p.id = d.user_id;

-- 3. Normalize kept rows to the canonical key used by awardPredictionWinXp.
--    Also stamp metadata.marketId so future audits don't need the regex.
--    Skip rows already on the canonical key (no-op / re-run safe).
UPDATE xp_ledger xl
SET
  idempotency_key = 'prediction_win_' || k.market_id || '_' || k.user_id,
  metadata = COALESCE(xl.metadata, '{}'::jsonb) || jsonb_build_object('marketId', k.market_id)
FROM _recal_keepers k
WHERE xl.id = k.id
  AND xl.idempotency_key IS DISTINCT FROM ('prediction_win_' || k.market_id || '_' || k.user_id);

-- 4. Re-derive rank + highest_rank from the corrected XP.
UPDATE profiles p
SET rank = r.name,
    highest_rank = r.name
FROM ranks r
WHERE p.id IN (SELECT id FROM _recal_agents)
  AND p.xp_points >= r.min_xp
  AND (r.max_xp IS NULL OR p.xp_points <= r.max_xp);

COMMIT;
