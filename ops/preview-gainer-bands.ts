/**
 * Read-only rehearsal of next Monday's Gainer opening-score bands.
 *
 * Runs the real eligibility + movement-stats path against the live roster,
 * then prints — per category — eligible count, best pool at each tier,
 * whether banding would apply, and the resulting five-person field.
 * Writes nothing.
 *
 * The flag is deliberately ignored: the preview always uses forceBand so
 * it is useful both before and after GAINER_BAND_SELECTION_ENABLED is set.
 *
 * Usage:
 *   npm run gainer:preview
 */

import { desc } from "drizzle-orm";
import {
  GAINER_BAND_TIERS,
  GAINER_MIN_ELIGIBLE,
  normalizeMarketCategory,
} from "@shared/constants";
import { db } from "../server/db";
import { trendingPeople } from "@shared/schema";
import { applyWeeklyNativeMarketEligibility } from "../server/jobs/market-generator";
import { loadGainerMovementStats } from "../server/jobs/gainer-movement-stats";
import {
  filterGainerEligible,
  findGainerBandPoolsForTier,
  selectGainerField,
  type GainerSelectionInput,
} from "../server/jobs/gainer-selection";
import { loadOpeningScoreMap } from "../server/native-markets/openingScores";
import { getWeekContext } from "../server/native-markets/week-context";

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}
function padLeft(s: string | number, n: number): string {
  return String(s).padStart(n);
}

async function main() {
  const { monday: thisMonday, weekNumber } = getWeekContext();
  const nextMonday = new Date(thisMonday.getTime() + 7 * 24 * 3600 * 1000);
  const nextWeek = weekNumber + 1;

  console.log(
    `\nGainer band-selection preview for week ${nextWeek} ` +
      `(generation would run ${nextMonday.toISOString()})\n`,
  );
  console.log(
    `Opening scores + movement stats are as of TODAY — Monday's actual ` +
      `cohort will differ. Treat this as indicative.\n`,
  );

  const allPeopleRaw = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
      category: trendingPeople.category,
      fameIndex: trendingPeople.fameIndex,
    })
    .from(trendingPeople)
    .orderBy(desc(trendingPeople.fameIndex), trendingPeople.id);

  // Same as H2H preview: eligibility window is the 7 days BEFORE the
  // anchor, so a future Monday would exclude everyone. Anchor to now.
  const people = await applyWeeklyNativeMarketEligibility(
    allPeopleRaw,
    new Date(),
    "Gainer:preview",
  );

  const byCategory = new Map<string, typeof people>();
  for (const person of people) {
    const cat = normalizeMarketCategory(person.category || "misc");
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(person);
  }

  const allIds = people.map((p) => p.id);
  const asOf = new Date();
  const snapMap = await loadOpeningScoreMap(allIds, db, {
    asOf,
    cohortGuard: true,
  });
  const movementMap = await loadGainerMovementStats(allIds, db, { asOf });
  const scoreMap = new Map(people.map((p) => [p.id, p.fameIndex ?? 0]));
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  console.log(
    pad("category", 22) +
      padLeft("elig", 6) +
      padLeft("t0@1.5", 8) +
      padLeft("t1@1.75", 9) +
      padLeft("t2@2.0", 8) +
      padLeft("band", 8) +
      padLeft("poolR", 8) +
      padLeft("fieldR", 8) +
      "  field",
  );
  console.log("-".repeat(118));

  let banded = 0;
  let fallback = 0;
  let skipped = 0;

  const sortedCats = Array.from(byCategory.keys()).sort();
  for (const cat of sortedCats) {
    const catPeople = byCategory.get(cat)!;
    const input: GainerSelectionInput = {
      people: catPeople.map((p) => ({ id: p.id })),
      fameById: scoreMap,
      openingById: snapMap,
      movementById: movementMap,
      weekNumber: nextWeek,
      category: cat,
    };

    const eligible = filterGainerEligible(input);
    const bestPerTier = GAINER_BAND_TIERS.map((tier, tierIndex) => {
      const pools = findGainerBandPoolsForTier(
        eligible,
        snapMap,
        tierIndex,
        tier.maxRatio,
        tier.minPool,
      );
      if (pools.length === 0) return 0;
      return Math.max(...pools.map((p) => p.personIds.length));
    });

    const selection = selectGainerField(input, { forceBand: true });
    if (!selection.ok) {
      skipped++;
      console.log(
        pad(cat, 22) +
          padLeft(eligible.length, 6) +
          padLeft(bestPerTier[0] ?? 0, 8) +
          padLeft(bestPerTier[1] ?? 0, 9) +
          padLeft(bestPerTier[2] ?? 0, 8) +
          padLeft("skip", 8) +
          padLeft("—", 8) +
          padLeft("—", 8) +
          `  (need ≥${GAINER_MIN_ELIGIBLE} eligible)`,
      );
      continue;
    }

    if (selection.bandApplied) banded++;
    else fallback++;

    const fieldNames = selection.personIds
      .map((id) => {
        const name = nameById.get(id) ?? id.slice(0, 8);
        return id === selection.anchorId ? `${name}*` : name;
      })
      .join(", ");

    console.log(
      pad(cat, 22) +
        padLeft(eligible.length, 6) +
        padLeft(bestPerTier[0] ?? 0, 8) +
        padLeft(bestPerTier[1] ?? 0, 9) +
        padLeft(bestPerTier[2] ?? 0, 8) +
        padLeft(
          selection.bandApplied ? `tier${selection.bandTier}` : "off",
          8,
        ) +
        padLeft(
          selection.bandRatio != null ? selection.bandRatio.toFixed(2) : "—",
          8,
        ) +
        padLeft(
          selection.fieldRatio != null ? selection.fieldRatio.toFixed(2) : "—",
          8,
        ) +
        `  ${fieldNames}`,
    );
  }

  console.log("-".repeat(118));
  console.log(
    `\nCategories: ${sortedCats.length} · banded ${banded} · fallback ${fallback} · skipped ${skipped}`,
  );
  console.log(
    `Tiers: ${GAINER_BAND_TIERS.map((t, i) => `t${i}=≤${t.maxRatio}x/≥${t.minPool}`).join(" · ")}`,
  );
  console.log(
    `* = in-band fame anchor. Band=off means no tier qualified; field uses whole-category selection.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
