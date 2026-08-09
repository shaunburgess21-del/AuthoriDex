/**
 * Reorder numeric bracket / threshold outcome legs into numeric order.
 *
 * The scout used to sort every multi-outcome field by price descending. That
 * is right for "who will win" fields but scrambles a number line, so bracket
 * markets imported reading:
 *
 *   Under $4M | $4M-$10M | $15M-$50M | $10M-$15M | Over $50M
 *
 * New imports are ordered correctly by orderOutcomesForDisplay. This repairs
 * the rows created before that.
 *
 * Only touches markets where EVERY named leg parses to a distinct magnitude,
 * so name fields keep their favourite-first ordering. Skips anything with
 * bets: display order is cosmetic, but moving options under a user who has
 * already traded them is not worth the confusion.
 *
 * Run:
 *   npx tsx --env-file=.env ops/repair-outcome-display-order.ts --dry-run
 *   npx tsx --env-file=.env ops/repair-outcome-display-order.ts --apply
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

async function main(): Promise<void> {
  console.log(`\n[repair-outcome-display-order] ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  const { db, pool } = await import("../server/db");
  const { predictionMarkets, marketEntries, marketBets } = await import(
    "../shared/schema"
  );
  const { and, eq, inArray, sql } = await import("drizzle-orm");
  const { parseOutcomeMagnitude } = await import("../shared/lib/outcome-ordering");
  const { isOtherStyleOutcomeLabel } = await import("../shared/lib/other-outcome");

  const markets = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      visibility: predictionMarkets.visibility,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.openMarketType, "multi"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
      ),
    );

  let repaired = 0;
  let skipped = 0;

  for (const m of markets) {
    const entries = await db
      .select({
        id: marketEntries.id,
        label: marketEntries.label,
        order: marketEntries.displayOrder,
      })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, m.id))
      .orderBy(marketEntries.displayOrder);

    const named = entries.filter((e) => !isOtherStyleOutcomeLabel(e.label ?? ""));
    const catchAlls = entries.filter((e) => isOtherStyleOutcomeLabel(e.label ?? ""));
    if (named.length < 2) continue;

    const mags = named.map((e) => parseOutcomeMagnitude(e.label));
    if (!mags.every((v): v is number => v !== null)) continue;
    if (new Set(mags).size !== mags.length) continue;

    const sorted = [...named].sort(
      (a, b) =>
        (parseOutcomeMagnitude(a.label) ?? 0) - (parseOutcomeMagnitude(b.label) ?? 0),
    );
    const desired = [...sorted, ...catchAlls];
    const unchanged = desired.every((e, i) => e.id === entries[i]?.id);
    if (unchanged) continue;

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(marketBets)
      .where(eq(marketBets.marketId, m.id));
    if (n > 0) {
      console.log(`\n  SKIP (${n} bets) ${m.title}`);
      skipped += 1;
      continue;
    }

    console.log(`\n  ${m.title} [${m.visibility}]`);
    console.log(`    before: ${entries.map((e) => e.label).join(" | ")}`);
    console.log(`    after : ${desired.map((e) => e.label).join(" | ")}`);
    repaired += 1;

    if (DRY_RUN) continue;

    for (let i = 0; i < desired.length; i++) {
      await db
        .update(marketEntries)
        .set({ displayOrder: i })
        .where(eq(marketEntries.id, desired[i].id));
    }
  }

  console.log(
    `\n[repair-outcome-display-order] ${DRY_RUN ? "would repair" : "repaired"}=${repaired} skippedWithBets=${skipped}\n`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("[repair-outcome-display-order] failed:", err);
  process.exit(1);
});
