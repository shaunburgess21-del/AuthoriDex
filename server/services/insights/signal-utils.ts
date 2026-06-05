import type { MomentumLevel, InsightsPrimaryDriver } from "@shared/insights/types";

export function computeMomentumLevel(ratio: number): MomentumLevel {
  if (!Number.isFinite(ratio) || ratio <= 0) return "none";
  if (ratio < 1.0) return "low";
  if (ratio < 2.0) return "medium";
  return "high";
}

/**
 * Search "surge" level from the month-over-month search-volume delta (%).
 * Unlike absolute volume (which would mark every famous person as "search-led"
 * and overlap with the Mass driver), the MoM delta captures *rising* search
 * interest, keeping "Search-led" a meaningful, rare driver. Negative/flat moves
 * are "none" so a person isn't surfaced as search-driven while declining.
 */
export function searchSurgeLevel(momDeltaPct: number): MomentumLevel {
  if (!Number.isFinite(momDeltaPct) || momDeltaPct <= 8) return "none";
  if (momDeltaPct >= 50) return "high";
  if (momDeltaPct >= 20) return "medium";
  return "low";
}

export function ratioFromDiagnostics(
  diag: Record<string, unknown> | null | undefined,
  ratioKey: string,
  numerator: number,
  denomKey: string,
): number {
  const raw = diag?.raw as Record<string, unknown> | undefined;
  const persisted = Number(raw?.[ratioKey] ?? 0);
  if (persisted > 0) return Math.min(persisted, 10);

  const denom = Math.max(Number(raw?.[denomKey] ?? 0), 1);
  if (numerator > 0 && denom > 0) {
    return Math.min(numerator / denom, 10);
  }
  return 0;
}

export function breakdownFromDiagnostics(
  diag: Record<string, unknown> | null | undefined,
): Record<string, number> | null {
  const vc = diag?.velocityComponents as Record<string, number> | undefined;
  if (!vc) return null;

  const wiki = Number(vc.wiki ?? 0);
  const news = Number(vc.news ?? 0);
  const momentum = Number(vc.momentum ?? 0);
  const wikiMomentum = Number(vc.wikiMomentum ?? 0);
  const total = wiki + news + momentum + wikiMomentum;
  if (total <= 0) return null;

  return {
    wiki: Math.round((wiki / total) * 100),
    news: Math.round((news / total) * 100),
    momentum: Math.round((momentum / total) * 100),
    wikiMomentum: Math.round((wikiMomentum / total) * 100),
  };
}

export function classifyPrimaryDriver(
  newsLevel: MomentumLevel,
  wikiLevel: MomentumLevel,
  searchLevel: MomentumLevel,
): InsightsPrimaryDriver {
  const scores: Array<{ driver: InsightsPrimaryDriver; weight: number }> = [
    { driver: "NEWS", weight: levelWeight(newsLevel) },
    { driver: "WIKI", weight: levelWeight(wikiLevel) },
    { driver: "SEARCH", weight: levelWeight(searchLevel) },
  ];

  scores.sort((a, b) => b.weight - a.weight);
  const top = scores[0];
  const second = scores[1];
  if (!top || top.weight <= 0) return "MIXED";
  if (second && second.weight > 0 && top.weight / second.weight < 1.15) {
    return "MIXED";
  }
  return top.driver;
}

function levelWeight(level: MomentumLevel): number {
  switch (level) {
    case "high":
      return 100;
    case "medium":
      return 50;
    case "low":
      return 20;
    default:
      return 0;
  }
}

export interface SourceSortInputs {
  fameIndex: number;
  velocityScore: number;
  massScore: number;
  newsMomentumRatio: number;
  wikiMomentumRatio: number;
  /** Today's 24h rolling article count. */
  newsCount: number;
  /** 7-day daily average articles (from diagnostics.raw.news7d). */
  newsDailyAvg7d: number;
  /** Today's Wikipedia pageviews (latest snapshot value). */
  wikiPageviews: number;
  /** True 7-day Wikipedia pageview SUM (from loadTrailing7dWikiByPerson). */
  wiki7dSum: number;
  /** Trailing-12-month average monthly Google searches. */
  searchVolume: number;
}

/**
 * Source-aware, window-aware sort value.
 *
 * - `news` 7d → uses `newsDailyAvg7d × 7` (honest estimate; news_count is a
 *   24h rolling count and can't be summed cleanly).
 * - `wiki` 7d → uses true 7d pageview SUM.
 * - `search_volume` ignores window (DataForSEO is monthly only).
 * - Momentum ratios are inherently 7d-normalised; window has no effect.
 * - `fame` uses fameIndex; the % delta column varies with window.
 */
export function sortValueForSource(
  source: string,
  row: SourceSortInputs,
  window: "24h" | "7d" = "24h",
): number {
  switch (source) {
    case "news_momentum":
      return row.newsMomentumRatio;
    case "wiki_momentum":
      return row.wikiMomentumRatio;
    case "fame":
      return row.fameIndex;
    case "news":
      return window === "7d" ? row.newsDailyAvg7d * 7 : row.newsCount;
    case "wiki":
      return window === "7d" ? row.wiki7dSum : row.wikiPageviews;
    case "search_volume":
      return row.searchVolume;
    default:
      return row.fameIndex;
  }
}
