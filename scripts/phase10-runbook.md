# Phase 10 — Wake the agents on AMM (operational runbook)

This runbook covers the **post-deploy** steps for Phase 10. The code changes
are already merged. Follow these steps **in order**.

Pre-condition: agents are still paused (kill switch ON) from Phase 0.

---

## Lessons learned from the dry-run smoke (2026-05-10)

Documented here so the production wake doesn't repeat them:

1. **Worker tick is 2 minutes, not seconds.** `ACTION_WORKER_INTERVAL_MS = 2 * 60 * 1000`.
   Don't expect a queued action to execute within 20 seconds — budget at least 2-4
   minutes per worker tick. The runner ticks even less frequently.
2. **Worker filter is strict on `visibility='live'`** (actionWorker.ts line 155).
   The smoke endpoint `/api/admin/amm/smoke-create-market` creates markets at
   `visibility='draft'`, which the worker correctly skips with `error_message =
   "Market no longer live"`. Production AMM markets from the weekly cron always emit
   `visibility: "live"` (verified across all 6 generator paths), so this only matters
   for manually-created admin smoke markets.
3. **Worker claim ordering is `execute_after ASC`** with batch size 20. If there's
   a pre-existing queue of older pending actions, a freshly queued smoke can sit
   waiting for several ticks. To force-jump the queue: `UPDATE ... SET execute_after
   = NOW() - INTERVAL '1 day'`.
4. **Toggling the kill switch off also wakes the runner.** Don't leave the switch
   off any longer than needed — the runner will start queueing fresh actions on
   live markets. During the dry-run the runner did not tick in our 9-minute window
   purely by luck. For real ops, prefer to flip on → wait → flip off, with the
   shortest possible window.

---

## Step 1: Pre-flight cleanup (clear stale actions)

Stale `scheduled_agent_actions` rows queued before the Phase 0 pause would
misfire on the new dual-engine code. Run the cleanup script to mark them
`skipped` with reason `phase0_stale`:

```bash
# Production DB (Supabase SQL editor, psql, or Cursor's Supabase MCP)
psql "$DATABASE_URL" -f scripts/phase10-cleanup-stale-actions.sql
```

Expected output: a count of stale rows, then 0 remaining after the UPDATE.

If the count is unexpectedly large (>1000), pause and investigate **before**
proceeding — that suggests the kill switch wasn't fully effective.

---

## Step 2: Smoke test (one bet, agents still paused)

Goal: prove the full agent → AMM path works end-to-end on production data
with one controlled bet, before unpausing the cohort.

The original `phase10-smoke-queue-action.sql` targets `market_type='h2h'` AMM
markets, which only appear after the weekly cron runs Mon 00:05 UTC. If you're
running the smoke **before** that cron has fired (e.g. at the dry-run stage),
use the manual create-then-queue flow below instead.

### Variant A — there's already a live AMM h2h market (post-cron)

```bash
psql "$DATABASE_URL" -f scripts/phase10-smoke-queue-action.sql
```

### Variant B — no live AMM markets yet (pre-cron / dry run)

1. Spin up an OPEN AMM smoke market via the helper:

   ```bash
   npm run amm:create-open
   ```

   Note the `marketId` and `entries[0].id` from the output.

