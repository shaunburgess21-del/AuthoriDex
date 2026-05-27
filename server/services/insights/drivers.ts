import type {
  InsightsDriverMixSegment,
  InsightsPrimaryDriver,
  MomentumLevel,
} from "@shared/insights/types";
import { storage } from "../../storage";
import {
  loadLatestSnapshotsByPerson,
  type LatestSnapshotRow,
} from "./snapshot-batch";
import {
  classifyPrimaryDriver,
  computeMomentumLevel,
  ratioFromDiagnostics,
} from "./signal-utils";

export interface PersonSignalSnapshot {
  personId: string;
  newsLevel: MomentumLevel;
  wikiLevel: MomentumLevel;
  trendsLevel: MomentumLevel;
  velocityScore: number;
  massScore: number;
  primaryDriver: InsightsPrimaryDriver;
}

/** Optionally accept pre-loaded snapshots to avoid duplicate DB hits. */
export async function loadPersonSignals(
  prefetched?: { snapshots?: Map<string, LatestSnapshotRow> },
): Promise<Map<string, PersonSignalSnapshot>> {
  const people = await storage.getTrendingPeople();
  const snapshots = prefetched?.snapshots ?? (await loadLatestSnapshotsByPerson());
  const out = new Map<string, PersonSignalSnapshot>();

  for (const person of people) {
    const snap = snapshots.get(person.id);
    const diag = snap?.diagnostics ?? null;
    const newsRatio = ratioFromDiagnostics(diag, "newsMomentumRatio", snap?.newsCount ?? 0, "news7d");
    const wikiRatio = ratioFromDiagnostics(
      diag,
      "wikiMomentumRatio",
      snap?.wikiPageviews ?? 0,
      "wikiMomentumAvg7d",
    );
    const trendsRatio = ratioFromDiagnostics(diag, "trendsMomentumRatio", 0, "trendsAvg7d");

    const newsLevel = computeMomentumLevel(newsRatio);
    const wikiLevel = computeMomentumLevel(wikiRatio);
    const trendsLevel = computeMomentumLevel(trendsRatio);
    const velocityScore = snap?.velocityScore ?? 0;
    const massScore = snap?.massScore ?? 0;

    const primaryDriver = classifyPrimaryDriver(
      newsLevel,
      wikiLevel,
      trendsLevel,
      velocityScore,
      massScore,
    );

    out.set(person.id, {
      personId: person.id,
      newsLevel,
      wikiLevel,
      trendsLevel,
      velocityScore,
      massScore,
      primaryDriver,
    });
  }

  return out;
}

export async function loadDriversSummary(topN: number): Promise<{
  topN: number;
  segments: InsightsDriverMixSegment[];
}> {
  const people = await storage.getTrendingPeople();
  const topPeople = [...people].sort((a, b) => a.rank - b.rank).slice(0, topN);
  const signals = await loadPersonSignals();

  const counts = new Map<InsightsPrimaryDriver, string[]>();
  for (const p of topPeople) {
    const sig = signals.get(p.id);
    const driver = sig?.primaryDriver ?? "MIXED";
    const list = counts.get(driver) ?? [];
    list.push(p.id);
    counts.set(driver, list);
  }

  const total = topPeople.length || 1;
  const segments: InsightsDriverMixSegment[] = Array.from(counts.entries())
    .map(([driver, sampleIds]) => ({
      driver,
      pct: Math.round((sampleIds.length / total) * 100),
      sampleIds: sampleIds.slice(0, 5),
    }))
    .sort((a, b) => b.pct - a.pct);

  return { topN, segments };
}

export async function loadSingleSourceSurge(limit = 25): Promise<
  Array<{
    id: string;
    name: string;
    avatar: string | null;
    category: string | null;
    rank: number;
    surgeSource: "news" | "wiki" | "trends";
    levels: { news: MomentumLevel; wiki: MomentumLevel; trends: MomentumLevel };
  }>
> {
  const people = await storage.getTrendingPeople();
  const signals = await loadPersonSignals();
  const rows: Array<{
    id: string;
    name: string;
    avatar: string | null;
    category: string | null;
    rank: number;
    surgeSource: "news" | "wiki" | "trends";
    levels: { news: MomentumLevel; wiki: MomentumLevel; trends: MomentumLevel };
  }> = [];

  for (const person of people) {
    const sig = signals.get(person.id);
    if (!sig) continue;

    const levels = {
      news: sig.newsLevel,
      wiki: sig.wikiLevel,
      trends: sig.trendsLevel,
    };

    const sources: Array<"news" | "wiki" | "trends"> = ["news", "wiki", "trends"];
    for (const source of sources) {
      const high = levels[source] === "high";
      const othersLow =
        (source === "news" ? levels.wiki === "low" && levels.trends === "low" : true) &&
        (source === "wiki" ? levels.news === "low" && levels.trends === "low" : true) &&
        (source === "trends" ? levels.news === "low" && levels.wiki === "low" : true);

      if (high && othersLow) {
        rows.push({
          id: person.id,
          name: person.name,
          avatar: person.avatar ?? null,
          category: person.category ?? null,
          rank: person.rank,
          surgeSource: source,
          levels,
        });
        break;
      }
    }
  }

  return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
}
