import { db } from "../../db";
import {
  predictionMarkets,
  marketEntries,
  marketAmmState,
  trendingPeople,
} from "@shared/schema";
import { and, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { ensureWeeklyMarketsForCurrentWeek } from "../../jobs/market-generator";
import { deriveNativeMarketLifecycle } from "../../native-markets/lifecycle";
import { h2hModelProbability } from "@shared/h2hModel";
import { currentPrices } from "@shared/lib/amm/positions";
import { getMarketEngagementPreview } from "./market-engagement";
import { memoizeAsync } from "../insights/request-memo";
import { hasBlendSignal, preferredCategorySet, type BlendState } from "../../lib/blendedRank";

/** Short TTL — the four feeds are polled every 60s per active viewer. */
export const NATIVE_MARKETS_MEMO_MS = 10_000;

const NATIVE_MARKETS_SELF_HEAL_COOLDOWN_MS = 2 * 60 * 1000;
const _nativeMarketsSelfHealByType = new Map<string, number>();

/** Matches what Drizzle's pg `.orderBy()` accepts. */
export type OrderTerm = SQL | PgColumn;

/**
 * Cache-key fragment for the personalised `updown` feed. The ordering only
 * depends on the user's preferred-category SET (a 0/1 bucket), not the
 * continuous decayed weights, so users with the same set share a cached
 * payload. Cold/anonymous users (no blend signal) all map to "cold".
 */
export function updownOrderingKey(state: BlendState): string {
  if (!hasBlendSignal(state)) return "cold";
  return Array.from(preferredCategorySet(state)).sort().join(",");
}

type AmmStateEntry = {
  liquidityB: number;
  outcomeOrder: string[];
  shareQuantities: Record<string, number>;
  houseSeedAmount: number;
  totalUserCreditsIn: number;
  prices: Record<string, number>;
  updatedAt: string;
};

async function buildNativeMarketsPayload(
  type: string,
  orderTerms: OrderTerm[],
): Promise<unknown[]> {
  const nowForCutoff = new Date();
  const fetchOpenNativeMarkets = async () =>
    db
      .select()
      .from(predictionMarkets)
      .where(
        and(
          eq(predictionMarkets.marketType, type),
          eq(predictionMarkets.status, "OPEN"),
          inArray(predictionMarkets.visibility, ["live", "inactive"]),
          gt(predictionMarkets.endAt, nowForCutoff),
        ),
      )
      .orderBy(...orderTerms);

  let markets = await fetchOpenNativeMarkets();
  if (markets.length === 0) {
    const nowMs = Date.now();
    const lastAttemptAt = _nativeMarketsSelfHealByType.get(type) ?? 0;
    if (nowMs - lastAttemptAt > NATIVE_MARKETS_SELF_HEAL_COOLDOWN_MS) {
      _nativeMarketsSelfHealByType.set(type, nowMs);
      try {
        const ensureResult = await ensureWeeklyMarketsForCurrentWeek("read-self-heal");
        console.log(
          `[Native Markets] Self-heal attempt type=${type} outcome=${ensureResult.outcome} week=${ensureResult.weekNumber} before=${ensureResult.openBefore} after=${ensureResult.openAfter}`,
        );
      } catch (selfHealError: any) {
        console.warn(
          `[Native Markets] Self-heal failed for type=${type}:`,
          selfHealError?.message || selfHealError,
        );
      }
      markets = await fetchOpenNativeMarkets();
    }
  }

  const marketIds = markets.map((m) => m.id);
  let entries: any[] = [];
  if (marketIds.length > 0) {
    entries = await db
      .select()
      .from(marketEntries)
      .where(inArray(marketEntries.marketId, marketIds))
      .orderBy(marketEntries.displayOrder);
  }

  // Pull AMM state for any engine='amm' markets so cards can render live
  // LMSR probabilities without a follow-up fetch.
  const ammMarketIds = markets
    .filter((m) => (m as any).engine === "amm")
    .map((m) => m.id);
  const ammStateByMarket = new Map<string, AmmStateEntry>();
  if (ammMarketIds.length > 0) {
    const stateRows = await db
      .select()
      .from(marketAmmState)
      .where(inArray(marketAmmState.marketId, ammMarketIds));
    for (const r of stateRows) {
      const liquidityB = Number(r.liquidityB);
      const outcomeOrder = r.outcomeOrder as string[];
      const shareQuantities = r.shareQuantities as Record<string, number>;
      const prices = currentPrices({ liquidityB, outcomeOrder, shareQuantities });
      ammStateByMarket.set(r.marketId, {
        liquidityB,
        outcomeOrder,
        shareQuantities,
        houseSeedAmount: r.houseSeedAmount,
        totalUserCreditsIn: Number(r.totalUserCreditsIn),
        prices,
        updatedAt: r.updatedAt.toISOString(),
      });
    }
  }

  const engagement = await getMarketEngagementPreview(marketIds);
  const addLifecycleFields = (m: {
    endAt: Date | null;
    engine?: string | null;
    marketType?: string | null;
  }) => {
    const engineKind: "parimutuel" | "amm" = m.engine === "amm" ? "amm" : "parimutuel";
    const lifecycle = deriveNativeMarketLifecycle(
      m.endAt,
      nowForCutoff,
      engineKind,
      m.marketType ?? undefined,
    );
    return {
      bettingCutoff: lifecycle.bettingCutoff?.toISOString() ?? null,
      resolutionDeadline: lifecycle.resolutionDeadline?.toISOString() ?? null,
      lifecycleStatus: lifecycle.status,
      isCutoffPassed: lifecycle.isCutoffPassed,
    };
  };
  const ammStateFor = (marketId: string) => ammStateByMarket.get(marketId) ?? null;

  if (type === "updown" || type === "jackpot") {
    const personIds = markets.map((m) => m.personId).filter(Boolean) as string[];
    let persons: any[] = [];
    if (personIds.length > 0) {
      persons = await db
        .select()
        .from(trendingPeople)
        .where(inArray(trendingPeople.id, personIds));
    }
    const personMap = Object.fromEntries(persons.map((p) => [p.id, p]));

    const enriched = markets.map((m, idx) => {
      const ammState = ammStateFor(m.id);
      // Polymarket-style "Vol." chip. We use the LMSR's totalUserCreditsIn
      // (cumulative credits users have spent buying shares this week) — the
      // cleanest single number that reads as "how active is this market".
      // Sells don't subtract, matching Polymarket / Kalshi. Parimutuel
      // markets get 0 (they sunset Sunday).
      const volume = Number(ammState?.totalUserCreditsIn ?? 0);
      return {
        ...m,
        ...addLifecycleFields(m),
        person: m.personId ? personMap[m.personId] || null : null,
        entries: entries.filter((e) => e.marketId === m.id),
        recentParticipants: engagement.recentParticipantsByMarket.get(m.id) || [],
        activeParticipantCount: engagement.activeParticipantCountByMarket.get(m.id) || 0,
        latestRationale: engagement.latestRationaleByMarket.get(m.id) || null,
        ammState,
        volume,
        __idx: idx,
      };
    });

    // Default sort for the Up/Down feed: most-traded markets first. Stable
    // tiebreaker preserves the personalised / featured / category ordering
    // from the DB query so users with category prefs still see "their"
    // markets first within the same volume bucket. Parimutuel markets
    // (volume = 0) sink to the bottom for the last week of their lives.
    if (type === "updown") {
      enriched.sort((a, b) => {
        if (b.volume !== a.volume) return b.volume - a.volume;
        return a.__idx - b.__idx;
      });
    }

    return enriched.map(({ __idx, ...rest }) => rest);
  }

  if (type === "h2h" || type === "gainer") {
    const personEntryIds = entries.filter((e) => e.personId).map((e) => e.personId!);
    let persons: any[] = [];
    if (personEntryIds.length > 0) {
      persons = await db
        .select()
        .from(trendingPeople)
        .where(inArray(trendingPeople.id, personEntryIds));
    }
    const personMap = Object.fromEntries(persons.map((p) => [p.id, p]));

    const enriched = markets.map((m, idx) => {
      const mEntries = entries
        .filter((e) => e.marketId === m.id)
        .map((e) => ({
          ...e,
          person: e.personId ? personMap[e.personId] || null : null,
        }));

      // Deterministic VoxDex-model probability for H2H cards. Two-entry
      // markets only; anything else (gainer, malformed) leaves the field
      // undefined so the client can skip rendering the pill.
      let modelP1Percent: number | undefined;
      let modelConfidence: "low" | "medium" | "high" | undefined;
      if (type === "h2h" && mEntries.length === 2) {
        const p1 = mEntries[0]?.person;
        const p2 = mEntries[1]?.person;
        if (p1 && p2) {
          const model = h2hModelProbability(
            { fameIndex: Number(p1.fameIndex ?? 0), momentum: p1.momentum ?? undefined },
            { fameIndex: Number(p2.fameIndex ?? 0), momentum: p2.momentum ?? undefined },
          );
          modelP1Percent = model.p1;
          modelConfidence = model.confidence;
        }
      }

      const ammState = ammStateFor(m.id);
      return {
        ...m,
        ...addLifecycleFields(m),
        entries: mEntries,
        recentParticipants: engagement.recentParticipantsByMarket.get(m.id) || [],
        activeParticipantCount: engagement.activeParticipantCountByMarket.get(m.id) || 0,
        latestRationale: engagement.latestRationaleByMarket.get(m.id) || null,
        ...(modelP1Percent !== undefined ? { modelP1Percent, modelConfidence } : {}),
        ammState,
        volume: Number(ammState?.totalUserCreditsIn ?? 0),
        __idx: idx,
      };
    });

    // H2H and Race feeds sort by volume DESC by default (same as Up/Down).
    // Parimutuel markets (volume = 0) sink to the bottom for sunset week,
    // and the stable __idx tiebreaker preserves the DB's category /
    // featured ordering inside each volume bucket.
    enriched.sort((a, b) => {
      if (b.volume !== a.volume) return b.volume - a.volume;
      return a.__idx - b.__idx;
    });

    return enriched.map(({ __idx, ...rest }) => rest);
  }

  return markets.map((m) => {
    const ammState = ammStateFor(m.id);
    return {
      ...m,
      ...addLifecycleFields(m),
      entries: entries.filter((e) => e.marketId === m.id),
      recentParticipants: engagement.recentParticipantsByMarket.get(m.id) || [],
      activeParticipantCount: engagement.activeParticipantCountByMarket.get(m.id) || 0,
      latestRationale: engagement.latestRationaleByMarket.get(m.id) || null,
      ammState,
      volume: Number(ammState?.totalUserCreditsIn ?? 0),
    };
  });
}

/**
 * Memoised native-markets feed. Collapses the per-viewer polling storm
 * (4 feeds x 60s x N viewers) into one computation per (type, orderingKey)
 * per TTL window. `memoizeAsync` also single-flights concurrent identical
 * requests, so a cold hit under load still computes once.
 */
export async function loadNativeMarkets(params: {
  type: string;
  orderTerms: OrderTerm[];
  orderingKey: string;
}): Promise<unknown[]> {
  const { type, orderTerms, orderingKey } = params;
  return memoizeAsync(
    `native-markets:${type}:${orderingKey}`,
    NATIVE_MARKETS_MEMO_MS,
    () => buildNativeMarketsPayload(type, orderTerms),
  );
}
