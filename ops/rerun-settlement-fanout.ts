/**
 * Re-run the post-settlement fanout for an already-RESOLVED AMM market.
 *
 * `resolveAmmMarket` commits settlement in a transaction, then `void`s a
 * fanout: per-bettor notifications, win XP, badge checks, profile stat sync,
 * agent Brier scoring and the AI resolution summary. Because that fanout is
 * fire-and-forget, a caller that exits (or closes the pool) straight after
 * settling loses it — the market is correctly settled and paid out, but the
 * derived state around it never lands. Re-settling does not help: the resolver
 * short-circuits an already-resolved market with `idempotentSkip` and skips the
 * fanout with it. This script fills that gap.
 *
 * It re-runs the steps individually rather than calling the resolver's private
 * fanout, for two reasons: each step can be gated and reported on its own, and
 * nothing in the money path needs touching.
 *
 * Idempotency, step by step:
 *   - `awardPredictionWinXp`      keyed on (marketId, userId) — safe to repeat.
 *   - `checkAndAwardPredictionWinBadges` re-checks thresholds — safe to repeat.
 *   - `syncProfilePredictionStats` full recompute from market_bets — safe.
 *   - `generateResolutionSummary`  returns early if the column is populated.
 *   - `scoreResolvedMarket`        *** NOT IDEMPOTENT ***. It increments
 *     total_entered / total_resolved / correct on the agent's period row, so
 *     running it twice double-counts that market in every agent's Brier and
 *     accuracy. It is therefore opt-in via --with-agent-scoring, and only
 *     correct when you have positive evidence the original fanout never
 *     reached its scoring loop (a "[AgentPerformance] Failed to score market"
 *     line, or an empty scored count, in the settling run's log).
 *
 * Notifications are intentionally NOT re-emitted. They carry their own
 * idempotency keys so a repeat is harmless, but agents are suppressed at
 * creation and the human-visible pings either landed at settlement or belong
 * to a moment that has passed; re-firing them days later is worse than the
 * gap. Verify with the query this script prints instead.
 *
 * Run:
 *   npx tsx --env-file=.env ops/rerun-settlement-fanout.ts --dry-run
 *   npx tsx --env-file=.env ops/rerun-settlement-fanout.ts --apply --with-agent-scoring
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY_RUN = !APPLY;
const WITH_AGENT_SCORING = args.includes("--with-agent-scoring");

/** Nested fire-and-forget calls inside the steps below need a drain too. */
const DRAIN_MS = 15_000;

interface Target {
  marketId: string;
  titleContains: string;
}

const TARGETS: Target[] = [
  {
    // Settled 2026-09-01 by ops/settle-self-created-world-market.ts, which
    // closed the pool before the fanout could run. Payouts and the ledger
    // committed correctly; XP, badges, profile stats, agent scoring and the
    // summary were all lost. The settling log shows agent scoring failed on
    // the query that loads agent bets, before its upsert loop, so
    // --with-agent-scoring cannot double-count here.
    marketId: "e5e094db-a53f-4c3a-8445-54082ac1ed69",
    titleContains: "Will Bitcoin hit $100,000",
  },
];

