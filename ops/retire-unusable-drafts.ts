/**
 * Retire drafts whose source prices can no longer produce a fair market.
 *
 * These were imported before the scout gained a liquidity floor and a
 * source-book ceiling, and their books have since decayed. Publishing one
 * seeds an AMM off numbers that are not probabilities.
 *
 * Two rules, both meaning "the importer would refuse this today":
 *
 *   1. bookSum >= UNUSABLE_BOOK_SUM. On an illiquid book Gamma reports the
 *      midpoint of a very wide spread, so a 37-candidate Oscars field sums to
 *      14.5. The relative values are noise, not just the total — normalising
 *      cannot recover an ordering that was never there. Deliberately well
 *      above the importer's 1.15 ceiling: a book at 1.2 is ordinary overround
 *      and still tradeable, so those stay in the queue with a badge for the
 *      operator to judge.
 *
 *   2. bookSum <= DEAD_BOOK_SUM with no catch-all. Every listed outcome is
 *      priced at ~0 and nothing absorbs the remainder, so no outcome can win
 *      and the market could only ever be voided.
 *
 * Retirement matches the resolver's expired-draft path: VOID + archived, row
 * retained so metadata.source.externalId keeps blocking a re-import. Skips
 * anything with an AMM seed or bets.
 *
 * Run:
 *   npx tsx --env-file=.env ops/retire-unusable-drafts.ts --dry-run
 *   npx tsx --env-file=.env ops/retire-unusable-drafts.ts --apply
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

/** Above this the source prices carry no usable information. */
const UNUSABLE_BOOK_SUM = 2.0;
/** At or below this every listed outcome is priced at essentially zero. */
const DEAD_BOOK_SUM = 0.3;
/** Refuse to run if the selection is implausibly large. */
const MAX_RETIREMENTS = 25;

const ADMIN_ID = "035adc7b-6087-421e-b635-b6b9ad2c8cd2"; // Randy_Andy

async function main(): Promise<void> {
  console.log(`\n[retire-unusable-drafts] ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  const { db, pool } = await import("../server/db");
  const { predictionMarkets, marketEntries, marketAmmState, marketBets, adminAuditLog } =
    await import("../shared/schema");
  const { and, eq } = await import("drizzle-orm");
  const { isOtherStyleOutcomeLabel } = await import("../shared/lib/other-outcome");

  const drafts = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      endAt: predictionMarkets.endAt,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.visibility, "draft"),
        eq(predictionMarkets.status, "OPEN"),
      ),
    );

  const targets: Array<{ id: string; title: string; sum: number; reason: string }> = [];

  for (const d of drafts) {
    const meta =
      d.metadata && typeof d.metadata === "object"
        ? (d.metadata as Record<string, unknown>)
        : {};
    const health = meta.draftHealth as { bookSum?: number | null } | undefined;
    const sum = typeof health?.bookSum === "number" ? health.bookSum : null;
    if (sum === null) continue;

    if (sum >= UNUSABLE_BOOK_SUM) {
      targets.push({
        id: d.id,
        title: d.title ?? "",
        sum,
        reason: "Source odds unusable at review",
      });
      continue;
    }

    if (sum <= DEAD_BOOK_SUM) {
      const entries = await db
        .select({ label: marketEntries.label })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, d.id));
      const hasCatchAll = entries.some((e) => isOtherStyleOutcomeLabel(e.label ?? ""));
      if (!hasCatchAll) {
        targets.push({
          id: d.id,
          title: d.title ?? "",
          sum,
          reason: "No listed outcome can win and no catch-all",
        });
      }
    }
  }

  if (targets.length > MAX_RETIREMENTS) {
    console.error(
      `  ! ${targets.length} targets exceeds MAX_RETIREMENTS=${MAX_RETIREMENTS} — refusing. ` +
        `Check the draft health sweep before re-running.`,
    );
    await pool.end();
    process.exit(1);
  }

  let retired = 0;
  let skipped = 0;

  for (const t of targets) {
    const [ammRow] = await db
      .select({ marketId: marketAmmState.marketId })
      .from(marketAmmState)
      .where(eq(marketAmmState.marketId, t.id))
      .limit(1);
    const [betRow] = await db
      .select({ id: marketBets.id })
      .from(marketBets)
      .where(eq(marketBets.marketId, t.id))
      .limit(1);
    if (ammRow || betRow) {
      console.log(`\n  SKIP (has financial state) ${t.title}`);
      skipped += 1;
      continue;
    }

    console.log(`\n  ${t.title}`);
    console.log(`    ${t.id.slice(0, 8)}  book=${t.sum.toFixed(3)}  ${t.reason}`);
    retired += 1;

    if (DRY_RUN) continue;

    await db
      .update(predictionMarkets)
      .set({
        status: "VOID",
        visibility: "archived",
        resolveMethod: "auto",
        voidReason: t.reason,
        resolutionNotes: JSON.stringify({
          type: "community",
          pendingReason: "draft_source_odds_unusable",
          bookSum: t.sum,
        }),
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, t.id));

    await db.insert(adminAuditLog).values({
      adminId: ADMIN_ID,
      adminEmail: null,
      actionType: "retire_unusable_draft",
      targetTable: "prediction_markets",
      targetId: t.id,
      previousData: { visibility: "draft", status: "OPEN" },
      newData: { visibility: "archived", status: "VOID", bookSum: t.sum },
      metadata: { reason: t.reason, script: "ops/retire-unusable-drafts.ts" },
    });
  }

  console.log(
    `\n[retire-unusable-drafts] ${DRY_RUN ? "would retire" : "retired"}=${retired} skipped=${skipped}\n`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("[retire-unusable-drafts] failed:", err);
  process.exit(1);
});
