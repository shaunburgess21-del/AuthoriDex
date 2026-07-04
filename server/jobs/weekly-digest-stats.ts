/**
 * Shared weekly prediction stats for in-app digest + Weekly Wrap email.
 */

import {
  marketBets,
  marketEntries,
  predictionMarkets,
  profiles,
  trackedPeople,
  userRankSnapshots,
} from "@shared/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { storage } from "../storage";
import { selectWeeklyGainers } from "../services/trending/weekly-gainers";
import { getBaselineDiagnostics } from "../utils/baseline";
import { resolvePickContextLabel } from "./notification-market-labels";
import {
  type FullWeeklyDigestStats,
  isoYearWeek,
  previousIsoYearWeek,
  rollUpSettledBuys,
  summariseJackpotRows,
} from "./weekly-digest-utils";

const entryPerson = alias(trackedPeople, "entry_person_digest");
const RANK_SNAPSHOT_PERIOD = "all";

const SEVEN_DAYS_AGO = sql`NOW() - INTERVAL '7 days'`;

export interface WeeklyDigestStatsOptions {
  /** Anchor time for the rolling window (defaults to now). */
  asOf?: Date;
  isoWeek?: string;
}

/** Users with >=1 market bet in the last 7 days (non-agent). */
export async function listActiveDigestUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: marketBets.userId })
    .from(marketBets)
    .innerJoin(profiles, eq(profiles.id, marketBets.userId))
    .where(
      and(eq(profiles.isAgent, false), gte(marketBets.createdAt, SEVEN_DAYS_AGO)),
    )
    .groupBy(marketBets.userId);
  return rows.map((r) => r.userId);
}

async function loadTopWeeklyGainers(): Promise<
  FullWeeklyDigestStats["topWeeklyGainers"]
> {
  const people = await storage.getTrendingPeople();
  if (people.length === 0) return [];

  const baselineMeta = await getBaselineDiagnostics(people.length);
  if (baselineMeta.baseline7dStatus !== "normal") return [];

  return selectWeeklyGainers(people).map((p) => ({
    name: p.name,
    change7d: p.change7d as number,
  }));
}

/** Rank deltas for a cohort in two queries' worth of rows (one query). */
async function loadRankDeltaBatch(
  userIds: string[],
  isoWeek: string,
): Promise<Map<string, FullWeeklyDigestStats["rankDelta"]>> {
  const deltas = new Map<string, FullWeeklyDigestStats["rankDelta"]>();
  const prevWeek = previousIsoYearWeek(isoWeek);
  if (!prevWeek || userIds.length === 0) return deltas;

  const rows = await db
    .select({
      userId: userRankSnapshots.userId,
      isoWeek: userRankSnapshots.isoWeek,
      rank: userRankSnapshots.rank,
    })
    .from(userRankSnapshots)
    .where(
      and(
        inArray(userRankSnapshots.userId, userIds),
        eq(userRankSnapshots.period, RANK_SNAPSHOT_PERIOD),
        inArray(userRankSnapshots.isoWeek, [isoWeek, prevWeek]),
      ),
    );

  const byUser = new Map<string, { current?: number; previous?: number }>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {};
    if (row.isoWeek === isoWeek) entry.current = row.rank;
    else if (row.isoWeek === prevWeek) entry.previous = row.rank;
    byUser.set(row.userId, entry);
  }
  for (const [userId, entry] of byUser) {
    if (entry.current != null && entry.previous != null) {
      deltas.set(userId, { previous: entry.previous, current: entry.current });
    }
  }
  return deltas;
}

/**
 * Batched weekly roll-up for a cohort of users. Runs a fixed number of
 * queries regardless of cohort size (~5 total vs ~5 per user before):
 * settled buys / sells / jackpot rows are fetched with inArray(userId)
 * and grouped in JS through the same pure roll-up helpers the per-user
 * path used; topWeeklyGainers is user-independent and computed once.
 *
 * Returns an entry for EVERY requested userId (all-zero stats when the
 * user had no qualifying rows) so callers can index without fallbacks.
 */