async function main(): Promise<void> {
  console.log(`\n[rerun-settlement-fanout] ${DRY_RUN ? "DRY RUN" : "APPLY"}`);
  console.log(`  agent scoring: ${WITH_AGENT_SCORING ? "ENABLED" : "skipped (pass --with-agent-scoring)"}`);

  const { db, pool } = await import("../server/db");
  const { predictionMarkets, marketBets, marketEntries } = await import(
    "../shared/schema"
  );
  const { eq, and, inArray } = await import("drizzle-orm");
  const { gamificationService } = await import("../server/services/gamification");
  const { checkAndAwardPredictionWinBadges } = await import("../server/services/badges");
  const { syncProfilePredictionStats } = await import(
    "../server/services/profile-prediction-stats"
  );
  const { scoreResolvedMarket } = await import("../server/agents/performanceUpdater");
  const { generateResolutionSummary } = await import("../server/jobs/market-resolver");

  let touched = 0;

  for (const target of TARGETS) {
    console.log(`\n── ${target.titleContains} (${target.marketId.slice(0, 8)}) ──`);

    const [market] = await db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        status: predictionMarkets.status,
        engine: predictionMarkets.engine,
        resolutionSummary: predictionMarkets.resolutionSummary,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, target.marketId))
      .limit(1);

    if (!market) {
      console.log("  ! not found — skipping");
      continue;
    }
    if (!market.title?.includes(target.titleContains)) {
      console.log(`  ! title mismatch ("${market.title}") — skipping`);
      continue;
    }
    if (market.status !== "RESOLVED") {
      console.log(`  ! status is ${market.status}, expected RESOLVED — skipping`);
      continue;
    }
    if (market.engine !== "amm") {
      console.log(`  ! engine is ${market.engine}, expected amm — skipping`);
      continue;
    }

    const [winnerEntry] = await db
      .select({ id: marketEntries.id, label: marketEntries.label })
      .from(marketEntries)
      .where(
        and(
          eq(marketEntries.marketId, target.marketId),
          eq(marketEntries.resolutionStatus, "winner"),
        ),
      )
      .limit(1);

    if (!winnerEntry) {
      console.log("  ! no entry marked winner — skipping");
      continue;
    }

    // Every settled buy row, matching the resolver's own fanout selection.
    const settledBuys = await db
      .select({
        userId: marketBets.userId,
        status: marketBets.status,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.marketId, target.marketId),
          eq(marketBets.actionType, "buy"),
          inArray(marketBets.status, ["won", "lost"]),
        ),
      );

    const allUserIds = new Set(settledBuys.map((b) => b.userId));
    const winnerIds = new Set(
      settledBuys.filter((b) => b.status === "won").map((b) => b.userId),
    );

    console.log(`  winner     ${winnerEntry.label} (${winnerEntry.id.slice(0, 8)})`);
    console.log(`  users      ${allUserIds.size} settled (${winnerIds.size} winners)`);
    console.log(`  summary    ${market.resolutionSummary ? "present — will skip" : "missing — will generate"}`);

    if (DRY_RUN) {
      console.log("  · dry run — no changes written");
      continue;
    }

    let xpOk = 0;
    let badgeOk = 0;
    for (const userId of winnerIds) {
      try {
        await gamificationService.awardPredictionWinXp(userId, target.marketId);
        xpOk += 1;
      } catch (err) {
        console.log(`  ! XP failed for ${userId}: ${(err as Error)?.message ?? err}`);
      }
      try {
        await checkAndAwardPredictionWinBadges(userId);
        badgeOk += 1;
      } catch (err) {
        console.log(`  ! badges failed for ${userId}: ${(err as Error)?.message ?? err}`);
      }
    }
    console.log(`  ✔ XP awarded ${xpOk}/${winnerIds.size}, badge checks ${badgeOk}/${winnerIds.size}`);

    let statsOk = 0;
    for (const userId of allUserIds) {
      try {
        await syncProfilePredictionStats(userId);
        statsOk += 1;
      } catch (err) {
        console.log(`  ! stat sync failed for ${userId}: ${(err as Error)?.message ?? err}`);
      }
    }
    console.log(`  ✔ profile stats synced ${statsOk}/${allUserIds.size}`);

    if (WITH_AGENT_SCORING) {
      try {
        const scored = await scoreResolvedMarket(target.marketId, winnerEntry.id);
        console.log(
          `  ✔ agent scoring: ${scored.scored}/${scored.total} bets` +
            (scored.failed ? ` (${scored.failed} failed)` : ""),
        );
      } catch (err) {
        console.log(`  ! agent scoring failed: ${(err as Error)?.message ?? err}`);
      }
    } else {
      console.log("  · agent scoring skipped");
    }

    try {
      await generateResolutionSummary(target.marketId);
      const [after] = await db
        .select({ summary: predictionMarkets.resolutionSummary })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, target.marketId))
        .limit(1);
      console.log(
        after?.summary
          ? `  ✔ summary: ${after.summary}`
          : "  · summary still empty (no OpenAI key, or generation declined)",
      );
    } catch (err) {
      console.log(`  ! summary failed: ${(err as Error)?.message ?? err}`);
    }

    touched += 1;
  }

  if (touched > 0) {
    console.log(`\n  · draining nested fire-and-forget work for ${DRAIN_MS / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
  }

  console.log(`\n[rerun-settlement-fanout] repaired ${touched} market(s)`);
  await pool.end();
}

main().catch((err) => {
  console.error("[rerun-settlement-fanout] failed:", err);
  process.exit(1);
});
