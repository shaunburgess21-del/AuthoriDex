/**
 * AMM concurrent-buy loadgen.
 *
 * Proves the `SELECT FOR UPDATE` on `market_amm_state` in
 * `server/services/amm-trades.ts` serialises trades correctly under
 * contention. Two test users (alice + bob, from .env.smoke) each fire
 * M buys in parallel against a target market with random entry +
 * random budget. The script measures per-call latency and then asserts:
 *
 *   1. `sum(credit_ledger.amount where txn_type='amm_buy' and metadata.marketId=$1)`
 *      equals `sum(market_bets.stakeAmount where market_id=$1 and ...)`
 *      for the buys we generated this run.
 *   2. All entry marginal prices in `market_amm_state.share_quantities`
 *      via `pricesAll` are in (0, 1) and sum to ≈ 1.
 *   3. No netShares on `market_bets` for our users go negative.
 *
 * Exit code 1 on any invariant failure or HTTP error budget exceeded.
 *
 * Inputs (CLI, all optional except --market-id):
 *   --market-id <id>      target market (required)
 *   --buys-per-user <M>   default 10
 *   --max-credit <B>      max budget per buy, default 20
 *   --concurrency <C>     simultaneous in-flight buys per user, default 4
 *
 * Reads:
 *   .env       (Supabase URL + anon key)
 *   .env.smoke (alice + bob credentials, base URL)
 *
 * Run with:
 *   npx tsx scripts/amm-loadgen.ts --market-id abc123 [--buys-per-user 10]
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../server/db";
import { creditLedger, marketBets, marketAmmState, marketEntries } from "@shared/schema";
import { pricesAll } from "@shared/lib/amm/lmsr";

// ---------------------------------------------------------------------------
// Lightweight .env loader (same as scripts/amm-smoke.ts to avoid a dep).
// ---------------------------------------------------------------------------
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), ".env.smoke"));

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `[amm-loadgen] Missing env var: ${name}. Copy .env.smoke.example to .env.smoke and fill it in.`,
    );
    process.exit(2);
  }
  return value;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

const MARKET_ID = parseArg("--market-id");
if (!MARKET_ID) {
  console.error("[amm-loadgen] Missing required arg: --market-id <marketId>");
  process.exit(2);
}
const BUYS_PER_USER = Number(parseArg("--buys-per-user") ?? "10");
const MAX_CREDIT = Number(parseArg("--max-credit") ?? "20");
const CONCURRENCY = Number(parseArg("--concurrency") ?? "4");

if (!Number.isInteger(BUYS_PER_USER) || BUYS_PER_USER <= 0) {
  console.error("[amm-loadgen] --buys-per-user must be a positive integer");
  process.exit(2);
}
if (!Number.isInteger(MAX_CREDIT) || MAX_CREDIT <= 0) {
  console.error("[amm-loadgen] --max-credit must be a positive integer");
  process.exit(2);
}
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY <= 0) {
  console.error("[amm-loadgen] --concurrency must be a positive integer");
  process.exit(2);
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const BASE_URL = requireEnv("SMOKE_BASE_URL").replace(/\/$/, "");
const ALICE_EMAIL = requireEnv("SMOKE_ALICE_EMAIL");
const ALICE_PASSWORD = requireEnv("SMOKE_ALICE_PASSWORD");
const BOB_EMAIL = requireEnv("SMOKE_BOB_EMAIL");
const BOB_PASSWORD = requireEnv("SMOKE_BOB_PASSWORD");

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function info(label: string, value: unknown): void {
  console.log(
    `    ${dim(label)} ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
  );
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
interface SignedInUser {
  email: string;
  userId: string;
  accessToken: string;
}

async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<SignedInUser> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  }
  return { email, userId: data.user.id, accessToken: data.session.access_token };
}

// ---------------------------------------------------------------------------
// HTTP buy
// ---------------------------------------------------------------------------
interface BuyResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  charge?: number;
  shares?: number;
  body?: any;
  error?: string;
}

async function buy(
  user: SignedInUser,
  marketId: string,
  entryId: string,
  creditBudget: number,
): Promise<BuyResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/markets/${marketId}/buy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({ entryId, creditBudget }),
    });
    const t1 = Date.now();
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep null */
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        latencyMs: t1 - t0,
        error: body?.error ?? body?.message ?? text ?? res.statusText,
        body,
      };
    }
    return {
      ok: true,
      status: res.status,
      latencyMs: t1 - t0,
      charge: body?.chargeCredits ?? 0,
      shares: body?.sharesPurchased ?? 0,
      body,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - t0,
      error: err?.message ?? String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Per-user worker — fires BUYS_PER_USER buys with bounded concurrency
// ---------------------------------------------------------------------------
async function runWorker(
  user: SignedInUser,
  marketId: string,
  entries: Array<{ id: string; label: string }>,
): Promise<BuyResult[]> {
  const results: BuyResult[] = [];
  let nextIdx = 0;

  async function lane(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= BUYS_PER_USER) return;
      const entry = entries[Math.floor(Math.random() * entries.length)];
      const budget = 1 + Math.floor(Math.random() * MAX_CREDIT);
      const r = await buy(user, marketId, entry.id, budget);
      results.push(r);
      if (!r.ok) {
        console.log(
          red(
            `    [${user.email}] buy #${i + 1} FAILED status=${r.status} latency=${r.latencyMs}ms: ${r.error}`,
          ),
        );
      }
    }
  }

  const lanes = Array.from({ length: Math.min(CONCURRENCY, BUYS_PER_USER) }, () => lane());
  await Promise.all(lanes);
  return results;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(bold("\nAMM loadgen — concurrent buy stress test"));
  info("baseUrl", BASE_URL);
  info("marketId", MARKET_ID);
  info("buysPerUser", BUYS_PER_USER);
  info("maxCreditPerBuy", MAX_CREDIT);
  info("concurrencyPerUser", CONCURRENCY);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log(`\n${cyan(bold("[1] Sign in alice + bob"))}`);
  const alice = await signIn(supabase, ALICE_EMAIL, ALICE_PASSWORD);
  const bob = await signIn(supabase, BOB_EMAIL, BOB_PASSWORD);
  info("alice.userId", alice.userId);
  info("bob.userId", bob.userId);

  console.log(`\n${cyan(bold("[2] Discover market entries"))}`);
  const entryRows = await db
    .select({ id: marketEntries.id, label: marketEntries.label })
    .from(marketEntries)
    .where(eq(marketEntries.marketId, MARKET_ID));
  if (entryRows.length < 2) {
    console.error(red(`[amm-loadgen] Market ${MARKET_ID} has ${entryRows.length} entries; need at least 2.`));
    process.exit(1);
  }
  info("entries", entryRows.map((e) => `${e.label} (${e.id.slice(0, 8)})`).join("  "));

  const startedAt = new Date();

  console.log(`\n${cyan(bold(`[3] Fire ${2 * BUYS_PER_USER} buys (${BUYS_PER_USER} per user)`))}`);
  const [aliceResults, bobResults] = await Promise.all([
    runWorker(alice, MARKET_ID, entryRows),
    runWorker(bob, MARKET_ID, entryRows),
  ]);
  const allResults = [...aliceResults, ...bobResults];
  const oks = allResults.filter((r) => r.ok);
  const fails = allResults.filter((r) => !r.ok);
  const totalCharged = oks.reduce((s, r) => s + (r.charge ?? 0), 0);

  const latencies = allResults.map((r) => r.latencyMs);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const max = Math.max(...latencies, 0);

  console.log(`\n${cyan(bold("[4] HTTP results"))}`);
  info("total", allResults.length);
  info("ok", oks.length);
  info("fail", fails.length);
  info("totalChargedCredits", totalCharged);
  info("latency.p50ms", p50);
  info("latency.p95ms", p95);
  info("latency.p99ms", p99);
  info("latency.maxMs", max);

  // ---------------------------------------------------------------
  // Invariant 1: credit_ledger sum matches market_bets sum for buys
  // we generated this run (since `startedAt`).
  // ---------------------------------------------------------------
  console.log(`\n${cyan(bold("[5] Invariant 1: credit_ledger ↔ market_bets sum"))}`);
  const ledgerSumRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(-amount), 0)::text`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.txnType, "amm_buy"),
        gte(creditLedger.createdAt, startedAt),
        sql`metadata->>'marketId' = ${MARKET_ID}`,
      ),
    );
  const ledgerSum = Number(ledgerSumRows[0]?.total ?? "0");

  // market_bets.actionType is 'buy' for AMM buys (the parimutuel sunset
  // collapsed the legacy 'parimutuel' value; jackpot writes go through
  // a different code path so they don't pollute this filter). credit_
  // ledger.txnType is what carries the 'amm_buy' label.
  const betsSumRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(stake_amount), 0)::text`,
    })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.marketId, MARKET_ID),
        eq(marketBets.actionType, "buy"),
        gte(marketBets.createdAt, startedAt),
      ),
    );
  const betsSum = Number(betsSumRows[0]?.total ?? "0");

  info("creditLedger.sumAmmBuy", ledgerSum);
  info("marketBets.sumStakeAmmBuy", betsSum);
  let invariantFails = 0;
  if (ledgerSum !== betsSum) {
    console.log(red(`    ✗ ledger/bets sum drift: ${ledgerSum} vs ${betsSum}`));
    invariantFails++;
  } else {
    console.log(green(`    ✓ ledger == bets (${ledgerSum} credits)`));
  }
  if (Math.abs(totalCharged - ledgerSum) > 1) {
    console.log(
      yellow(
        `    ! HTTP-reported charge (${totalCharged}) differs from ledger (${ledgerSum}) by >1 — investigate.`,
      ),
    );
  }

  // ---------------------------------------------------------------
  // Invariant 2: marginal prices via pricesAll are in (0,1) and ≈ 1
  // ---------------------------------------------------------------
  console.log(`\n${cyan(bold("[6] Invariant 2: AMM state price sanity"))}`);
  const [state] = await db
    .select({
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(eq(marketAmmState.marketId, MARKET_ID))
    .limit(1);

  if (!state) {
    console.log(red(`    ✗ No market_amm_state row for ${MARKET_ID}.`));
    invariantFails++;
  } else {
    const shares = state.shareQuantities as Record<string, number>;
    const order = state.outcomeOrder;
    const qVec = order.map((entryId) => Number(shares[entryId] ?? 0));
    if (qVec.some((q) => !Number.isFinite(q))) {
      console.log(red(`    ✗ Non-finite share quantity in state: ${JSON.stringify(shares)}`));
      invariantFails++;
    } else {
      const prices = pricesAll(qVec, Number(state.liquidityB));
      const sum = prices.reduce((s, p) => s + p, 0);
      info("prices", prices.map((p) => p.toFixed(4)));
      info("sum", sum.toFixed(6));
      const allInRange = prices.every((p) => p > 0 && p < 1);
      const sumNearOne = Math.abs(sum - 1) < 1e-6;
      if (!allInRange) {
        console.log(red(`    ✗ Price out of (0,1) range: ${prices.join(", ")}`));
        invariantFails++;
      }
      if (!sumNearOne) {
        console.log(red(`    ✗ Prices do not sum to ~1: sum=${sum}`));
        invariantFails++;
      }
      if (allInRange && sumNearOne) {
        console.log(green(`    ✓ Prices in (0,1) and sum ≈ 1`));
      }
    }
  }

  // ---------------------------------------------------------------
  // Invariant 3: no negative netShares for the bets we wrote this run
  // ---------------------------------------------------------------
  console.log(`\n${cyan(bold("[7] Invariant 3: no negative shareQuantity in bets"))}`);
  const negBets = await db
    .select({
      id: marketBets.id,
      userId: marketBets.userId,
      shareQuantity: marketBets.shareQuantity,
      actionType: marketBets.actionType,
    })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.marketId, MARKET_ID),
        gte(marketBets.createdAt, startedAt),
        sql`share_quantity < 0`,
      ),
    );
  if (negBets.length > 0) {
    console.log(
      red(
        `    ✗ ${negBets.length} bet(s) with negative shareQuantity: ${JSON.stringify(negBets.slice(0, 3))}...`,
      ),
    );
    invariantFails++;
  } else {
    console.log(green(`    ✓ No negative shareQuantity on the buys we generated.`));
  }

  // ---------------------------------------------------------------
  // Final verdict
  // ---------------------------------------------------------------
  console.log("");
  if (fails.length > 0) {
    const expectedErr = (s: string | undefined) =>
      !!s &&
      (s.includes("Insufficient") || s.includes("insufficient") || s.includes("closed") || s.includes("rate"));
    const unexpected = fails.filter((f) => !expectedErr(f.error));
    if (unexpected.length > 0) {
      console.log(red(bold(`✗ ${unexpected.length} unexpected HTTP failure(s) (out of ${fails.length} total).`)));
      console.log(red(unexpected.slice(0, 5).map((f) => `    ${f.status}: ${f.error}`).join("\n")));
      process.exitCode = 1;
    } else {
      console.log(
        yellow(
          `! ${fails.length} expected/benign failure(s) (insufficient credits, market closed, rate limit). Treating as soft pass.`,
        ),
      );
    }
  }
  if (invariantFails > 0) {
    console.log(red(bold(`✗ ${invariantFails} invariant failure(s) — investigate before launch.`)));
    process.exitCode = 1;
    return;
  }
  console.log(green(bold(`✓ Loadgen passed: ${oks.length}/${allResults.length} buys ok, p95=${p95}ms, all invariants hold.`)));
}

// Explicitly exit after main resolves. server/db's pg.Pool holds the
// event loop open for `idleTimeoutMillis` (30s) after the last query,
// so the loadgen run would otherwise hang for ~30s after printing the
// final verdict. Preserves any `process.exitCode` set during the run
// (invariant failures + unexpected HTTP errors).
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(red(`\n[amm-loadgen] FAILED: ${err?.message ?? err}`));
    if (err?.stack) console.error(dim(err.stack));
    process.exit(1);
  });
