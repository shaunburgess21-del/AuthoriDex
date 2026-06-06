import type {
  InsightsDriverMixSegment,
  InsightsPrimaryDriver,
  MomentumLevel,
} from "@shared/insights/types";
import { getCachedTrendingPeople } from "./insights-people-cache";
import {
  loadLatestSnapshotsByPerson,
  type LatestSnapshotRow,
} from "./snapshot-batch";
import {
  classifyPrimaryDriver,
  computeMomentumLevel,
  ratioFromDiagnostics,
  searchSurgeLevel,
} from "./signal-utils";

export interface PersonSignalSnapshot {
  personId: string;
  newsLevel: MomentumLevel;
  wikiLevel: MomentumLevel;
  searchLevel: MomentumLevel;
  velocityScore: number;
  massScore: number;
  primaryDriver: InsightsPrimaryDriver;
}

/** Optionally accept pre-loaded snapshots to avoid duplicate DB hits. */
export async function loadPersonSignals(
  prefetched?: { snapshots?: Map<string, LatestSnapshotRow> },
): Promise<Map<string, PersonSignalSnapshot>> {
  const people = await getCachedTrendingPeople();
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
    const rawDiag = (diag as Record<string, any> | null)?.raw as Record<string, unknown> | undefined;
    const searchMoMDeltaPct = Number(rawDiag?.googleSearchVolumeMoMDeltaPct ?? 0);

    const newsLevel = computeMomentumLevel(newsRatio);
    const wikiLevel = computeMomentumLevel(wikiRatio);
    const searchLevel = searchSurgeLevel(searchMoMDeltaPct);
    const velocityScore = snap?.velocityScore ?? 0;
    const massScore = snap?.massScore ?? 0;

    const primaryDriver = classifyPrimaryDriver(
      newsLevel,
      wikiLevel,
      searchLevel,
    );

    out.set(person.id, {
      personId: person.id,
      newsLevel,
      wikiLevel,
      searchLevel,
      velocityScore,
      massScore,
      primaryDriver,
    });
  }

  return out;
}

export async function loadDriversSummary(
  topN: number,
  prefetched?: {
    people?: Awaited<ReturnType<typeof getCachedTrendingPeople>>;
    signals?: Map<string, PersonSignalSnapshot>;
    snapshots?: Map<string, LatestSnapshotRow>;
  },
): Promise<{
  topN: number;
  segments: InsightsDriverMixSegment[];
}> {
  const people = prefetched?.people ?? (await getCachedTrendingPeople());
  const topPeople = [...people].sort((a, b) => a.rank - b.rank).slice(0, topN);
  const snapshots = prefetched?.snapshots ?? (await loadLatestSnapshotsByPerson());

  // Attention mix = the share of *Trend Score movement* driven by each signal
  // across the top-N, computed from the raw velocity components rather than a
  // per-person "primary driver" bucket. Only News and Wikipedia are real
  // drivers — Search carries 0 weight in the velocity composite
  // (see server/scoring/normalize.ts), so it's excluded entirely. This makes
  // the two bars sum to a meaningful 100% that matches the caption.
  let newsTotal = 0;
  let wikiTotal = 0;
  const newsContrib: Array<{ id: string; v: number }> = [];
  const wikiContrib: Array<{ id: string; v: number }> = [];

  for (const p of topPeople) {
    const diag = snapshots.get(p.id)?.diagnostics as Record<string, any> | null | undefined;
    const vc = diag?.velocityComponents as Record<string, number> | undefined;
    if (!vc) continue;
    // News component = base news velocity + news momentum; Wikipedia component
    // = base wiki velocity + wiki momentum. Clamp negatives to 0 so a cooling
    // signal can't produce a nonsensical negative contribution share.
    const news = Math.max(0, Number(vc.news ?? 0)) + Math.max(0, Number(vc.momentum ?? 0));
    const wiki = Math.max(0, Number(vc.wiki ?? 0)) + Math.max(0, Number(vc.wikiMomentum ?? 0));
    newsTotal += news;
    wikiTotal += wiki;
    if (news > 0) newsContrib.push({ id: p.id, v: news });
    if (wiki > 0) wikiContrib.push({ id: p.id, v: wiki });
  }

  const grand = newsTotal + wikiTotal;
  const segments: InsightsDriverMixSegment[] = [];
  if (grand > 0) {
    const newsPct = Math.round((newsTotal / grand) * 100);
    segments.push({
      driver: "NEWS",
      pct: newsPct,
      sampleIds: newsContrib.sort((a, b) => b.v - a.v).slice(0, 5).map((x) => x.id),
    });
    segments.push({
      // Force the pair to sum to exactly 100 (avoid a rounding gap in the UI).
      driver: "WIKI",
      pct: 100 - newsPct,
      sampleIds: wikiContrib.sort((a, b) => b.v - a.v).slice(0, 5).map((x) => x.id),
    });
    segments.sort((a, b) => b.pct - a.pct);
  }

  return { topN, segments };
}

type SurgeSource = "news" | "wiki" | "search";

/** A source is "quiet" for surge purposes when it's low or absent. */
function isQuiet(level: MomentumLevel): boolean {
  return level === "low" || level === "none";
}

export async function loadSingleSourceSurge(limit = 25): Promise<
  Array<{
    id: string;
    name: string;
    avatar: string | null;
    category: string | null;
    rank: number;
    surgeSource: SurgeSource;
    levels: { news: MomentumLevel; wiki: MomentumLevel; search: MomentumLevel };
  }>
> {
  const people = await getCachedTrendingPeople();
  const signals = await loadPersonSignals();
  const rows: Array<{
    id: string;
    name: string;
    avatar: string | null;
    category: string | null;
    rank: number;
    surgeSource: SurgeSource;
    levels: { news: MomentumLevel; wiki: MomentumLevel; search: MomentumLevel };
  }> = [];

  for (const person of people) {
    const sig = signals.get(person.id);
    if (!sig) continue;

    const levels = {
      news: sig.newsLevel,
      wiki: sig.wikiLevel,
      search: sig.searchLevel,
    };

    const sources: SurgeSource[] = ["news", "wiki", "search"];
    for (const source of sources) {
      const high = levels[source] === "high";
      // The other two sources must be quiet (low OR none). Previously this
      // required exactly `low`, so a flat/`none` source blocked otherwise-clean
      // single-source surges from firing.
      const othersQuiet = sources
        .filter((s) => s !== source)
        .every((s) => isQuiet(levels[s]));

      if (high && othersQuiet) {
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
