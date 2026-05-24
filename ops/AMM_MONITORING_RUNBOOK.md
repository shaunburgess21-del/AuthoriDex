# AMM Monitoring Runbook

Operator-facing reference for keeping the AMM-only prediction markets
healthy in production. Use after the parimutuel sunset to triage the
specific failure modes the LMSR + seed-return path introduces.

This is a living document — when something new breaks in prod, append
the symptom + the SQL/log query you used to triage so the next
operator gets there faster.

---

## 1. Log patterns to alert on

All logs are written to stdout via `console.error` / `console.warn` /
`console.log` so they show up in Railway's deployment log stream
verbatim. Wire each pattern to a Slack webhook or Sentry alert (see
section 2 for a generic webhook payload shape).

| Severity | Log filter (Railway) | What it means | First response |
|---|---|---|---|
| **P0** | `[AmmResolver]` AND (`failed` OR `error`) | An AMM market resolution crashed mid-tx. Money may not have moved. | Flip `agent_runtime_state.paused=true`. Inspect `prediction_markets.status` for the affected id. |
| **P0** | `duplicate key value violates unique constraint "credit_ledger_idempotency_key"` | Two concurrent calls tried to write the same `amm_buy_*` / `amm_sell_*` / `amm_seed_*` key. Idempotency caught it — no double-debit — but it indicates a race. | Search the logs for the colliding key. Confirm the user only got one bet row in `market_bets`. Open an incident. |
| **P0** | `[MarketResolver]` AND `failed` | Cron resolver loop crashed. Markets won't auto-settle until restart. | Check Railway deploy logs for stack trace. Re-deploy if the container is wedged. |
| **P1** | `[ActionWorker] AMM error` | Agent trade hit a structured `TradeError`. Single agent action is dead-lettered. | Usually self-heals; only investigate if the same agent appears > 5 times in 10 minutes. |
| **P1** | `[AmmTrades]` AND (`Insufficient credits` OR `Market closed` OR `Invalid entry`) | A human or agent buy was rejected at the route boundary. Expected during normal operation. | Inspect rate only — sustained > 10/min suggests UI showing stale state. |
| **P2** | `[amm-bet-hooks]` AND (`failed` OR `XP award failed`) | A post-trade side-effect (XP / referral / badge / engagement) hit an exception. Bet itself succeeded. | Low priority. Aggregate by `surface` tag in Sentry and triage in batches. |
| **P2** | `[SmokeForceResolve]` | The env-gated jackpot force-resolve endpoint fired. Should only ever appear during a smoke run. | If unexpected in prod: rotate `SMOKE_FORCE_RESOLVE` env var off and audit the admin token. |

### Suggested Railway saved searches

```
"[AmmResolver]" "failed"
"[MarketResolver]" "failed"
"duplicate key value" "credit_ledger_idempotency_key"
"[ActionWorker] AMM error"
"[amm-bet-hooks]"
```

---

## 2. Alerting payload shape (generic)

Wire each Railway saved search above to a Slack webhook (or PagerDuty,
or Sentry alert rule). Recommended Slack payload:

```json
{
  "text": ":rotating_light: P0 AMM alert: <PATTERN_NAME>",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Pattern:* `[AmmResolver] failed`\n*Service:* authoridex-prod\n*Window:* last 5 min\n*Count:* {{count}}\n*Sample:* ```{{first_log_line}}```"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Open Railway logs" },
          "url": "https://railway.app/project/<PROJECT_ID>/deployments/<DEPLOY_ID>/logs"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Pause agents (Supabase)" },
          "url": "https://supabase.com/dashboard/project/<PROJECT_REF>/sql/new"
        }
      ]
    }
  ]
}
```

Sentry tags worth setting on captureBackgroundError calls (already
wired by the new helpers):

- `surface` — `amm-bet.engagement` / `amm-bet.xp` / `amm-bet.referral` / `amm-bet.badges` / `amm-resolve.fanout`
- `userId` — for per-user incident threading
- `marketId` — for grouping per affected market

---

## 3. AMM seed-return health check

Every resolved market's house P&L should equal:

```
creditedToHouse = houseSeedAmount + warmStartCost + totalUserCreditsIn - payoutLiability
```

Where `warmStartCost` is the sum of any `amm_warmstart_debit` ledger
entries for the market (zero on markets that didn't trigger a
warm-start prior, AND zero on every market resolved before the
warm-start feature shipped).

A drift > 1 credit (rounding tolerance) means somewhere a credit was
created or destroyed. Most likely cause: a bet row written outside the
`executeBuy`/`executeSell` path, a `prediction_payout` / `prediction_refund`
ledger row not idempotent on the bet id, OR (post-warmstart launch) a
warm-start ledger row that the audit query failed to attribute to a
market via `metadata->>'marketId'`.

### SQL — flag drift on RESOLVED markets in the last 7 days

