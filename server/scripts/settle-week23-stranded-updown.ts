/**
 * One-off ops script for week 23 stranded Up/Down markets (Jun 2026).
 *
 * Group A (demoted mid-week, no close ingest): void + refund.
 * Group B (promoted mid-week, missing open metadata): resolve Down using
 * first post-creation snapshot as open baseline.
 *
 * Default = dry run. Pass --apply to execute.
 *
 *   npm run settle:week23-updown
 *   npm run settle:week23-updown -- --apply
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { predictionMarkets, trackedPeople } from "@shared/schema";
import { voidOpenNativeMarketsForPerson } from "../services/roster-market-safeguards";
import { resolveUpDownMarket } from "../jobs/market-resolver";

const WEEK_NUMBER = 23;

const GROUP_A_NAMES = [
  "Pokimane",
  "PewDiePie",
  "Andrew Huberman",
  "Pony Ma",
  "Daniil Medvedev",
  "Reed Hastings",
  "Brian Armstrong",
  "Khaby Lame",
] as const;

/** Open scores from first official ingest at/after market creation. */
const GROUP_B_RESOLVE: Array<{ name: string; openScore: number }> = [
  { name: "Spencer Pratt", openScore: 769_918 },
  { name: "Karen Bass", openScore: 676_605 },
  { name: "Friedrich Merz", openScore: 473_737 },
  { name: "Shane Gillis", openScore: 418_728 },
];

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

async function loadPersonIdByName(name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: trackedPeople.id })
    .from(trackedPeople)
    .where(eq(trackedPeople.name, name))
    .limit(1);
  return row?.id ?? null;
}

async function loadOpenUpDownMarket(personId: string) {
  const [market] = await db
    .select()
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.personId, personId),
      eq(predictionMarkets.marketType, "updown"),
      eq(predictionMarkets.weekNumber, WEEK_NUMBER),
      eq(predictionMarkets.status, "OPEN"),
    ))
    .limit(1);
  return market ?? null;
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  console.log(`[settle-week23] mode=${apply ? "APPLY" : "DRY_RUN"}`);

  let voided = 0;
  let resolved = 0;
  let skipped = 0;

  for (const name of GROUP_A_NAMES) {
    const personId = await loadPersonIdByName(name);
    if (!personId) {
      console.warn(`[settle-week23] Group A: person not found: ${name}`);
      skipped++;
      continue;
    }
    const market = await loadOpenUpDownMarket(personId);
    if (!market) {
      console.log(`[settle-week23] Group A: no OPEN week-${WEEK_NUMBER} updown for ${name} — skip`);
      skipped++;
      continue;
    }
    console.log(`[settle-week23] Group A: void ${name} market=${market.id}`);
    if (apply) {
      const result = await voidOpenNativeMarketsForPerson(personId, "week23_ops_void_demoted");
      voided += result.voided;
    } else {
      voided++;
    }
  }

  for (const { name, openScore } of GROUP_B_RESOLVE) {
    const personId = await loadPersonIdByName(name);
    if (!personId) {
      console.warn(`[settle-week23] Group B: person not found: ${name}`);
      skipped++;
      continue;
    }
    const market = await loadOpenUpDownMarket(personId);
    if (!market) {
      console.log(`[settle-week23] Group B: no OPEN week-${WEEK_NUMBER} updown for ${name} — skip`);
      skipped++;
      continue;
    }

    const createdAt = market.createdAt instanceof Date
      ? market.createdAt.toISOString()
      : String(market.createdAt);

    console.log(
      `[settle-week23] Group B: resolve Down ${name} market=${market.id} ` +
        `openScore=${openScore} (created ${createdAt})`,
    );

    if (apply) {
      const metadata = {
        ...(typeof market.metadata === "object" && market.metadata ? market.metadata : {}),
        openingScore: {
          personId,
          score: openScore,
          snapshotAt: createdAt,
          source: "week23_ops_manual_open",
        },
      };
      await db
        .update(predictionMarkets)
        .set({ metadata, updatedAt: new Date() })
        .where(eq(predictionMarkets.id, market.id));

      const [fresh] = await db
        .select()
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, market.id))
        .limit(1);

      const outcome = await resolveUpDownMarket(fresh);
      if (outcome === "resolved" || outcome === "voided") {
        resolved++;
      } else {
        console.warn(`[settle-week23] Group B: resolve blocked for ${name} (${outcome})`);
        skipped++;
      }
    } else {
      resolved++;
    }
  }

  const scopePersonIds = (
    await Promise.all(
      [...GROUP_A_NAMES, ...GROUP_B_RESOLVE.map((g) => g.name)].map(loadPersonIdByName),
    )
  ).filter((id): id is string => Boolean(id));

  const remaining =
    scopePersonIds.length === 0
      ? []
      : await db
          .select({ id: predictionMarkets.id, title: predictionMarkets.title })
          .from(predictionMarkets)
          .where(and(
            eq(predictionMarkets.marketType, "updown"),
            eq(predictionMarkets.weekNumber, WEEK_NUMBER),
            eq(predictionMarkets.status, "OPEN"),
            inArray(predictionMarkets.personId, scopePersonIds),
          ));

  console.log(
    `[settle-week23] done: would void=${voided}, would resolve=${resolved}, skipped=${skipped}` +
      (apply ? "" : " (dry run)"),
  );
  if (remaining.length > 0) {
    console.log(`[settle-week23] remaining OPEN in scope: ${remaining.map((m) => m.title).join(", ")}`);
  } else {
    console.log("[settle-week23] no remaining OPEN markets in scope");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[settle-week23] fatal:", err);
    process.exit(1);
  });
