-- ============================================================================
-- One-time pre-launch park of public V2 simulation-agent XP / ranks
-- ============================================================================
--
-- Context
-- -------
-- After the July prediction_win duplicate cleanup, 53/64 public V2 agents
-- sat on Maven in a 93k–112k XP cluster. Rank is an honest function of XP,
-- and the fleet runs the same markets, so they reconverge. This park
-- scatters them across Analyst / Expert / Maven (~17 / 30 / 17) WITHOUT
-- touching bets, credits, or AMM. Hidden V1 leftovers and humans are
-- untouched.
--
-- Pair with the awardXp() is_agent skip (participation actions only) so
-- they cannot climb back into one band. Bookkeeping actions
-- (admin_adjustment, legacy_migration) still write.
--
-- Method
-- ------
-- Among the current Maven cohort (xp_points >= 75000), a stable hash of
-- profile id assigns:
--   17 keep Maven
--   19 drop to Expert   (plus the 11 agents already on Expert = 30)
--   17 drop to Analyst
-- Target XP is jittered inside the destination band and never raised
-- (LEAST with current xp_points). One negative admin_adjustment ledger
-- row per agent that actually moves, then rank + highest_rank are
-- re-derived from live `ranks` thresholds (peak reset — this XP was
-- never a real user career). Hall Inductee badges on agents are revoked
-- (they were earned during the Hall of Famer overcount).
--
-- Idempotency key: agent_rank_park_20260813_<userId>
-- A re-run finds existing keys and no-ops.
--
-- Run via the Supabase MCP execute_sql tool AFTER the awardXp skip has
-- deployed (or immediately, accepting a small race of new win XP before
-- the skip lands).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _park_v2 ON COMMIT DROP AS
SELECT
  p.id,
  p.username,
  p.xp_points,
  p.rank AS current_rank
FROM profiles p
JOIN agent_configs ac ON ac.user_id = p.id
WHERE p.is_agent = true
  AND COALESCE(p.is_house, false) = false
  AND COALESCE(p.is_public, true) = true
  AND COALESCE(ac.is_active, false) = true;

CREATE TEMP TABLE _park_mavens ON COMMIT DROP AS
SELECT
  id,
  row_number() OVER (ORDER BY abs(hashtext(id::text)), id) AS rn
FROM _park_v2
WHERE xp_points >= 75000;

CREATE TEMP TABLE _park_plan ON COMMIT DROP AS
SELECT
  v.id,
  v.username,
  v.xp_points AS previous_xp,
  v.current_rank,
  CASE
    WHEN m.rn IS NULL THEN 'Expert'
    WHEN m.rn <= 17 THEN 'Maven'
    WHEN m.rn <= 36 THEN 'Expert'
    ELSE 'Analyst'
  END AS target_rank,
  CASE
    WHEN m.rn IS NULL THEN
      GREATEST(35000, LEAST(v.xp_points, 40000 + (abs(hashtext(v.id::text)) % 30000)))
    WHEN m.rn <= 17 THEN
      GREATEST(75000, LEAST(v.xp_points, 80000 + (abs(hashtext(v.id::text)) % 25000)))
    WHEN m.rn <= 36 THEN
      GREATEST(35000, LEAST(v.xp_points, 40000 + (abs(hashtext(v.id::text)) % 30000)))
    ELSE
      GREATEST(15000, LEAST(v.xp_points, 18000 + (abs(hashtext(v.id::text)) % 16000)))
  END AS target_xp
FROM _park_v2 v
LEFT JOIN _park_mavens m ON m.id = v.id;

-- 1. Ledger the haircut. Skip no-ops and already-parked rows.
INSERT INTO xp_ledger (
  user_id,
  action_type,
  xp_delta,
  idempotency_key,
  source,
  metadata
)
SELECT
  p.id,
  'admin_adjustment',
  (p.target_xp - p.previous_xp),
  'agent_rank_park_20260813_' || p.id,
  'admin_adjustment',
  jsonb_build_object(
    'reason', 'agent_rank_park',
    'previousXp', p.previous_xp,
    'targetXp', p.target_xp,
    'previousRank', p.current_rank,
    'targetRank', p.target_rank
  )
FROM _park_plan p
WHERE p.target_xp < p.previous_xp
  AND NOT EXISTS (
    SELECT 1
    FROM xp_ledger xl
    WHERE xl.user_id = p.id
      AND xl.idempotency_key = 'agent_rank_park_20260813_' || p.id
  );

-- 2. Move the denormalised counter to the target (absolute, not a re-sum).
UPDATE profiles pr
SET xp_points = p.target_xp
FROM _park_plan p
WHERE pr.id = p.id
  AND pr.xp_points IS DISTINCT FROM p.target_xp
  AND EXISTS (
    SELECT 1
    FROM xp_ledger xl
    WHERE xl.user_id = p.id
      AND xl.idempotency_key = 'agent_rank_park_20260813_' || p.id
  );

-- 3. Re-derive rank + highest_rank from the parked XP. Peak reset is
--    intentional (same as the July recalibration).
UPDATE profiles pr
SET rank = r.name,
    highest_rank = r.name
FROM _park_plan p
JOIN ranks r
  ON p.target_xp >= r.min_xp
 AND (r.max_xp IS NULL OR p.target_xp <= r.max_xp)
WHERE pr.id = p.id;

-- 4. Hall Inductee was awarded when these agents briefly sat on Hall of
--    Famer from the duplicated win bonus. None of them remain tier 7+.
DELETE FROM user_badges ub
USING profiles p
WHERE ub.user_id = p.id
  AND ub.badge_key = 'hall_inductee'
  AND p.is_agent = true
  AND COALESCE(p.is_house, false) = false;

COMMIT;
