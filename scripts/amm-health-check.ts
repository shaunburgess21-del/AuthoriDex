/**
 * AMM operational health-check.
 *
 * Read-only SQL audit, designed to be cron-able. Prints a one-line
 * pass/fail summary plus per-category details. Exit code 1 on any
 * failed check.
 *
 * Checks (mirrors ops/AMM_MONITORING_RUNBOOK.md):
 *   1. Orphan credit_ledger rows — metadata.marketId references a
 *      market that no longer exists.
 *   2. AMM seed-return drift — for RESOLVED amm markets in the last
 *      30 days, creditedToHouse should equal
 *      houseSeedAmount + totalUserCreditsIn - payoutLiability
 *      (within 1 credit rounding tolerance).
 *   3. Stuck markets — CLOSED_PENDING for > 24h.
 *   4. Negative credits — any profile with predict_credits < 0.
 *   5. Duplicate idempotency keys in credit_ledger in the last 24h
 *      (the unique constraint catches them, but the SELECT shows
 *      that they were attempted — useful for race-detection).
 *   6. Agent pause state — warn (not fail) if paused without a recent
 *      reason.
 *
 * Run with:
 *   npx tsx scripts/amm-health-check.ts [--days 30]
 *
 * Honours .env automatically (via the existing db client). No
 * additional env vars required beyond what the dev server needs.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Auto-load `.env` so plain `tsx scripts/amm-health-check.ts` works
// without remembering `--env-file=.env`. Must happen BEFORE the db /
// schema imports below because `../server/db` throws at import time
// if `DATABASE_URL` is missing. The dynamic-import + top-level-await
// pattern is required to defer those imports until after the loader
// has populated `process.env` — static ESM imports get hoisted above
// any code in the module body, so a plain `import { db }` here would
// fire before this loader ran.
//
// In Railway / cron environments DATABASE_URL is already set via the
// host, so the .env file may not exist — the existsSync guard keeps
// that path silent.
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const { and, eq, lt, sql } = await import("drizzle-orm");
const { db } = await import("../server/db");
const {
  agentRuntimeState,
  predictionMarkets,
  profiles,
} = await import("@shared/schema");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

const RESOLUTION_LOOKBACK_DAYS = Number(parseArg("--days") ?? "30");

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  details: string;
  rowCount?: number;
  sample?: unknown[];
}

const checks: CheckResult[] = [];

function record(r: CheckResult): void {
  checks.push(r);
  const tag =
    r.status === "pass" ? green("PASS") : r.status === "warn" ? yellow("WARN") : red("FAIL");
  const head = `[${tag}] ${bold(r.name)}${r.rowCount !== undefined ? dim(` (${r.rowCount} row${r.rowCount === 1 ? "" : "s"})`) : ""}`;
  console.log(head);
  for (const line of r.details.split("\n")) {
    if (line.trim()) console.log(`    ${line}`);
  }
  if (r.sample && r.sample.length > 0) {
    for (const s of r.sample.slice(0, 3)) {
      console.log(`    ${dim(JSON.stringify(s))}`);
    }
    if (r.sample.length > 3) console.log(`    ${dim(`... ${r.sample.length - 3} more not shown`)}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Check 1: orphan credit_ledger rows
// ---------------------------------------------------------------------------
async function checkOrphanLedger(): Promise<void> {
  // We only audit rows whose metadata.marketId is set. Some rows (sign-
  // up bonuses, manual admin adjustments, jackpot ticket refunds for
  // markets that pre-date the snapshot) intentionally omit marketId.
  // Run COUNT first so the "rowCount" reflects reality even when there
  // are more than the sample-size cap (1000 rows).
  const countResult = (await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM credit_ledger cl
    WHERE cl.metadata->>'marketId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prediction_markets pm
        WHERE pm.id = cl.metadata->>'marketId'
      )
  `)).rows as unknown as Array<{ total: number }>;
  const count = countResult[0]?.total ?? 0;

  const sampleRows =
    count > 0
      ? ((await db.execute(sql`
          SELECT cl.id,
                 cl.metadata->>'marketId' AS market_id,
                 cl.txn_type,
                 cl.created_at
          FROM credit_ledger cl
          WHERE cl.metadata->>'marketId' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM prediction_markets pm
              WHERE pm.id = cl.metadata->>'marketId'
            )
          ORDER BY cl.created_at DESC
          LIMIT 10
        `)).rows as unknown as Array<{
          id: string;
          market_id: string;
          txn_type: string;
          created_at: Date;
        }>)
      : [];

  record({
    name: "Orphan credit_ledger rows",
    status: count === 0 ? "pass" : "fail",
    rowCount: count,
    details:
      count === 0
        ? "No credit_ledger rows reference deleted markets."
        : `Found ${count} ledger row(s) whose metadata.marketId points to a deleted market. These imply a market was hard-deleted while keeping its ledger trail — usually a sunset/wipe script side effect, but worth verifying.`,
    sample: sampleRows,
  });
}

// ---------------------------------------------------------------------------
// Check 2: AMM seed-return drift
// ---------------------------------------------------------------------------
async function checkSeedReturnDrift(): Promise<void> {
  const cutoff = new Date(Date.now() - RESOLUTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // Require BOTH `creditedToHouse` and `payoutLiability` keys before
  // computing drift — a row missing one would arithmetic-cast to NULL
  // and silently get filtered out, hiding a real issue.
  const rows = (await db.execute(sql`
    WITH resolved AS (
      SELECT
        pm.id,
        pm.title,
        (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric  AS credited_to_house,
        (pm.resolution_notes::jsonb->>'payoutLiability')::numeric  AS payout_liability,
        mas.house_seed_amount,
        mas.total_user_credits_in
      FROM prediction_markets pm
      LEFT JOIN market_amm_state mas ON mas.market_id = pm.id
      WHERE pm.status = 'RESOLVED'
        AND pm.engine = 'amm'
        AND pm.resolved_at > ${cutoff}
        AND pm.resolution_notes IS NOT NULL
        -- resolutionNotes is a free-text column. The AMM resolver
        -- writes JSON objects, but pre-AMM and some admin-manual rows
        -- contain plain text (e.g. "Auto-resolution blocked"). Guard
        -- the ::jsonb cast so a single bad row doesn't crash the audit.
        AND pm.resolution_notes ~ '^\\s*\\{'
        AND pm.resolution_notes::jsonb ? 'creditedToHouse'
        AND pm.resolution_notes::jsonb ? 'payoutLiability'
        AND mas.house_seed_amount IS NOT NULL
    )
    SELECT
      id,
      title,
      credited_to_house,
      house_seed_amount,
      total_user_credits_in,
      payout_liability,
      (credited_to_house - house_seed_amount - total_user_credits_in + payout_liability) AS drift
    FROM resolved
    WHERE ABS(
      credited_to_house - house_seed_amount - total_user_credits_in + payout_liability
    ) > 1
    ORDER BY ABS(
      credited_to_house - house_seed_amount - total_user_credits_in + payout_liability
    ) DESC
    LIMIT 50
  `)).rows as unknown as Array<{
    id: string;
    title: string;
    drift: number;
    credited_to_house: number;
    house_seed_amount: number;
    total_user_credits_in: number;
    payout_liability: number;
  }>;
  const count = rows.length;
  record({
    name: `AMM seed-return drift (last ${RESOLUTION_LOOKBACK_DAYS}d)`,
    status: count === 0 ? "pass" : "fail",
    rowCount: count,
    details:
      count === 0
        ? `All RESOLVED AMM markets in the last ${RESOLUTION_LOOKBACK_DAYS} days have seed-return arithmetic within 1 credit.`
        : `Found ${count} market(s) with > 1 credit drift between creditedToHouse and (houseSeed + totalUserCreditsIn - payoutLiability). Investigate before further deploys.`,
    sample: rows.slice(0, 3),
  });
}

// ---------------------------------------------------------------------------
// Check 3: stuck markets (CLOSED_PENDING > 24h)
// ---------------------------------------------------------------------------
async function checkStuckMarkets(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stuck = await db
    .select({
      id: predictionMarkets.id,
      slug: predictionMarkets.slug,
      title: predictionMarkets.title,
      marketType: predictionMarkets.marketType,
      endAt: predictionMarkets.endAt,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "CLOSED_PENDING"),
        lt(predictionMarkets.endAt, cutoff),
      ),
    );
  record({
    name: "Stuck CLOSED_PENDING markets (> 24h)",
    status: stuck.length === 0 ? "pass" : "fail",
    rowCount: stuck.length,
    details:
      stuck.length === 0
        ? "No markets stuck in CLOSED_PENDING for over 24h."
        : `Found ${stuck.length} market(s) that hit endAt > 24h ago but haven't resolved. The cron may be wedged, or these markets need manual resolution.`,
    sample: stuck.slice(0, 5).map((m) => ({
      id: m.id,
      type: m.marketType,
      title: m.title,
      endAt: m.endAt,
    })),
  });
}

// ---------------------------------------------------------------------------
// Check 4: negative profile credits
// ---------------------------------------------------------------------------
async function checkNegativeCredits(): Promise<void> {
  const negs = await db
    .select({
      id: profiles.id,
      username: profiles.username,
      predictCredits: profiles.predictCredits,
    })
    .from(profiles)
    .where(sql`predict_credits < 0`);
  record({
    name: "Profiles with negative predict_credits",
    status: negs.length === 0 ? "pass" : "fail",
    rowCount: negs.length,
    details:
      negs.length === 0
        ? "No profiles in the red."
        : `Found ${negs.length} profile(s) with predict_credits < 0. Likely indicates a missed FOR UPDATE somewhere — every debit path should refuse to drop below 0.`,
    sample: negs.slice(0, 5),
  });
}

// ---------------------------------------------------------------------------
// Check 5: duplicate idempotency keys (last 24h)
// ---------------------------------------------------------------------------
async function checkDuplicateIdemKeys(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = (await db.execute(sql`
    SELECT
      idempotency_key,
      COUNT(*)::int AS attempts,
      array_agg(DISTINCT txn_type) AS txn_types,
      MIN(created_at) AS first,
      MAX(created_at) AS last
    FROM credit_ledger
    WHERE created_at > ${cutoff}
      AND idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
    ORDER BY attempts DESC
    LIMIT 20
  `)).rows as unknown as Array<{
    idempotency_key: string;
    attempts: number;
    txn_types: string[];
    first: Date;
    last: Date;
  }>;
  const count = rows.length;
  // In the happy path the unique constraint should make this impossible
  // (only one row can land), so any rows here likely indicate the
  // constraint isn't actually live, or the data is from before it was
  // applied. Treat as warn rather than fail because it doesn't imply
  // money moved twice.
  record({
    name: "Duplicate idempotency keys (last 24h)",
    status: count === 0 ? "pass" : "warn",
    rowCount: count,
    details:
      count === 0
        ? "No duplicate idempotency_key rows in the last 24h — unique constraint is doing its job."
        : `Found ${count} idempotency key(s) appearing more than once. Investigate whether the unique constraint is active — duplicates should have been blocked.`,
    sample: rows.slice(0, 3),
  });
}

// ---------------------------------------------------------------------------
// Check 6: agent runtime state — pause warning
// ---------------------------------------------------------------------------
async function checkAgentPause(): Promise<void> {
  const [state] = await db
    .select()
    .from(agentRuntimeState)
    .where(eq(agentRuntimeState.id, "global"))
    .limit(1);

  if (!state) {
    record({
      name: "Agent runtime state",
      status: "warn",
      details: "No agent_runtime_state row found. Agents may be unmanaged.",
    });
    return;
  }

  if (!state.paused) {
    record({
      name: "Agent runtime state",
      status: "pass",
      details: `Agents are active (paused=false).`,
    });
    return;
  }

  // Paused. Warn unless there's a clear reason.
  const reason = state.reason ?? "(no reason set)";
  const since = state.pausedAt ? `since ${state.pausedAt.toISOString()}` : "(no pausedAt set)";
  record({
    name: "Agent runtime state",
    status: "warn",
    details: `Agents are PAUSED ${since}. Reason: ${reason}. If this was intentional, ignore. Otherwise resume via Supabase.`,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(bold("\nAMM operational health check"));
  console.log(dim(`lookback=${RESOLUTION_LOOKBACK_DAYS}d  startedAt=${new Date().toISOString()}\n`));

  console.log(cyan(bold("--- Read-only audits ---\n")));

  await checkOrphanLedger();
  await checkSeedReturnDrift();
  await checkStuckMarkets();
  await checkNegativeCredits();
  await checkDuplicateIdemKeys();
  await checkAgentPause();

  // ---------------------------------------------------------------
  // Summary line + exit code
  // ---------------------------------------------------------------
  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;

  console.log(bold("--- Summary ---"));
  console.log(`Total checks: ${checks.length}  ${green(`PASS=${passed}`)}  ${yellow(`WARN=${warned}`)}  ${red(`FAIL=${failed}`)}`);

  if (failed > 0) {
    console.log(red(bold("\n✗ Health check FAILED. Investigate failed checks above.")));
    process.exit(1);
  }
  if (warned > 0) {
    console.log(yellow(bold("\n! Health check passed with warnings. Review above before next deploy.")));
    return;
  }
  console.log(green(bold("\n✓ Health check passed cleanly. AMM stack is healthy.")));
}

// Explicitly exit after main resolves. server/db's pg.Pool holds the
// event loop open for `idleTimeoutMillis` (30s) after the last query,
// so a cron-able script would otherwise hang for ~30s on every run.
// We preserve any exitCode that was set during the run (e.g. via the
// warning path returning early without an exit code).
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(red(`\n[amm-health-check] FAILED: ${err?.message ?? err}`));
    if (err?.stack) console.error(dim(err.stack));
    process.exit(1);
  });