2. Promote it to `visibility='live'` (the smoke endpoint creates `draft`,
   which the worker filters out — see lessons-learned #2):

   ```sql
   UPDATE prediction_markets SET visibility = 'live' WHERE id = '<marketId>';
   ```

3. Queue a single agent action against entry A. Pick a V2 cohort agent with
   ≥200 credits, and **backdate `execute_after`** to jump the queue (see
   lessons-learned #3):

   ```sql
   INSERT INTO scheduled_agent_actions (
     agent_id, market_id, entry_id, action_type, decision_payload,
     stake_amount, execute_after, status
   )
   SELECT ac.id, '<marketId>', '<entryAId>', 'predict',
     jsonb_build_object('abstain', false, 'entryId', '<entryAId>',
       'confidence', 0.85, 'direction', 'yes', 'source', 'phase10_smoke'),
     200, NOW() - INTERVAL '1 day', 'pending'
   FROM agent_configs ac JOIN profiles p ON p.id = ac.user_id
   WHERE ac.is_active = true
     AND ac.simulation_profile ->> 'cohortId' = 'v2-2026-prelaunch'
     AND p.predict_credits >= 200
   ORDER BY p.predict_credits DESC
   LIMIT 1;
   ```

### Then for either variant

1. Briefly unpause agents (admin Agents tab toggle → OFF).
   Worker polls every 2 minutes; budget **2-4 minutes** before action transitions.
   Don't flip back too soon (see lessons-learned #1).

2. Verify the bet executed:
   - **Admin > AMM > Trades**: new row with the smoke agent's name in the Trader column,
     entry matching the smoke target, credits formatted as `+X` (green).
   - **Admin > AMM > Markets**: the market's price for the chosen entry has moved upward.
   - **Admin > AMM > Health**: click "Run audit". All four checks should be green.
   - Railway logs: `[ActionWorker] AMM executed: agent=...`

3. Re-pause agents (admin Agents tab toggle → ON).

4. Confirm the action row landed in `executed`:

   ```sql
   SELECT id, status, error_message, executed_at
   FROM scheduled_agent_actions
   WHERE (decision_payload ->> 'source') LIKE 'phase10_smoke%'
   ORDER BY created_at DESC LIMIT 5;
   ```

   Expect `status = 'executed'`, `error_message = NULL`.

5. **(Variant B only) Clean up the smoke market** so it doesn't sit live and
   confuse users:

   ```bash
   npm run amm:void -- <marketId>
   ```

   Verify quietEdge balance is back to 50,000, house balance is back to its
   pre-smoke value, market status = `VOID`, bet status = `void`.

**If anything is red**: do NOT proceed to step 3. Diagnose first.
- `status = 'skipped'` with `errorMessage = 'Market no longer live'` →
  market is `visibility='draft'`. Promote to `live` (Variant B step 2).
- `status = 'skipped'` with `errorMessage = 'amm_no_edge'` → cohort confidence is too
  low for the chosen market; pick a different market and retry.
- `status = 'failed'` with any AMM error → real bug; check logs and rollback.
- Health tab shows drift → ledger problem; rollback and inspect.

---

## Step 3: Wake the cohort

When the smoke test is green:

1. **Wait for the weekly cron** if you haven't already. The AMM updown + h2h
   markets the cohort will trade on are auto-generated **Mon 00:05 UTC**. Wake
   the cohort *after* this so they enter a clean week. Confirm the cron ran:

   ```sql
   SELECT engine, market_type, COUNT(*)
   FROM prediction_markets
   WHERE status = 'OPEN' AND end_at > NOW()
   GROUP BY engine, market_type ORDER BY engine, market_type;
   ```

   Expect rows for `amm/updown`, `amm/h2h`, `parimutuel/gainer`,
   `parimutuel/jackpot`. If `amm/*` rows are missing, the cron didn't fire —
   investigate via Railway logs (`[MarketGenerator]` lines) or trigger
   `/api/cron/generate-weekly-markets` manually before proceeding.

2. Open the admin **AMM > Health** tab (browser tab visible — polling pauses on hidden tabs).

3. Open admin **AMM > Trades** in a second browser tab.

4. Flip the agent kill switch **OFF** in admin Agents tab.

5. **First 60 minutes — actively monitor**:
   - Agent runner sweeps every 30 minutes (default). Expect 1-2 sweeps in the first hour.
   - Worker ticks every 2 minutes; trades tab fills as it drains the queue.
   - **`DEFAULT_AGENT_EDGE_BAND = 0.10`** caps the per-trade price impact at 10pp.
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
