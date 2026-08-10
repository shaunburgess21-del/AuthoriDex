/**
 * Read-only rehearsal of next Monday's H2H opening prices.
 *
 * Runs the real generation path — the same eligibility filter, the same
 * top-4-per-category pairing, the same `loadOpeningScoreMap` — against the
 * live roster, then prints what `pickH2HOpeningPrices` would seed each
 * market at. Writes nothing.
 *
 * The point is to see the bucket spread and the seed budget BEFORE the
 * Monday 00:05 UTC cron does it for real, and to catch the failure modes
 * that only show up against live data: pairs with no opening snapshot
 * (which silently fall back to 50/50) and an unexpectedly lopsided
 * distribution of gaps.
 *
 * Usage:
 *   npm run h2h:preview
 *
 * Note the flag is deliberately ignored here — the preview always shows
 * what the prior WOULD do, so it is useful both before and after
 * `H2H_OPENING_PRIOR_ENABLED` is set.
 */

import { desc } from "drizzle-orm";
import { db } from "../server/db";
import { trendingPeople } from "@shared/schema";
import {
  applyWeeklyNativeMarketEligibility,
  buildTop4PerCategoryPairings,
} from "../server/jobs/market-generator";
import { loadOpeningScoreMap } from "../server/native-markets/openingScores";
import { getWeekContext } from "../server/native-markets/week-context";
import { pickH2HOpeningPrices } from "../server/native-markets/h2h-opening-prices";
import { getTargetMaxLoss } from "../server/config/amm";
import { pickSeedState } from "../server/services/amm-house";

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}
function padLeft(s: string | number, n: number): string {
  return String(s).padStart(n);
}

async function main() {
  // The generator keys off the CURRENT week's Monday. To rehearse the next
  // run we advance a week, which is also what the opening-score lookup
  // should be anchored to.
  const { monday: thisMonday, weekNumber } = getWeekContext();
  const nextMonday = new Date(thisMonday.getTime() + 7 * 24 * 3600 * 1000);
  const nextWeek = weekNumber + 1;

  console.log(
    `\nH2H opening-price preview for week ${nextWeek} ` +
      `(generation anchor ${nextMonday.toISOString()})\n`,
  );
  console.log(
    `Opening scores are read as of TODAY, so Monday's actual scores will ` +
      `differ — treat the bucket spread as indicative, not exact.\n`,
  );

  const allPeopleRaw = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
      category: trendingPeople.category,
      secondaryCategories: trendingPeople.secondaryCategories,
      fameIndex: trendingPeople.fameIndex,
    })
    .from(trendingPeople)
    .orderBy(desc(trendingPeople.fameIndex), trendingPeople.id);

  // Eligibility needs >= 24 official snapshots in the 7 days BEFORE its
  // anchor. Anchoring to nextMonday would put most of that window in the
  // future and exclude the entire roster, so anchor to now — the faithful
  // analogue of what Monday 00:05 will see.
  const allPeople = await applyWeeklyNativeMarketEligibility(
    allPeopleRaw,
    new Date(),
    "H2H:preview",
  );
  if (allPeople.length < 2) {
    console.log("Not enough eligible people to pair. Nothing to preview.");
    return;
  }

  const pairings = buildTop4PerCategoryPairings(
    allPeople.map((p) => ({ ...p, secondaryCategories: p.secondaryCategories ?? [] })),
  );
  const personIds = Array.from(new Set(pairings.flatMap(([a, b]) => [a.id, b.id])));
  // `asOf` intentionally uses today rather than nextMonday: snapshots for
  // next week do not exist yet, and cohortGuard mirrors the generator.
  const snapMap = await loadOpeningScoreMap(personIds, db, {
    asOf: new Date(),
    cohortGuard: true,
  });

  const uniformTml = getTargetMaxLoss("h2h");
  const uniformSeed = pickSeedState(["a", "b"], "h2h");

  console.log(
    pad("matchup", 46) +
      padLeft("gap%", 8) +
      padLeft("bucket", 10) +
      padLeft("fav", 6) +
      padLeft("b", 8) +
      padLeft("seed", 8),
  );
  console.log("-".repeat(86));

  const bucketCounts = new Map<string, number>();
  let totalSeed = 0;
  let missingSnapshot = 0;
  let maxTargetMaxLoss = uniformTml;

  for (const [personA, personB] of pairings) {
    const scoreA = snapMap.get(personA.id)?.score ?? null;
    const scoreB = snapMap.get(personB.id)?.score ?? null;
    const decision = pickH2HOpeningPrices({ scoreA, scoreB });

    const label = `${personA.name} vs ${personB.name}`.slice(0, 45);

    if (!decision) {
      const reason =
        scoreA == null || scoreB == null ? "no-snapshot" : "sub-2%-gap";
      if (scoreA == null || scoreB == null) missingSnapshot++;
      bucketCounts.set(reason, (bucketCounts.get(reason) ?? 0) + 1);
      totalSeed += uniformSeed.houseSeedAmount;
      console.log(
        pad(label, 46) +
          padLeft("—", 8) +
          padLeft(reason, 10) +
          padLeft("50/50", 6) +
          padLeft(Math.round(uniformSeed.liquidityB), 8) +
          padLeft(uniformSeed.houseSeedAmount, 8),
      );
      continue;
    }

    const seed = pickSeedState(["a", "b"], "h2h", decision.targetMaxLoss, decision.prices);
    totalSeed += seed.houseSeedAmount;
    maxTargetMaxLoss = Math.max(maxTargetMaxLoss, decision.targetMaxLoss);
    bucketCounts.set(decision.bucket, (bucketCounts.get(decision.bucket) ?? 0) + 1);

    console.log(
      pad(label, 46) +
        padLeft(decision.gapPct.toFixed(1), 8) +
        padLeft(decision.bucket, 10) +
        padLeft(decision.favouritePrice.toFixed(2), 6) +
        padLeft(Math.round(seed.liquidityB), 8) +
        padLeft(seed.houseSeedAmount, 8),
    );
  }

  console.log("-".repeat(86));
  console.log(`\nMarkets: ${pairings.length}`);
  console.log("Bucket spread:");
  for (const [bucket, count] of Array.from(bucketCounts.entries()).sort()) {
    console.log(`  ${pad(bucket, 14)} ${count}`);
  }

  const baselineSeed = pairings.length * uniformSeed.houseSeedAmount;
  console.log(
    `\nHouse seed: ${totalSeed} credits vs ${baselineSeed} at the old uniform seed ` +
      `(+${totalSeed - baselineSeed}, ${((totalSeed / baselineSeed - 1) * 100).toFixed(0)}%)`,
  );
  console.log(
    `Worst-case loss per market: ${uniformTml} before, up to ${maxTargetMaxLoss} now.`,
  );
  if (missingSnapshot > 0) {
    console.log(
      `\nWARNING: ${missingSnapshot} pairing(s) had no opening snapshot and would ` +
        `fall back to 50/50. Expected to be rare — investigate if this is more than 1-2.`,
    );
  }
  // Depth is the invariant worth asserting loudly: if any b drifts from the
  // uniform value, the targetMaxLoss scaling is not doing its job.
  console.log(
    `\nUniform b for reference: ${Math.round(uniformSeed.liquidityB)} — every row above ` +
      `should match it, otherwise depth preservation is broken.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
