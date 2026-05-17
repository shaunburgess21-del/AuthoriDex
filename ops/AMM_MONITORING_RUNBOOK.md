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
creditedToHouse = houseSeedAmount + totalUserCreditsIn - payoutLiability
```

A drift > 1 credit (rounding tolerance) means somewhere a credit was
created or destroyed. Most likely cause: a bet row written outside the
`executeBuy`/`executeSell` path, or a `prediction_payout` / `prediction_refund`
ledger row not idempotent on the bet id.

### SQL — flag drift on RESOLVED markets in the last 7 days

```sql
WITH resolved AS (
  SELECT
    pm.id,
    pm.title,
    pm.resolved_at,
    (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric  AS credited_to_house,
    (pm.resolution_notes::jsonb->>'payoutLiability')::numeric  AS payout_liability,
    mas.house_seed_amount,
    mas.total_user_credits_in
  FROM prediction_markets pm
  LEFT JOIN market_amm_state mas ON mas.market_id = pm.id
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
  total_user_credits_in,
  payout_liability,
  credited_to_house
    - house_seed_amount
    - total_user_credits_in
    + payout_liability AS drift
FROM resolved
WHERE ABS(
  credited_to_house
    - house_seed_amount
    - total_user_credits_in
    + payout_liability
) > 1
ORDER BY ABS(
  credited_to_house
    - house_seed_amount
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
