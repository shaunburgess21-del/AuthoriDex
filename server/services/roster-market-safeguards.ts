/**
 * Guards linking roster changes (demote / weekly induction) to native prediction markets.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  marketEntries,
  predictionMarkets,
  trendSnapshots,
} from "@shared/schema";
import { db } from "../db";
import { log } from "../log";
import { resolveAmmMarket } from "./amm-resolver";
import { officialSnapshotOriginCondition } from "../scoring/official-snapshots";
import {
  getMinRecentIngestSamplesForNativeMarkets,
  getNativeMarketEligibilityWindow,
} from "../native-markets/native-market-eligibility";

export { getMinRecentIngestSamplesForNativeMarkets, getNativeMarketEligibilityWindow };

const NATIVE_MARKET_TYPES = ["updown", "h2h", "gainer", "jackpot"] as const;

/**
 * People with fewer than N official ingest rows in the trailing week are excluded
 * from anchored jackpot/updown selection (fresh inductees skip their first week).
 */
export async function filterPersonIdsEligibleForWeeklyNativeMarkets(
  personIds: string[],
  weekMonday: Date,
): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();

  const { windowStart, windowEnd } = getNativeMarketEligibilityWindow(weekMonday);
  const minSamples = getMinRecentIngestSamplesForNativeMarkets();

  const rows = await db
    .select({
      personId: trendSnapshots.personId,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(trendSnapshots)
    .where(and(
      inArray(trendSnapshots.personId, personIds),
      officialSnapshotOriginCondition(),
      gte(trendSnapshots.timestamp, windowStart),
      lt(trendSnapshots.timestamp, windowEnd),
    ))
    .groupBy(trendSnapshots.personId);

  const eligible = new Set<string>();
  for (const row of rows) {
    if (Number(row.cnt) >= minSamples) {
      eligible.add(row.personId);
    }
  }
  return eligible;
}

async function findOpenNativeMarketsForPerson(personId: string): Promise<Array<{
  id: string;
  marketType: string;
  engine: string | null;
}>> {
  const byPersonId = await db
    .select({
      id: predictionMarkets.id,
      marketType: predictionMarkets.marketType,
      engine: predictionMarkets.engine,
    })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.personId, personId),
      eq(predictionMarkets.status, "OPEN"),
      inArray(predictionMarkets.marketType, [...NATIVE_MARKET_TYPES]),
    ));

  const byEntry = await db
    .select({
      id: predictionMarkets.id,
      marketType: predictionMarkets.marketType,
      engine: predictionMarkets.engine,
    })
    .from(marketEntries)
    .innerJoin(predictionMarkets, eq(marketEntries.marketId, predictionMarkets.id))
    .where(and(
      eq(marketEntries.personId, personId),
      eq(predictionMarkets.status, "OPEN"),
      inArray(predictionMarkets.marketType, ["h2h", "gainer"]),
    ));

  const seen = new Set<string>();
  const merged: Array<{ id: string; marketType: string; engine: string | null }> = [];
  for (const row of [...byPersonId, ...byEntry]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

/**
 * Void all OPEN native markets involving this person (Up/Down, H2H, gainer, jackpot).
 * Called after admin demotion so markets are not left stranded without ingest.
 */
export async function voidOpenNativeMarketsForPerson(
  personId: string,
  reason = "roster_demotion",
): Promise<{ voided: number; marketIds: string[] }> {
  const markets = await findOpenNativeMarketsForPerson(personId);
  if (markets.length === 0) {
    return { voided: 0, marketIds: [] };
  }

  const voidedIds: string[] = [];
  const now = new Date();

  for (const market of markets) {
    try {
      if (market.engine === "amm" && market.marketType !== "jackpot") {
        const result = await resolveAmmMarket({
          marketId: market.id,
          voidMarket: true,
          settledBy: null,
          voidReason: reason,
        });
        if ("error" in result) {
          log(`[RosterSafeguards] AMM void failed market=${market.id}: ${result.error}`);
          continue;
        }
        await db.update(predictionMarkets).set({
          resolveMethod: "auto",
          voidReason: "Roster demotion — market voided",
          resolutionNotes: JSON.stringify({
            type: market.marketType,
            voidReason: reason,
            personId,
            voidedAt: now.toISOString(),
          }),
          updatedAt: now,
        }).where(eq(predictionMarkets.id, market.id));
      } else {
        const { voidMarketBets } = await import("../jobs/market-resolver");
        await voidMarketBets(market.id);
        await db.update(predictionMarkets).set({
          voidReason: "Roster demotion — market voided",
          resolutionNotes: JSON.stringify({
            type: market.marketType,
            voidReason: reason,
            personId,
            voidedAt: now.toISOString(),
          }),
          updatedAt: now,
        }).where(eq(predictionMarkets.id, market.id));
      }
      voidedIds.push(market.id);
      log(`[RosterSafeguards] Voided ${market.marketType} market=${market.id} for demoted person=${personId}`);
    } catch (err) {
      log(`[RosterSafeguards] Error voiding market=${market.id}: ${(err as Error)?.message ?? err}`);
    }
  }

  return { voided: voidedIds.length, marketIds: voidedIds };
}
