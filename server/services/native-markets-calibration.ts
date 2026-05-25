/**
 * Admin calibration data for native Up/Down / H2H / Gainer markets.
 */

import { db } from "../db";
import {
  predictionMarkets,
  marketEntries,
  marketAmmState,
  trendingPeople,
} from "@shared/schema";
import { eq, and, gte, inArray } from "drizzle-orm";
import { currentPrices as ammCurrentPrices, type AmmStateSnapshot } from "@shared/lib/amm/positions";
import { NATIVE_MARKETS_LLM_ENABLED } from "../agents/constants";
import { getNativeBudgetSnapshot } from "../agents/nativeMarketBudget";
import { getAiModel } from "../config/ai-models";
import { getOrFetchNativeAssessment } from "../agents/nativeMarketEngine";
import type { MarketWithEntries, TrendSignals } from "../agents/types";
import type { NativeAssessment } from "../agents/nativeMarketTypes";

const NATIVE_TYPES = ["updown", "h2h", "gainer"] as const;

function openingScoreFromMeta(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  const os = meta.openingScore as { score?: number } | undefined;
  if (os?.score != null && Number.isFinite(os.score)) return Number(os.score);
  const oss = meta.openingScores as Array<{ score?: number; personId?: string }> | undefined;
  if (Array.isArray(oss) && oss[0]?.score != null) return Number(oss[0].score);
  return null;
}

function readCachedAssessment(metadata: unknown): NativeAssessment | null {
  if (!metadata || typeof metadata !== "object") return null;
  const cached = (metadata as Record<string, unknown>).nativeAssessment as
    | { assessment?: NativeAssessment; cachedAt?: string }
    | undefined;
  return cached?.assessment ?? null;
}

function compositeImpliedUpPct(pctVsOpen: number | null): number | null {
  if (pctVsOpen == null || !Number.isFinite(pctVsOpen)) return null;
  const clamped = Math.max(-0.2, Math.min(0.2, pctVsOpen));
  const normalized = clamped / 0.2;
  return Math.max(0.05, Math.min(0.95, 0.5 + normalized * 0.18));
}

export interface NativeCalibrationRow {
  marketId: string;
  personName: string;
  category: string | null;
  marketType: string;
  pctVsOpen: number | null;
  ammUpPct: number | null;
  compositeImpliedPct: number | null;
  llmProbability: number | null;
  llmDirection: string | null;
  /** |AMM − composite implied| — launch-readiness highlight */
  mispricingVsComposite: number | null;
  /** |AMM − LLM| when assessed; used for default table sort */
  disagreementDelta: number | null;
  rationale: string | null;
  lastAssessedAt: string | null;
  openingScore: number | null;
  currentScore: number | null;
}

export async function getNativeCalibrationRows(): Promise<NativeCalibrationRow[]> {
  const now = new Date();
  const markets = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      category: predictionMarkets.category,
      marketType: predictionMarkets.marketType,
      personId: predictionMarkets.personId,
      metadata: predictionMarkets.metadata,
      createdAt: predictionMarkets.createdAt,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.visibility, "live"),
        inArray(predictionMarkets.marketType, [...NATIVE_TYPES]),
        gte(predictionMarkets.endAt, now),
      ),
    );

  if (markets.length === 0) return [];

  const marketIds = markets.map((m) => m.id);
  const entries = await db
    .select()
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, marketIds));

  const ammStates = await db
    .select()
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, marketIds));
  const ammByMarket = new Map(ammStates.map((s) => [s.marketId, s]));

  const personIds = [...new Set(markets.map((m) => m.personId).filter(Boolean))] as string[];
  const people =
    personIds.length > 0
      ? await db
          .select({ id: trendingPeople.id, name: trendingPeople.name, fameIndex: trendingPeople.fameIndex })
          .from(trendingPeople)
          .where(inArray(trendingPeople.id, personIds))
      : [];
  const peopleMap = new Map(people.map((p) => [p.id, p]));

  const entriesByMarket = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = entriesByMarket.get(e.marketId) ?? [];
    arr.push(e);
    entriesByMarket.set(e.marketId, arr);
  }

  const rows: NativeCalibrationRow[] = [];

  for (const m of markets) {
    const mEntries = entriesByMarket.get(m.id) ?? [];
    const upEntry = mEntries.find((e) => (e.label ?? "").toLowerCase() === "up");
    const downEntry = mEntries.find((e) => (e.label ?? "").toLowerCase() === "down");

    const person = m.personId ? peopleMap.get(m.personId) : null;
    const open = openingScoreFromMeta(m.metadata);
    const cur = person?.fameIndex ?? null;
    let pctVsOpen: number | null = null;
    if (open != null && open > 0 && cur != null) {
      pctVsOpen = (cur - open) / open;
    }

    let ammUpPct: number | null = null;
    const ammRow = ammByMarket.get(m.id);
    if (ammRow && upEntry && downEntry) {
      const snap: AmmStateSnapshot = {
        liquidityB: Number(ammRow.liquidityB),
        outcomeOrder: ammRow.outcomeOrder as string[],
        shareQuantities: ammRow.shareQuantities as Record<string, number>,
      };
      const prices = ammCurrentPrices(snap);
      const upP = prices[upEntry.id];
      if (upP != null && Number.isFinite(upP)) ammUpPct = upP;
    } else if (ammRow && mEntries.length >= 2) {
      const snap: AmmStateSnapshot = {
        liquidityB: Number(ammRow.liquidityB),
        outcomeOrder: ammRow.outcomeOrder as string[],
        shareQuantities: ammRow.shareQuantities as Record<string, number>,
      };
      const prices = ammCurrentPrices(snap);
      const first = prices[mEntries[0].id];
      if (first != null) ammUpPct = first;
    }

    const composite = compositeImpliedUpPct(pctVsOpen);
    const assessment = readCachedAssessment(m.metadata);
    const llmProb = assessment?.probability ?? null;
    const mispricingVsComposite =
      ammUpPct != null && composite != null ? Math.abs(ammUpPct - composite) : null;
    const disagreementDelta =
      ammUpPct != null && llmProb != null ? Math.abs(ammUpPct - llmProb) : null;

    rows.push({
      marketId: m.id,
      personName: person?.name ?? m.title?.split(":")[0]?.trim() ?? m.title ?? "—",
      category: m.category,
      marketType: m.marketType,
      pctVsOpen,
      ammUpPct,
      compositeImpliedPct: composite,
      llmProbability: llmProb,
      llmDirection: assessment?.expectedDirection ?? null,
      mispricingVsComposite,
      disagreementDelta,
      rationale: assessment?.rationale ?? null,
      lastAssessedAt: assessment?.fetchedAt ?? null,
      openingScore: open,
      currentScore: cur,
    });
  }

  rows.sort((a, b) => {
    const aKey = a.disagreementDelta ?? a.mispricingVsComposite ?? 0;
    const bKey = b.disagreementDelta ?? b.mispricingVsComposite ?? 0;
    return bKey - aKey;
  });
  return rows;
}

