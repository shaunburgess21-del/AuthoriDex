import type { MomentumLevel, InsightsPrimaryDriver } from "@shared/insights/types";

export function computeMomentumLevel(ratio: number): MomentumLevel {
  if (!Number.isFinite(ratio) || ratio <= 0) return "none";
  if (ratio < 1.0) return "low";
  if (ratio < 2.0) return "medium";
  return "high";
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
  trendsLevel: MomentumLevel,
  velocityScore: number,
  massScore: number,
): InsightsPrimaryDriver {
  const scores: Array<{ driver: InsightsPrimaryDriver; weight: number }> = [
    { driver: "NEWS", weight: levelWeight(newsLevel) },
    { driver: "WIKI", weight: levelWeight(wikiLevel) },
    { driver: "TRENDS", weight: levelWeight(trendsLevel) },
    { driver: "VELOCITY", weight: velocityScore },
    { driver: "MASS", weight: massScore * 0.5 },
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

export function sortValueForSource(
  source: string,
  row: {
    fameIndex: number;
    velocityScore: number;
    massScore: number;
    newsMomentumRatio: number;
    wikiMomentumRatio: number;
    trendsMomentumRatio: number;
    newsCount: number;
    wikiPageviews: number;
    searchVolume: number;
  },
): number {
  switch (source) {
    case "news_momentum":
      return row.newsMomentumRatio;
    case "wiki_momentum":
      return row.wikiMomentumRatio;
    case "velocity":
      return row.velocityScore;
    case "mass":
      return row.massScore;
    case "fame":
      return row.fameIndex;
    case "news":
      return row.newsCount;
    case "wiki":
      return row.wikiPageviews;
    case "trends":
      return row.trendsMomentumRatio;
    case "search_volume":
      return row.searchVolume;
    default:
      return row.newsMomentumRatio;
  }
}