```sql
WITH warmstart AS (
  SELECT
    metadata->>'marketId' AS market_id,
    COALESCE(SUM(-amount), 0) AS warm_start_cost
  FROM credit_ledger
  WHERE txn_type = 'amm_warmstart_debit'
  GROUP BY metadata->>'marketId'
),
resolved AS (
  SELECT
    pm.id,
    pm.title,
    pm.resolved_at,
    (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric  AS credited_to_house,
    (pm.resolution_notes::jsonb->>'payoutLiability')::numeric  AS payout_liability,
    mas.house_seed_amount,
    mas.total_user_credits_in,
    COALESCE(ws.warm_start_cost, 0)::numeric AS warm_start_cost
  FROM prediction_markets pm
  LEFT JOIN market_amm_state mas ON mas.market_id = pm.id
  LEFT JOIN warmstart ws ON ws.market_id = pm.id
  WHERE pm.status = 'RESOLVED'
    AND pm.engine = 'amm'
    AND pm.resolved_at > now() - interval '7 days'
    -- resolutionNotes is a free-text column; guard the cast so plain-text
    -- admin notes don't blow up the audit.
    AND pm.resolution_notes ~ '^\s*\{'
    AND pm.resolution_notes::jsonb ? 'creditedToHouse'
    AND pm.resolution_notes::jsonb ? 'payoutLiability'
)
SELECT
  id,
  title,
  credited_to_house,
  house_seed_amount,
  warm_start_cost,
  total_user_credits_in,
  payout_liability,
  credited_to_house
    - house_seed_amount
    - warm_start_cost
    - total_user_credits_in
    + payout_liability AS drift
FROM resolved
WHERE ABS(
  credited_to_house
    - house_seed_amount
    - warm_start_cost
    - total_user_credits_in
    + payout_liability
) > 1
ORDER BY ABS(
  credited_to_house
    - house_seed_amount
    - warm_start_cost
    - total_user_credits_in
    + payout_liability
) DESC;
```

Expected: 0 rows. Anything else is a P1 — `scripts/amm-health-check.ts`
runs this check on every invocation.

---

## 4. Stuck-market detector

Markets that hit `endAt` but never finished resolving land in
`CLOSED_PENDING` until the cron picks them up. If they sit there
longer than 24h, something is preventing resolution — usually a missing
close snapshot for jackpot, or a `prediction_snapshots` row that hasn't
landed yet for the underlying source data.

```sql
SELECT
  id,
  slug,
  title,
  market_type,
  status,
  end_at,
  now() - end_at AS stuck_for
FROM prediction_markets
WHERE status = 'CLOSED_PENDING'
  AND end_at < now() - interval '24 hours'
ORDER BY end_at ASC;
```

If you see rows here:

1. Check the resolver loop is running (`[MarketResolver]` log lines in
   the last 5 min).
2. For jackpots, confirm `getCloseSnapshot(personId, end_at)` returns
   data — i.e. `prediction_snapshots` has a row near the `end_at`
   timestamp.
3. For h2h / updown / gainer, confirm the underlying score series has
   actual values at `end_at` (no NULL `score`s in the relevant
   `prediction_snapshots` rows).
4. Last resort: manually resolve via `POST /api/admin/markets/:id/amm-resolve`
   with `void: true` to refund every bet. Document the void reason in
   `resolution_notes`.

---

## 5. Idempotency-key collisions

Every credit_ledger write must carry an idempotency key. Collisions
mean two concurrent transactions wrote the same key — the second is
correctly rejected, but the first might have raced something else.

```sql
SELECT
  idempotency_key,
  COUNT(*) AS attempts,
  array_agg(DISTINCT txn_type) AS txn_types,
  MIN(created_at) AS first,
  MAX(created_at) AS last
FROM credit_ledger
WHERE created_at > now() - interval '24 hours'
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

Expected: 0 rows. If you see rows, the actual write should have
succeeded for one of them (look up that key — exactly one row will
exist in `credit_ledger`). The duplicates were rejected by the unique
constraint — the log line `duplicate key value violates unique constraint`
is the source.

`scripts/amm-health-check.ts` runs this check.

---

## 6. Pause-switch checklist

If anything misbehaves at launch, the kill-switch is a single SQL
update against `agent_runtime_state`. This stops every agent from
placing new trades within ~30s (one worker poll cycle).

### Pause all agents

```sql
UPDATE agent_runtime_state
SET paused = true,
    reason = 'Manual pause — <YYYY-MM-DD> <reason>',
    paused_at = now(),
    updated_at = now()
WHERE id = 'global';
```

### Verify pause took effect

Within 30s of the pause:

- `[ActionWorker]` log lines should stop appearing
- `scheduledAgentActions` rows with `status = 'pending'` will accumulate
  (intentional — they'll execute when un-paused)

### Resume agents

```sql
UPDATE agent_runtime_state
SET paused = false,
    reason = NULL,
    paused_at = NULL,
    updated_at = now()