export function getNativeLlmStatus(rows?: NativeCalibrationRow[]) {
  const budget = getNativeBudgetSnapshot();
  const assessedCount = rows?.filter((r) => r.lastAssessedAt != null).length ?? 0;
  const openCount = rows?.length ?? 0;
  const cacheHitRatio =
    openCount > 0 && assessedCount > 0 ? assessedCount / openCount : null;
  return {
    enabled: NATIVE_MARKETS_LLM_ENABLED,
    model: getAiModel("nativeMarkets"),
    budget,
    cacheTtlHours: 24,
    callsToday: budget.callsReserved,
    assessedMarkets: assessedCount,
    cacheHitRatio,
  };
}

export async function refreshNativeAssessment(marketId: string): Promise<{
  ok: boolean;
  assessment: NativeAssessment | null;
  error?: string;
}> {
  if (!NATIVE_MARKETS_LLM_ENABLED) {
    return { ok: false, assessment: null, error: "llm_disabled" };
  }

  const [m] = await db
    .select()
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, marketId))
    .limit(1);
  if (!m) return { ok: false, assessment: null, error: "market_not_found" };

  const entries = await db
    .select()
    .from(marketEntries)
    .where(eq(marketEntries.marketId, marketId));

  const market: MarketWithEntries = {
    id: m.id,
    marketType: m.marketType,
    openMarketType: m.openMarketType,
    status: m.status,
    title: m.title ?? "",
    category: m.category,
    personId: m.personId,
    endAt: m.endAt,
    createdAt: m.createdAt,
    metadata: m.metadata,
    entries: entries.map((e) => ({
      id: e.id,
      label: e.label,
      totalStake: e.totalStake ?? 0,
      noStake: e.noStake ?? undefined,
      personId: e.personId,
    })),
  };

  const openingScore = openingScoreFromMeta(m.metadata);
  const signalPersonId =
    m.personId ?? entries.find((e) => e.personId)?.personId ?? null;
  const { getTrendSignals } = await import("../agents/agentRunner");
  const signals = await getTrendSignals(signalPersonId, { openingScore });

  const assessment = await getOrFetchNativeAssessment(market, signals, {
    forceRefresh: true,
  });
  if (!assessment) {
    const budget = getNativeBudgetSnapshot();
    const reason = budget.exhausted ? "budget_exhausted" : "llm_failed";
    return { ok: false, assessment: null, error: reason };
  }
  return { ok: true, assessment };
}

export function buildCalibrationHistogram(rows: NativeCalibrationRow[]): {
  buckets: Array<{ pctOpenMid: number; avgAmmUpPct: number; count: number }>;
} {
  const bucketMap = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.pctVsOpen == null || r.ammUpPct == null) continue;
    const bucket = Math.round(r.pctVsOpen * 100 / 5) * 5;
    const b = bucketMap.get(bucket) ?? { sum: 0, n: 0 };
    b.sum += r.ammUpPct;
    b.n += 1;
    bucketMap.set(bucket, b);
  }
  const buckets = Array.from(bucketMap.entries())
    .map(([pctOpenMid, { sum, n }]) => ({
      pctOpenMid,
      avgAmmUpPct: n > 0 ? sum / n : 0,
      count: n,
    }))
    .sort((a, b) => a.pctOpenMid - b.pctOpenMid);
  return { buckets };
}
