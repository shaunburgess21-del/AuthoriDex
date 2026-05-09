# Phase 10 — Wake the agents on AMM (operational runbook)

This runbook covers the **post-deploy** steps for Phase 10. The code changes
are already merged. Follow these steps **in order**.

Pre-condition: agents are still paused (kill switch ON) from Phase 0.

---

## Step 1: Pre-flight cleanup (clear stale actions)

Stale `scheduled_agent_actions` rows queued before the Phase 0 pause would
misfire on the new dual-engine code. Run the cleanup script to mark them
`skipped` with reason `phase0_stale`:

```bash
# Production DB (Supabase SQL editor or psql)
psql "$DATABASE_URL" -f scripts/phase10-cleanup-stale-actions.sql
```

Expected output: a count of stale rows, then 0 remaining after the UPDATE.

If the count is unexpectedly large (>1000), pause and investigate **before**
proceeding — that suggests the kill switch wasn't fully effective.

---

## Step 2: Smoke test (one bet, agents still paused)

Goal: prove the full agent → AMM path works end-to-end on production data
with one controlled bet, before unpausing the cohort.

1. Run the smoke-test script:

   ```bash
   psql "$DATABASE_URL" -f scripts/phase10-smoke-queue-action.sql
   ```

   Output: a `RAISE NOTICE` with `action_id`, `agent_id`, `market_id`, `entry_id`,
   and a verification SELECT showing one new `phase10_smoke` row in `pending`.

2. Briefly unpause agents (admin Agents tab toggle → OFF).
   Worker polls every 2 minutes (`ACTION_WORKER_INTERVAL_MS`), so wait up to 2 min.

3. Re-pause agents (admin Agents tab toggle → ON).

4. Verify the bet executed:
   - **Admin > AMM > Trades**: new row with the smoke agent's name in the Trader column,
     entry matching the smoke target, credits formatted as `+X` (green).
   - **Admin > AMM > Markets**: the market's price for the chosen entry has moved upward.
   - **Admin > AMM > Health**: click "Run audit". All four checks should be green.
   - Railway logs: `[ActionWorker] AMM executed: agent=...`

5. Confirm the action row landed in `executed`:

   ```sql
   SELECT id, status, error_message, executed_at
   FROM scheduled_agent_actions
   WHERE (decision_payload ->> 'source') = 'phase10_smoke'
   ORDER BY created_at DESC LIMIT 5;
   ```

   Expect `status = 'executed'`, `error_message = NULL`.

**If anything is red**: do NOT proceed to step 3. Diagnose first.
- `status = 'skipped'` with `errorMessage = 'amm_no_edge'` → cohort confidence is too
  low for the chosen market; pick a different market and retry.
- `status = 'failed'` with any AMM error → real bug; check logs and rollback.
- Health tab shows drift → ledger problem; rollback and inspect.

---

## Step 3: Wake the cohort

When the smoke test is green:

1. Open the admin **AMM > Health** tab (browser tab visible — polling pauses on hidden tabs).

2. Open admin **AMM > Trades** in a second browser tab.

3. Flip the agent kill switch **OFF** in admin Agents tab.

4. **First 60 minutes — actively monitor**:
   - Agent runner sweeps every 30 minutes (default). Expect 1-2 sweeps in the first hour.
   - Trades tab will fill up as the worker drains the queue.
   - **`edgeBand = 0.10`** means no single agent moves a market price by more than 10pp.
   - **Per-agent budget cap is `MAX_AGENT_STAKE = 300`** (unchanged from parimutuel).

5. Sanity checks during the soak:
   - Run **AMM > Health > Run audit** every ~15 minutes. Stay green throughout.
   - Watch **AMM > Markets** — prices should drift, not jump. Anything > 0.20 move
     in a single sweep means something's wrong with sizing.
   - Watch **AMM > Trades** for repeated bets by the same agent on the same market — the
     pre-filter + idempotency should prevent this.

6. **Abort criteria (flip kill switch back ON immediately)**:
   - Health tab shows share or credits drift.
   - A single market's price changed by more than 30pp in one sweep.
   - Any agent appears more than once on the same market in Trades within 30 minutes.
   - More than 5% of `scheduled_agent_actions` rows in the last hour have
     `status='failed'` (vs. `executed` or benign `skipped`).

The kill switch flip propagates within seconds — both the runner and the worker
re-check `isAgentsPaused()` at the top of each cycle, so the next sweep won't start
new actions and the next worker tick will refuse to execute pending ones.

---

## What's still parking-lot for future phases

- Continuous re-trading (agents revisit AMM markets every hour as prices move).
  Today they bet once + maybe one conviction.
- Agent **sells**. AMM lets them, but `decisionEngine` has no exit signal yet.
- World-market AMM. Community markets remain parimutuel.
- Bumping `MAX_AGENT_STAKE` for AMM. Same 300-credit cap stays, just reinterpreted
  as a budget ceiling instead of a flat-stake amount.

---

## Rollback

If anything goes catastrophically wrong:

1. Flip kill switch ON (stops new sweeps + new executions immediately).
2. Revert the Phase 10 deploy (`git revert <commit>` on prod branch, redeploy).
3. Mark in-flight pending actions as `skipped`:
   ```sql
   UPDATE scheduled_agent_actions
   SET status = 'skipped',
       error_message = 'phase10_rollback',
       executed_at = NOW()
   WHERE status = 'pending';
   ```
4. AMM bets that already executed do NOT need rollback — they're real trades the user
   would see in their predictions feed. Settle them naturally at market resolution.
