-- Phase 10 smoke test: queue ONE manual agent action on a live AMM market
-- and watch it execute via the deployed worker. Agents must still be paused
-- when you run this; the worker's kill switch only blocks `processDueActions`,
-- but the AMM dispatch path is exactly the same code path the cohort will hit.
--
-- Run order:
--   1) (Optional) Pre-flight cleanup: scripts/phase10-cleanup-stale-actions.sql
--   2) This script — queues one action.
--   3) Temporarily UNPAUSE agents in admin Agents tab JUST long enough for the
--      worker to claim and execute (one ACTION_WORKER_INTERVAL tick), then
--      pause again. (Or set executeAfter to NOW() and unpause briefly.)
--   4) Watch admin > AMM > Trades for the new AMM trade with agentId set.
--   5) Watch admin > AMM > Health for share/credit drift (expect green).
--
-- IMPORTANT: this script is idempotent in spirit only — it inserts a fresh
-- scheduledAgentActions row each time you run it. Run once per smoke test.

DO $$
DECLARE
  v_market_id   varchar;
  v_entry_id    varchar;
  v_agent_id    varchar;
  v_action_id   varchar;
BEGIN
  -- Pick the most recently created OPEN+live AMM h2h market with at least
  -- two entries. H2H gives us a clean binary outcome to inspect.
  SELECT pm.id
    INTO v_market_id
  FROM prediction_markets pm
  WHERE pm.engine     = 'amm'
    AND pm.status     = 'OPEN'
    AND pm.visibility = 'live'
    AND pm.market_type = 'h2h'
    AND pm.end_at > NOW()
  ORDER BY pm.created_at DESC
  LIMIT 1;

  IF v_market_id IS NULL THEN
    RAISE NOTICE 'No live AMM h2h market found; aborting smoke test.';
    RETURN;
  END IF;

  -- Pick the first entry (display_order ASC). We just want a deterministic
  -- target — sizeAmmBudget will refuse to bet if there's no edge.
  SELECT me.id
    INTO v_entry_id
  FROM market_entries me
  WHERE me.market_id = v_market_id
  ORDER BY me.display_order ASC
  LIMIT 1;

  IF v_entry_id IS NULL THEN
    RAISE NOTICE 'Market % has no entries; aborting.', v_market_id;
    RETURN;
  END IF;

  -- Pick the active agent with the highest credit balance. We require at
  -- least 200 credits because that's what we pass as the cap below; a
  -- low-balance agent would just have the worker mark the action skipped.
  -- The worker re-validates agent.is_active before spending so we do not
  -- risk hitting an archived agent.
  SELECT ac.id
    INTO v_agent_id
  FROM agent_configs ac
  JOIN profiles p ON p.id = ac.user_id
  WHERE ac.is_active = true
    AND p.predict_credits >= 200
  ORDER BY p.predict_credits DESC, ac.created_at ASC
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE NOTICE 'No active agent with >= 200 credits; aborting.';
    RETURN;
  END IF;

  -- Confidence 0.85 on a fresh binary market (current price ~0.5) gives
  -- the sizer plenty of edge headroom. stake_amount=200 caps the budget.
  INSERT INTO scheduled_agent_actions (
    agent_id, market_id, entry_id, action_type, decision_payload,
    stake_amount, execute_after, status
  )
  VALUES (
    v_agent_id, v_market_id, v_entry_id, 'predict',
    jsonb_build_object(
      'abstain', false,
      'entryId', v_entry_id,
      'confidence', 0.85,
      'direction', 'yes',
      'source',  'phase10_smoke'
    ),
    200,
    NOW(),
    'pending'
  )
  RETURNING id INTO v_action_id;

  RAISE NOTICE 'Smoke test queued: action_id=%, agent_id=%, market_id=%, entry_id=%',
    v_action_id, v_agent_id, v_market_id, v_entry_id;
END $$;

-- Verify the row landed where you expect.
SELECT
  saa.id              AS action_id,
  saa.status,
  saa.execute_after,
  saa.created_at,
  ac.display_name     AS agent,
  pm.title            AS market_title,
  pm.engine,
  me.label            AS entry_label
FROM scheduled_agent_actions saa
JOIN agent_configs    ac ON ac.id = saa.agent_id
JOIN prediction_markets pm ON pm.id = saa.market_id
JOIN market_entries     me ON me.id = saa.entry_id
WHERE (saa.decision_payload ->> 'source') = 'phase10_smoke'
ORDER BY saa.created_at DESC
LIMIT 5;