export async function getWeeklyDigestStatsBatch(
  userIds: string[],
  options: WeeklyDigestStatsOptions = {},
): Promise<Map<string, FullWeeklyDigestStats>> {
  const out = new Map<string, FullWeeklyDigestStats>();
  if (userIds.length === 0) return out;

  const asOf = options.asOf ?? new Date();
  const isoWeek = options.isoWeek ?? isoYearWeek(asOf);
  const windowEnd = asOf;
  const windowStart = new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = sql`NOW() - INTERVAL '7 days'`;

  const [settledBuys, sellRows, jackpotRows, rankDeltas, topWeeklyGainers] =
    await Promise.all([
      db
        .select({
          userId: marketBets.userId,
          marketId: marketBets.marketId,
          stakeAmount: marketBets.stakeAmount,
          payoutAmount: marketBets.payoutAmount,
          status: marketBets.status,
          marketTitle: predictionMarkets.title,
          marketType: predictionMarkets.marketType,
          entryLabel: marketEntries.label,
          candidateName: entryPerson.name,
          personName: trackedPeople.name,
        })
        .from(marketBets)
        .innerJoin(predictionMarkets, eq(marketBets.marketId, predictionMarkets.id))
        .innerJoin(marketEntries, eq(marketBets.entryId, marketEntries.id))
        .leftJoin(entryPerson, eq(marketEntries.personId, entryPerson.id))
        .leftJoin(trackedPeople, eq(predictionMarkets.personId, trackedPeople.id))
        .where(
          and(
            inArray(marketBets.userId, userIds),
            eq(marketBets.actionType, "buy"),
            inArray(marketBets.status, ["won", "lost"]),
            gte(marketBets.settledAt, sevenDaysAgo),
          ),
        ),
      db
        .select({ userId: marketBets.userId, stakeAmount: marketBets.stakeAmount })
        .from(marketBets)
        .where(
          and(
            inArray(marketBets.userId, userIds),
            eq(marketBets.actionType, "sell"),
            gte(marketBets.createdAt, sevenDaysAgo),
          ),
        ),
      db
        .select({
          userId: marketBets.userId,
          stakeAmount: marketBets.stakeAmount,
          payoutAmount: marketBets.payoutAmount,
          status: marketBets.status,
        })
        .from(marketBets)
        .where(
          and(
            inArray(marketBets.userId, userIds),
            eq(marketBets.actionType, "parimutuel"),
            inArray(marketBets.status, ["won", "lost"]),
            gte(marketBets.settledAt, sevenDaysAgo),
          ),
        ),
      loadRankDeltaBatch(userIds, isoWeek),
      loadTopWeeklyGainers(),
    ]);

  const buysByUser = new Map<string, typeof settledBuys>();
  for (const row of settledBuys) {
    const list = buysByUser.get(row.userId) ?? [];
    list.push(row);
    buysByUser.set(row.userId, list);
  }
  const sellsByUser = new Map<string, typeof sellRows>();
  for (const row of sellRows) {
    const list = sellsByUser.get(row.userId) ?? [];
    list.push(row);
    sellsByUser.set(row.userId, list);
  }
  const jackpotByUser = new Map<string, typeof jackpotRows>();
  for (const row of jackpotRows) {
    const list = jackpotByUser.get(row.userId) ?? [];
    list.push(row);
    jackpotByUser.set(row.userId, list);
  }

  for (const userId of userIds) {
    const rollUp = rollUpSettledBuys(
      (buysByUser.get(userId) ?? []).map((bet) => ({
        status: bet.status,
        stakeAmount: bet.stakeAmount,
        payoutAmount: bet.payoutAmount,
        marketTitle: bet.marketTitle,
        pickLabel: resolvePickContextLabel({
          marketType: bet.marketType,
          candidateName: bet.candidateName,
          entryLabel: bet.entryLabel,
          personName: bet.personName,
        }),
      })),
    );
    let { wins, losses, netCredits, bestPick, worstPick } = rollUp;

    for (const sell of sellsByUser.get(userId) ?? []) {
      netCredits += -(sell.stakeAmount ?? 0);
    }

    out.set(userId, {
      wins,
      losses,
      netCredits,
      bestPick,
      worstPick,
      rankDelta: rankDeltas.get(userId) ?? null,
      jackpot: summariseJackpotRows(jackpotByUser.get(userId) ?? []),
      topWeeklyGainers,
      windowStart,
      windowEnd,
    });
  }

  return out;
}

/**
 * Per-user weekly roll-up. Window matches deriveWeeklyDigest():
 * rolling 7 days ending at `asOf` (default now). Thin wrapper over the
 * batch loader so both paths share one implementation.
 */
export async function getWeeklyDigestStats(
  userId: string,
  options: WeeklyDigestStatsOptions = {},
): Promise<FullWeeklyDigestStats> {
  const batch = await getWeeklyDigestStatsBatch([userId], options);
  // Batch always yields an entry for each requested id.
  return batch.get(userId)!;
}