WHERE id = 'global';
```

If agents have been paused for > 1 hour, expect a brief catch-up burst
of trade activity. Watch `latency.p95` on `/api/markets/:id/buy` for
the first 5 min after resume.

---

## 7. Production smoke + loadgen quick reference

Three scripts you can run from any clone of the repo. All three
auto-load `.env` (and `.env.smoke` where applicable), so plain
invocations work without `--env-file` flags.

| npm script | Direct command | What it does |
|---|---|---|
| `npm run amm:smoke` | `npx tsx scripts/amm-smoke.ts` | Full lifecycle smoke. Creates a draft market, sweeps live H2H / UpDown / Race markets, runs an env-gated jackpot smoke. Reads `.env` + `.env.smoke`. |
| `npm run amm:loadgen -- --market-id <id> --buys-per-user 20` | `npx tsx scripts/amm-loadgen.ts --market-id <id> --buys-per-user 20` | Concurrent-buy stress test against one market. Reports p50/p95/p99 latency and DB invariants. Reads `.env` + `.env.smoke`. |
| `npm run amm:health` | `npx tsx scripts/amm-health-check.ts` | Read-only health audit (orphan ledger / seed drift / stuck markets / negative credits / dup idem keys / agent pause). Cron-able. Reads `.env`. Exits non-zero on issues. |
| `npm run amm:reconcile-house-ledger` | `npx tsx ops/reconcile-house-ledger-drift.ts` | One-shot ledger-only fix when house `predict_credits` != `SUM(credit_ledger.amount)` (see section 7b). `--dry-run` first. Does not change the wallet. |
| `npm run amm:reconcile-orphans` | `npx tsx ops/reconcile-orphan-amm-seeds.ts` | Refund house for orphan `amm_seed_debit` rows on deleted markets. |

> `<id>` in the loadgen command is a **placeholder** — replace it with an
> actual market UUID. Find one fast with:
> ```sql
> SELECT id, slug, market_type, status
> FROM prediction_markets
> WHERE engine = 'amm' AND status = 'OPEN'
> ORDER BY created_at DESC LIMIT 5;
> ```
> Quoting the id is harmless and avoids any shell-parser surprises:
> `npm run amm:loadgen -- --market-id "01J5..."`.

Required env vars (in `.env.smoke`):

```
SMOKE_BASE_URL=https://<your-deployment>.railway.app
SMOKE_ALICE_EMAIL=...
SMOKE_ALICE_PASSWORD=...
SMOKE_BOB_EMAIL=...
SMOKE_BOB_PASSWORD=...
SMOKE_FORCE_RESOLVE=true   # only enable when you want Phase C to run
SMOKE_PHASE_C=skip         # set to skip jackpot phase
```

`SMOKE_FORCE_RESOLVE` is the kill-switch for the jackpot smoke
endpoint. Leave it unset (or `false`) in normal production deploys so
the endpoint returns 403 even if an admin token leaks.

### 7b. House ledger reconciliation drift

**Symptom:** Admin AMM → Invariants shows `house_ledger_reconciliation`
ERROR — `House profile.predict_credits` does not match
`SUM(credit_ledger.amount)` for the house profile. Overview drift card
is red; Operations cron may still be ALL CLEAR (that scheduler does not
run this check).

**Common cause:** `repair-amm-outcomes.ts` wipe-reseed (before the fix)
wrote `amm_seed_refund` ledger rows while deleting the original
`amm_seed_debit` and re-seeding. The house **wallet** nets to zero per
market; the **ledger** gains +`houseSeedAmount` per repaired market.

**Verify:**

```sql
SELECT p.predict_credits AS wallet,
       COALESCE(SUM(cl.amount), 0) AS ledger_sum,
       p.predict_credits - COALESCE(SUM(cl.amount), 0) AS drift
