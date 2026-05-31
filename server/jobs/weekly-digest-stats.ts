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

async function loadRankDelta(
  userId: string,
  isoWeek: string,
): Promise<FullWeeklyDigestStats["rankDelta"]> {
  const prevWeek = previousIsoYearWeek(isoWeek);
  if (!prevWeek) return null;

  const rows = await db
    .select({
      isoWeek: userRankSnapshots.isoWeek,
      rank: userRankSnapshots.rank,
    })
    .from(userRankSnapshots)
    .where(
      and(
        eq(userRankSnapshots.userId, userId),
        eq(userRankSnapshots.period, RANK_SNAPSHOT_PERIOD),
        inArray(userRankSnapshots.isoWeek, [isoWeek, prevWeek]),
      ),
    );

  const current = rows.find((r) => r.isoWeek === isoWeek)?.rank;
  const previous = rows.find((r) => r.isoWeek === prevWeek)?.rank;
  if (current == null || previous == null) return null;

  return { previous, current };
}

/**
 * Per-user weekly roll-up. Window matches deriveWeeklyDigest():
 * rolling 7 days ending at `asOf` (default now).
 */
export async function getWeeklyDigestStats(
  userId: string,
  options: WeeklyDigestStatsOptions = {},
): Promise<FullWeeklyDigestStats> {
  const asOf = options.asOf ?? new Date();
  const isoWeek = options.isoWeek ?? isoYearWeek(asOf);
  const windowEnd = asOf;
  const windowStart = new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = sql`NOW() - INTERVAL '7 days'`;

  const settledBuys = await db
    .select({
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
        eq(marketBets.userId, userId),
        eq(marketBets.actionType, "buy"),
        inArray(marketBets.status, ["won", "lost"]),
        gte(marketBets.settledAt, sevenDaysAgo),
      ),
    );

  const sellRows = await db
    .select({ stakeAmount: marketBets.stakeAmount })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.userId, userId),
        eq(marketBets.actionType, "sell"),
        gte(marketBets.createdAt, sevenDaysAgo),
      ),
    );

  const jackpotRows = await db
    .select({
      stakeAmount: marketBets.stakeAmount,
      payoutAmount: marketBets.payoutAmount,
      status: marketBets.status,
    })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.userId, userId),
        eq(marketBets.actionType, "parimutuel"),
        inArray(marketBets.status, ["won", "lost"]),
        gte(marketBets.settledAt, sevenDaysAgo),
      ),
    );

  const rollUp = rollUpSettledBuys(
    settledBuys.map((bet) => ({
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

  for (const sell of sellRows) {
    netCredits += -(sell.stakeAmount ?? 0);
  }

  const jackpot = summariseJackpotRows(jackpotRows);

  const [rankDelta, topWeeklyGainers] = await Promise.all([
    loadRankDelta(userId, isoWeek),
    loadTopWeeklyGainers(),
  ]);

  return {
    wins,
    losses,
    netCredits,
    bestPick,
    worstPick,
    rankDelta,
    jackpot,
    topWeeklyGainers,
    windowStart,
    windowEnd,
  };
}