FROM profiles p
LEFT JOIN credit_ledger cl ON cl.user_id = p.id
WHERE p.id = '00000000-0000-0000-0000-0000000000aa'
GROUP BY p.id, p.predict_credits;
```

**Fix (ledger-only, idempotent):**

```
npm run amm:reconcile-house-ledger -- --dry-run
npm run amm:reconcile-house-ledger
```

Writes `txn_type = 'house_ledger_reconciliation'` with
`amount = wallet - ledgerSum` (negative when the ledger is overstated).
Re-run Invariants in admin to confirm green.

### Windows / PowerShell note

PowerShell treats `<` as a reserved redirection operator. If you copy
a command like `--market-id <id>` verbatim into PowerShell (with the
angle brackets), you'll get:
```
The '<' operator is reserved for future use.
```
Either replace `<id>` with the real UUID (no angle brackets), or quote
it: `--market-id "<id>"`. Either form works under bash too.

---

## 8. Automated health-check cron (Railway)

The same audit logic from `scripts/amm-health-check.ts` is also exposed
as `POST /api/cron/amm-health-check` so external schedulers can run it
without spawning a one-off Node process. Recommended cadence: **every
15 minutes** in prod.

### Endpoint contract

```
POST /api/cron/amm-health-check
Authorization: Bearer ${CRON_SECRET}
```

Optional query / body param: `days=N` (override the default 30-day
seed-return-drift lookback window).

Response shape (always `200 OK` for valid runs — failed audits are
reported in the body, only uncaught exceptions return 500):

```json
{
  "success": true,           // mirrors `ok`; flips false when any check failed
  "ok": true,
  "message": "AMM health check passed",
  "summary": { "total": 6, "passed": 5, "warned": 1, "failed": 0 },
  "lookbackDays": 30,
  "checks": [
    { "name": "Orphan credit_ledger rows", "status": "pass", "details": "...", "rowCount": 0 },
    ...
  ],
  "duration": 412,
  "timestamp": "2026-05-17T14:00:00.000Z"
}
```

The endpoint also emits a single summary log line per run so Railway
saved searches can alert on it without parsing the JSON body:

| Status | Log line |
|---|---|
| Pass clean | `[Cron][amm-health-check] PASS — all 6 checks clean` |
| Pass + warns | `[Cron][amm-health-check] PASS with N warning(s): <names>` |
| Fail | `[Cron][amm-health-check] FAIL — N failed check(s): <names>` |

### Railway setup (one-time)

In the Railway dashboard:

1. Create a new **Cron** service in the same project as the main
   deployment.
2. **Schedule:** `*/15 * * * *` (every 15 min).
3. **Command:**
   ```bash
   curl -fsS -X POST \
     -H "Authorization: Bearer $CRON_SECRET" \
     "$RAILWAY_PUBLIC_DOMAIN/api/cron/amm-health-check"
   ```
   (`$RAILWAY_PUBLIC_DOMAIN` resolves to e.g. `https://authoridex-production.up.railway.app`;
   `curl -f` makes the cron run fail on HTTP ≥ 400, so 500s show red in the dashboard.)
4. Variables: `CRON_SECRET` is shared with the main service; reference
   it via `${{ shared.CRON_SECRET }}` in the cron service settings.

### Companion cron — weekly lifetime drift sweep

The 15-min cron only audits the last 30 days. A drift introduced 45
days ago would never surface. To cover that long-tail integrity gap,
add a SECOND Railway cron that runs the same endpoint with a 10-year
lookback once a week, just after weekly resolution completes.

In the Railway dashboard:

1. Create a new **Cron** service alongside the 15-min one (do NOT
   modify the existing 15-min cron — the two run independently).
2. **Schedule:** `0 4 * * 0` (Sundays 04:00 UTC, ~4h after the
   Sunday-night weekly resolution wraps).
3. **Command:**
   ```bash
   curl -fsS -X POST \
     -H "Authorization: Bearer $CRON_SECRET" \
     "$RAILWAY_PUBLIC_DOMAIN/api/cron/amm-health-check?days=3650"
   ```
   (`days=3650` is ~10 years, effectively "all RESOLVED markets ever".
   No code change required — the endpoint already accepts a `days`
   query param.)
4. Variables: same `${{ shared.CRON_SECRET }}` as the 15-min cron.

The endpoint emits the same `[Cron][amm-health-check] PASS/FAIL` log
line for both crons, so a single Railway saved-search alert covers
both schedules. Expected behaviour: PASS every Sunday. Any FAIL on
the weekly sweep that wasn't already FAILing on the 15-min cron means
a pre-30-day-old drift has been discovered — open an incident
immediately, as the source bug may already be fixed but the bad data
is still in production.

### Alerting

Two complementary paths, pick whichever fits your stack:

- **Railway log search** → Slack webhook on the saved search
  `[Cron][amm-health-check] FAIL`. Severity: P1.
- **Sentry HTTP alert** on response body where `ok=false`. Useful if
  you want richer context (the `checks` array drops straight into
  Sentry's structured-event panel).

### Failure modes worth pre-paging on

| Failed check | Likely cause | First response |
|---|---|---|
| `Orphan credit_ledger rows` | Manual sunset/wipe script ran in prod and left ledger rows behind. | Investigate which markets were deleted; consider voiding the orphan ledger rows. |
| `AMM seed-return drift` | A non-`executeBuy`/`executeSell` codepath wrote credits, or a payout was non-idempotent. | Pause agents. Read section 3. |
| `Stuck CLOSED_PENDING markets (> 24h)` | Resolver cron is wedged or upstream snapshot data is missing. | Read section 4. |
| `Profiles with negative predict_credits` | Missing `FOR UPDATE` somewhere in a debit path. | Hard P0. Pause agents and inspect the most recent debit ledger rows for that user. |

### Backfill / replay

If you want to run a one-off audit against a wider window (e.g. all
RESOLVED markets ever) without disturbing the cron:

```
npm run amm:health -- --days 365
```

The CLI and the cron endpoint share the exact same module
(`server/jobs/amm-health.ts`), so the two surfaces never drift.

---

## 9. Admin "Operations" sub-tab

Live admin-panel view over the persisted health-check history. Sits at
**Admin → AMM → Operations**, alongside the existing manual financial-
invariants `Health` sub-tab (which it does NOT replace — different concern).

What it surfaces:

- **Status header.** Big overall pill (green ALL CLEAR / amber PASS WITH
  WARNINGS / red FAILING), `N pass · M warn · K fail` counts, relative
  time since the last run, source badge (SCHEDULER / CRON / MANUAL), and
  a row of small stat tiles (total checks, last-run duration, lookback
  window, time until next scheduler tick).
- **Last 24h trend strip.** One coloured cell per persisted run, hover
  for per-run breakdown. Fastest possible glance at "did anything go
  wrong overnight?". Driven by the `amm_health_check_runs` table.
- **Per-check cards.** One card per audit on the latest run — sorted
  failures first, then warnings, then passes. Each card shows the
  `details` text, an expandable JSON drawer of the affected-rows
  sample, and a `Copy IDs` button when the sample carries `marketId`.

Auto-refresh every 60s while the tab is open and the browser tab is
visible (pauses when the tab is hidden so background sessions don't hit
the DB). A `Run now` button triggers an immediate audit, server-side
rate-limited to one run per 60 seconds per admin to prevent dogpiling.

### Endpoints

All gated by `requireAdmin`:

```
GET  /api/admin/amm/operational-health/latest
GET  /api/admin/amm/operational-health/history?hours=24    (max 168)
POST /api/admin/amm/operational-health/run                 (rate-limited)
```

### Reading the trend strip

| Cell colour | Meaning |
|---|---|
| Green | All checks passed cleanly. Default state. |
| Amber | At least one check returned `warn` (e.g. agent runtime is paused, dup idempotency keys observed in 24h). Read but don't page. |
| Red | At least one check returned `fail`. Page someone. |

A run of green cells with one red mid-strip is the most useful incident
fingerprint: hover the red cell to see exactly which check failed and
which markets were affected, then walk forward through the cells to see
when it self-resolved (or didn't).

### When to use this vs. the manual `Health` tab

- **Operations** (this section, auto-refresh): "is anything wrong right
  now and was anything wrong overnight?". Continuous monitoring.
- **Health** (manual, separate sub-tab): "I want to run a deep
  financial-invariants audit right now to chase a specific suspicion".
  Runs heavier queries (state vs bets math) on demand.

The two share no data — Operations reads the persisted scheduler runs;
Health re-queries every market's invariants from scratch on click.

---

## 10. Escalation

- **Money moved incorrectly** (drift > 1 credit on seed-return, or
  `credit_ledger` and `market_bets` disagree): pause agents, freeze
  market creation by flipping `prediction_markets.visibility = 'draft'`
  on new rows, open an incident.
- **Resolution path crashed mid-tx**: pause agents. Check
  `prediction_markets.status` for the affected ids — anything in
  `CLOSED_PENDING` will retry on the next cron tick. Use the
  `void: true` admin route to refund if the underlying data is bad.
- **AMM state corruption** (negative `share_quantities` / prices out
  of range): pause agents AND set affected market to
  `visibility = 'draft'` so no further trades. Investigate before any
  resume.

---

## 11. Related files

- `server/services/amm-trades.ts` — `executeBuy` / `executeSell`
- `server/services/amm-resolver.ts` — `resolveAmmMarket`
- `server/jobs/market-resolver.ts` — cron loop + `resolveJackpot`
- `server/jobs/amm-health.ts` — shared health-check audit module (CLI + cron + scheduler + admin endpoints) and `runAndPersistAmmHealthCheck`
- `server/services/amm-bet-hooks.ts` — post-trade side effects helper
- `server/route-modules/cron-routes.ts` — `POST /api/cron/amm-health-check`
- `server/index.ts` — `startAmmHealthCheckScheduler` (in-process, 15-min cadence; persists each run)
- `client/src/components/admin/AmmOperationsTab.tsx` — admin Operations sub-tab UI
- `migrations/0063_amm_health_check_runs.sql` — persisted history table
- `scripts/amm-smoke.ts` — lifecycle smoke (Phase A/B/C)
- `scripts/amm-loadgen.ts` — concurrent buy stress test
- `scripts/amm-health-check.ts` — read-only audits CLI wrapper
- `server/agents/drainBreaker.ts` — auto drain-breaker (see section 12)

---

## 12. Drain breaker triage

The drain breaker (`server/agents/drainBreaker.ts`) auto-pauses every
agent when the house's 24h AMM P&L exceeds `min(absoluteCap, pctCap × houseBalance)`.
Defaults: `DRAIN_BREAKER_LOSS_CAP_CREDITS=50000`, `DRAIN_BREAKER_LOSS_CAP_PCT=0.2`.
**The breaker never auto-resumes — a human must investigate first.**

When it trips you'll see one of:

- Log line: `[DrainBreaker] TRIPPED — auto_drawdown_breaker: 24h house P&L = -XXXXX credits ...`
- Sentry event: `DrainBreaker tripped` with `{houseDelta24h, houseBalance, thresholdApplied}` tags
- Admin "Operations" tab: agent runtime state tile flips red with the reason text
- `adminAuditLog` row with `action_type='agents_auto_drain_breaker_trip'`

### First 3 things to check

The right answer is rarely "raise the cap and resume." It's usually
"find the bug that caused the bleed, fix it, then resume." Work
through these three in order before touching the cap.

#### Check 1 — Which markets ate the loss?

If <3 markets are responsible for >50% of the 24h loss, the cause is
almost always a single resolution mis-call OR a single mispriced market
the agents piled into. If the loss is evenly distributed across 20+
markets, the cause is systemic (signal-engine bug, sizing regression).

```sql
-- Top 20 markets by house loss in the last 24h.
-- Resolved markets read from resolution_notes; open markets are skipped
-- here (you can't attribute realised loss to an open market). Warm-start
-- cost is subtracted from the realised P&L so a warm-started market
-- whose prior was wrong sorts to the top of the loss list correctly.
WITH warmstart AS (
  SELECT
    metadata->>'marketId' AS market_id,
    COALESCE(SUM(-amount), 0) AS warm_start_cost
  FROM credit_ledger
  WHERE txn_type = 'amm_warmstart_debit'
  GROUP BY metadata->>'marketId'
)
SELECT
  pm.id,
  pm.title,
  pm.market_type,
  pm.resolved_at,
  (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric  AS credited_to_house,
  (pm.resolution_notes::jsonb->>'payoutLiability')::numeric  AS payout_liability,
  COALESCE(ws.warm_start_cost, 0)                            AS warm_start_cost,
  (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric
    - mas.house_seed_amount
    - COALESCE(ws.warm_start_cost, 0)
    AS house_pnl
FROM prediction_markets pm
LEFT JOIN market_amm_state mas ON mas.market_id = pm.id
LEFT JOIN warmstart ws ON ws.market_id = pm.id
WHERE pm.engine = 'amm'
  AND pm.resolved_at > now() - interval '24 hours'
  AND pm.resolution_notes ~ '^\s*\{'
  AND pm.resolution_notes::jsonb ? 'creditedToHouse'
ORDER BY house_pnl ASC
LIMIT 20;
```

If you see one or two markets with house_pnl < -3000, open them in the
admin AMM tab and inspect the trade history — usually one persona band
piled in on the cheap side and got paid out at 1.0.

#### Check 2 — Which persona band is over-represented in winners?

Healthy state: sharps win more than they lose; noisy/casual roughly
break even; whales swing with variance. If a non-sharp band is
systematically winning, it's almost certainly a pricing bug (e.g. the
agents collectively read a signal wrong and the AMM mispriced, so
whoever fired first got cheap shares).

```sql
-- Winner shares per persona band over the last 24h.
SELECT
  ac.simulation_profile->>'personaBand' AS persona_band,
  COUNT(*) FILTER (WHERE mb.status = 'won')  AS wins,
  COUNT(*) FILTER (WHERE mb.status = 'lost') AS losses,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE mb.status = 'won')
      / NULLIF(COUNT(*) FILTER (WHERE mb.status IN ('won','lost')), 0),
    1
  ) AS win_rate_pct,
  COUNT(*) FILTER (WHERE mb.status IN ('won','lost')) AS settled_trades
FROM market_bets mb
JOIN agent_configs ac ON ac.id = mb.agent_id
WHERE mb.agent_id IS NOT NULL
  AND mb.settled_at > now() - interval '24 hours'
  AND mb.status IN ('won','lost')
GROUP BY ac.simulation_profile->>'personaBand'
ORDER BY win_rate_pct DESC;
```

Read: if `noisy` is sitting at 65% win rate and `sharp` at 40%, the
agents collectively bet the wrong direction and noisy got there by
coin-flip. That's a signal-engine bug, not a noise-agent bug.

#### Check 3 — Recent decision-engine changes

Most drain-breaker trips have been caused by a code change in the last
week or two — Plan D (May 18) is the canonical example. Before raising
the cap, eyeball recent commits to the agent decision path:

```bash
git log --since='7 days' --oneline -- server/agents/ server/agents/decisionEngine.ts server/agents/sharpRanker.ts server/agents/sizing.ts
```

If you see a recent change to signal weighting, gating, or sizing,
that's your prime suspect. Revert it on a branch, run the unit tests,
and check whether the bleed reproduces in a smoke environment before
re-deploying to prod.

### Decision tree

```
                  Drain breaker tripped
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
   Loss concentrated in           Loss spread across
   1-3 markets?                   10+ markets?
   (Check 1)                      (Check 1)
            │                           │
            ▼                           ▼
   ─ Likely a single                ─ Likely a systemic bug
     resolution mis-call              (signal weighting,
     OR a hot market the              sizing curve, ranker)
     agents piled into.            ─ DO NOT raise the cap.
   ─ Inspect the markets.          ─ Run check 2 + check 3.
   ─ If the resolution was         ─ Find the offending commit
     wrong: void manually,           on the agent path.
     refund users, resume           ─ Revert / fix on a branch,
     agents.                         deploy, then resume.
   ─ If the resolution was
     correct: this is normal
     variance — raise the abs
     cap to a level that
     absorbs N similar weeks,
     then resume.
```

### When to raise the cap vs leave paused

| Situation | Action |
|---|---|
| One bad resolution call, agents otherwise fine | Void the bad market, resume agents, leave cap as-is |
| Healthy weekly resolution swing larger than the cap | Raise `DRAIN_BREAKER_LOSS_CAP_CREDITS` to ~3× the observed weekly P&L variance, resume |
| Signal/sizing regression in the last 7 days | Revert or fix the commit BEFORE resuming; leave cap as-is |
| Persistent multi-week drain with no obvious cause | Leave paused. Open an incident. Run the persona-band P&L tile on 30-day window. Page another engineer. |

### Resuming after triage

After you've identified and resolved the root cause:

1. Document the cause in an `adminAuditLog` row (via Admin → Agents
   → "Add audit note") so the incident has a permanent trail.
2. Unpause via Admin → Agents → "Resume agents" (or the SQL in
   section 6 of this runbook).
3. Watch the next 15-min health-check tick — confirm the runtime tile
   stays green.
4. If you raised `DRAIN_BREAKER_LOSS_CAP_CREDITS`, redeploy Railway
   so the new value takes effect, and update this runbook with the
   reason for the bump.

### Worked example — 2026-05-18 trip

**Symptom:** Breaker tripped at 15:33 UTC with `houseDelta24h ≈ -168,013`
against the default `50,000` absolute cap. Drake's Trend Score had
climbed but his AMM price still favoured DOWN, indicating agents had
been paused for ~24h before anyone noticed.

**Triage:**

- Check 1 — loss was spread across 20+ markets, no single outlier > 10%
  of total. *Conclusion: systemic, not a single-market mis-call.*
- Check 2 — noisy/casual cohort was over-represented in wins,
  sharps were losing. *Conclusion: agents collectively bet wrong direction.*
- Check 3 — recent commits showed wikiPulse and newsLevel had been
  added to the signal-boost path and were stacking with `pctChangeVsOpen`.
  *Conclusion: signal-engine bug ("Plan D" issue).*

**Resolution:** Removed `wikiPulse` and `newsLevel` from the
deterministic decision path (composite-only signals). Raised
`DRAIN_BREAKER_LOSS_CAP_CREDITS` to `2,000,000` so a future bug-free
weekly resolution swing of 100-500k doesn't trip on the same conservative
floor. Hardened the pause-flag DB read with a retry+fail-open wrapper
so a single transient DB error couldn't leak a worker tick of bets.

Total wall-clock from symptom-spotted → root-caused → fix-deployed:
~3 hours. With the triage section above, a future repeat should land
closer to 30-45 min.

---

## 13. Known fragilities

Small inconsistencies in the codebase that can't easily be fixed but
will mislead the next operator if not flagged. When you hit one, add
to this list with the workaround.

### `prediction_markets.void_reason` has two writers

The AMM resolver (`server/services/amm-resolver.ts`) sets a stable
machine-readable code (`amm_auto_tie`, `amm_admin_void`, etc.), then
the cron's outer update (`server/jobs/market-resolver.ts`) immediately
overwrites it with humanized display text (e.g. "Tie — score unchanged",
"Tie — identical scores", "Tie — identical top gain percentage").

**Workaround:** when writing SQL that needs to programmatically
identify void causes, query `resolution_notes::jsonb->>'outcome'`
instead — it's set by the same outer code path and never overwritten.
For tied resolutions specifically, look for `'void_tie'`.

The dual-writer is a known fragility flagged for eventual consolidation
(target: dedicated `void_cause` column for machine codes, humanized
text moves to `void_reason_display` or similar). **Don't add new
readers that depend on `void_reason`'s machine-readable form.**

Affected check: `checkTieVoidRate` in `server/jobs/amm-health.ts`
correctly queries `resolution_notes::jsonb->>'outcome' = 'void_tie'`
(see commit history for the bug that caught this).

### `HOUSE_PNL_TXN_TYPES` must stay in sync across every reader

Every call site that sums house P&L from `credit_ledger` consumes the
shared `HOUSE_PNL_TXN_TYPES` constant in
`server/services/amm-ledger-types.ts`. The drain breaker
(`server/agents/drainBreaker.ts`) and the admin
`/api/admin/amm/house` endpoint (`server/routes.ts`) both pull from
this set; adding a new AMM ledger txn type means updating exactly
THIS one place.

The consistency test
`tests/amm-house-pnl-consistency.test.ts` guards the contract — it
fails CI if the set is missing seed/warmstart/payout coverage. **Do
not add a parallel hardcoded IN-list anywhere else in the codebase**;
take the constant via import or extend it in the shared module.

---

## 14. Flag-flip preconditions

Two feature flags ship in their OFF state and need explicit
preconditions before flipping ON in production. Operator must work
through the relevant checklist before enabling each flag, then update
this section with the flip date + observed-stable-for window.

### Before flipping `WORLD_MARKETS_LLM_ENABLED=true`

1. **Run the calibration audit:** `npm run world:calibrate`
2. **Sanity floor tranche** accuracy >= 90% (the model can find facts).
3. **Past-but-obscured tranche** absolute calibration error < 0.15
   across every band with sample size >= 5.
4. The script's stdout VERDICT line reads "Calibration looks
   acceptable; flag flip is justified." (Exit code 0.)
5. Top up the OpenAI billing balance — at full agent cohort, expect
   ~$6/day amortised across the world-market cache TTL tiers.
6. Confirm `WORLD_MARKETS_LLM_ENABLED` parses correctly under
   `envFlag()` in Railway — values `TRUE`, `1`, `yes`, `on` all work;
   strict `"true"` only is no longer required (see
   `server/agents/constants.ts` `envFlag` for the lenient parser).
7. **Daily budget cap is set.** `WORLD_MARKETS_DAILY_BUDGET_USD`
   defaults to `5.00` USD per process — a safety rail, NOT an
   accounting boundary. If a buggy TTL or short-horizon spike tries to
   blow past it, agents stop calling OpenAI for the rest of the UTC
   day; cached assessments continue to serve. Raise via Railway env
   once you've observed steady-state spend on the OpenAI billing
   dashboard for a week. Log filter to watch:
   `[WorldEngineBudget] cap exhausted` (fires at most once per day per
   process). The companion `[WorldEngineBudget] Day rolled over`
   line at UTC midnight reports yesterday's totals as a heartbeat.
   Per-call cost estimate is tunable separately via
   `WORLD_MARKETS_PER_CALL_ESTIMATE_USD` (default `0.40`) if billing
   reconciliation shows the estimate is materially off.

Calibration reports are archived at
`ops/world-market-calibration-YYYY-MM-DD.md` for every run; keep the
report from the most recent flip-decision call so the rationale is
recoverable later.

### Before flipping `WARM_START_PRIORS_ENABLED=true`

1. **Persona-band P&L tile** in Admin → AMM → Overview has 30+ days
   of data and shows the cold-start gap (non-sharp bands earning
   credit P&L on Up/Down markets, suggesting the 50/50 prior is
   leaking value to sharps and noisy alike).
2. **`realisedPnl` formula in `/api/admin/amm/house`** accounts for
   `amm_warmstart_payout` — confirm by running the smoke flow with
   warm-start enabled on a single test market, settling it, and
   checking the dashboard doesn't show a phantom drift.
3. **`HOUSE_PNL_TXN_TYPES` includes `amm_warmstart_payout`** — drain
   breaker won't undercount the offsetting inflows. The consistency
   test (`tests/amm-house-pnl-consistency.test.ts`) catches this if
   the set drifts.
4. House balance can absorb the expected warm-start outflow without
   the breaker tripping. Warm-start only fires when
   `|scoreDelta7d| >= 2pp` (see `WARM_START_MIN_DELTA_PCT` in
   `server/services/amm-warmstart.ts`), so the count is "up to N
   markets" where N is the weekly Up/Down catalogue size. Cost per
   fire ranges ~600 (55/45) to ~1600 (60/40) credits. Rule of thumb
   upper bound: if every market triggered, ~150 markets × 1500 credits
   = ~225k credits/week of additional house exposure. In practice the
   share is lower — typically ~30-70% of markets clear the 2pp floor.
5. After flipping the flag, watch the next Sunday market generation.
   Expected ledger filter: `WHERE idempotency_key LIKE 'amm_warmstart_%'`
   should show new debit rows for the subset of markets whose
   `trending_people.change_7d` magnitude clears the 2pp threshold.
   Zero rows in the first week means either the threshold filtered
   everything (the score-change distribution is quieter than expected)
   or the flag didn't actually flip (re-check Railway env var parsing
   under `envFlag`).

### Rollback procedure (either flag)

Both flags are read at process start via `envFlag()` and re-evaluated
each agent runner / world-market sweep. To roll back:

1. Set the env var to `false` in Railway.
2. Redeploy the affected service (main app, agents worker).
3. New activity stops within one worker tick (~30s for agents,
   ~30min for the world-market re-eval cron).
4. EXISTING positions / warm-start shares from before the rollback
   continue through resolution normally — both flags only gate NEW
   activity creation, never existing settlements.
