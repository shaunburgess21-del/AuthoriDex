/**
 * Multi-source news aggregator.
 *
 * Parallel-fetches Mediastack, GDELT, and Serper News for every person, then
 * builds a URL-deduplicated union count so we don't miss articles any single
 * provider overlooked. Preserves Mediastack's uncapped paginationTotal for
 * mega-stories (where the union of ~100 URLs from each provider would
 * otherwise cap the count).
 *
 * Gated behind NEWS_AGGREGATION_MODE=union. Default `tiered` keeps the legacy
 * sequential fallback chain (Mediastack -> GDELT -> Serper News) unchanged.
 */
import {
  fetchMediastackBatch,
  isMediastackConfigured,
  shouldRefreshMediastack,
  type MediastackBatchStats,
  type MediastackNewsData,
} from "./mediastack";
import {
  fetchBatchGdeltNews,
  type GdeltBatchOptions,
  type GdeltBatchStats,
  type GdeltNewsData,
} from "./gdelt";
import {
  fetchSerperNewsBatch,
  type SerperNewsCountData,
} from "./serper";

export interface AggregatorPerson {
  id: string;
  name: string;
  newsQueryWidened?: string | null;
  searchQueryOverride?: string | null;
}

export interface AggregatorOptions {
  /** Optional candidate filter used by GDELT for prioritisation. */
  gdeltCandidates?: Set<string>;
  /** Optional widen-candidates for Mediastack (usually top-N). */
  mediastackWidenCandidateIds?: Set<string>;
  /** Treat GDELT as degraded (longer cache reuse). */
  gdeltIsDegraded?: boolean;
  /** GDELT per-batch time budget in ms. */
  gdeltTimeBudgetMs?: number;
  /** Ranked people (by leaderboard rank, best first) — passed to Mediastack for widen ordering. */
  peopleSortedByRank?: AggregatorPerson[];
}

/**
 * Aggregated news data returned to the ingest pipeline. Shape is a superset
 * of the existing single-provider return types so downstream code using
 * `articleCount24h`, `paginationTotal`, `topHeadlines` etc. keeps working.
 */
export interface AggregatedNewsData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  source: "union";
  paginationTotal: number;
  languageRelaxed?: boolean;
  /** URL set size after dedup across all contributing providers. */
  unionCount: number;
  /** Mediastack's pagination total (uncapped, can be much larger than returned list). */
  mediastackPaginationTotal: number;
  /** Providers that returned any usable signal for this person (count > 0 or articles > 0). */
  contributingProviders: Array<"mediastack" | "gdelt" | "serper_news">;
  /** Raw per-source counts; useful for diagnostics and baseline-drift tracking. */
  perSourceCounts: {
    mediastack: number;
    gdelt: number;
    serper: number;
  };
  /** Legacy-comparable count = what the tier-1 (Mediastack) count alone would have been. */
  legacyTieredCount: number;
}

export interface AggregatorProviderSummary {
  attempted: boolean;
  succeeded: boolean;
  peopleWithData: number;
  peopleWithArticles: number;
  elapsedMs: number;
  error?: string;
}

export interface AggregatorStats {
  peopleTotal: number;
  peopleWithAnyData: number;
  providers: {
    mediastack: AggregatorProviderSummary;
    gdelt: AggregatorProviderSummary;
    serper: AggregatorProviderSummary;
  };
  /** Total unique article URLs seen across the batch. */
  totalUniqueUrls: number;
  /** Articles seen by 2+ providers (i.e. dedup savings). */
  totalOverlappingUrls: number;
  /** Average URL union count per person (people with any data). */
  avgUnionCount: number;
  /** People where unionCount gave a bigger number than Mediastack alone. */
  peopleUnionBeatsMediastack: number;
  /** People where Mediastack paginationTotal beat union (mega stories). */
  peopleMediastackBeatsUnion: number;
  /** Biggest delta (finalCount - legacyTieredCount) observed, for log spot-check. */
  biggestGainPerson: { name: string; legacy: number; final: number } | null;
  elapsedMs: number;
}

export interface AggregatorResult {
  data: Map<string, AggregatedNewsData>;
  stats: AggregatorStats;
  /** Pass-through Mediastack stats so downstream code that logs these still works. */
  mediastackBatchStats: MediastackBatchStats | null;
  /** Pass-through GDELT stats for the same reason. */
  gdeltBatchStats: GdeltBatchStats | null;
  /** Mediastack cadence info (refresh vs cache-only). */
  mediastackCadence: Awaited<ReturnType<typeof shouldRefreshMediastack>> | null;
}

// ── URL CANONICALIZATION ────────────────────────────────────────────────────

/**
 * Canonicalise an article URL so slight differences between providers collapse
 * to the same key. Examples handled:
 *   https://www.nytimes.com/2026/04/21/tim-cook.html?utm_source=google
 *   http://nytimes.com/2026/04/21/tim-cook.html/
 *   https://nytimes.com/2026/04/21/tim-cook.html#top
 * All three collapse to: nytimes.com/2026/04/21/tim-cook.html
 */
export function canonicalizeArticleUrl(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    if (host.startsWith("m.")) host = host.slice(2);
    if (host.startsWith("amp.")) host = host.slice(4);

    let path = url.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

    const meaningfulParams: string[] = [];
    url.searchParams.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k.startsWith("utm_")) return;
      if (k === "fbclid" || k === "gclid" || k === "msclkid" || k === "ref" || k === "ref_src" || k === "ref_url") return;
      if (k === "source" || k === "amp") return;
      meaningfulParams.push(`${k}=${value}`);
    });
    meaningfulParams.sort();
    const search = meaningfulParams.length > 0 ? `?${meaningfulParams.join("&")}` : "";

    return `${host}${path}${search}`;
  } catch {
    // Not a parseable URL — hash the raw string lowercased as a fallback key.
    return trimmed.toLowerCase();
  }
}

// ── HEADLINE MERGE ──────────────────────────────────────────────────────────

function mergeHeadlines(
  mediastack: string[] | undefined,
  gdelt: string[] | undefined,
  serper: string[] | undefined,
  limit = 3,
): string[] {
  // Prefer Mediastack English headlines (if any), then Serper (Google News, usually English),
  // then GDELT (can be any language). Dedup on a normalised title prefix.
  const out: string[] = [];
  const seen = new Set<string>();
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "").trim().slice(0, 80);

  const push = (s: string | undefined) => {
    if (!s) return;
    const key = normalize(s);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  for (const h of mediastack || []) push(h);
  if (out.length < limit) for (const h of serper || []) push(h);
  if (out.length < limit) for (const h of gdelt || []) push(h);

  return out.slice(0, limit);
}

// ── MAIN AGGREGATOR ─────────────────────────────────────────────────────────

export async function fetchMultiSourceNewsBatch(
  people: AggregatorPerson[],
  options: AggregatorOptions = {},
): Promise<AggregatorResult> {
  const batchStart = Date.now();
  const peopleCount = people.length;

  const mediastackAvailable = isMediastackConfigured();
  const rankedPeople = options.peopleSortedByRank ?? people;

  // Kick off all three provider batches in parallel. Each uses its own
  // error handling; we use allSettled so a single failure doesn't take
  // down the aggregator.
  let mediastackCadence: Awaited<ReturnType<typeof shouldRefreshMediastack>> | null = null;
  if (mediastackAvailable) {
    try {
      mediastackCadence = await shouldRefreshMediastack();
    } catch (err) {
      console.warn("[News Aggregator] Mediastack cadence check failed:", err);
    }
  }
  const mediastackCacheOnly = mediastackCadence ? !mediastackCadence.shouldRefresh : true;

  const providerStart = {
    mediastack: Date.now(),
    gdelt: Date.now(),
    serper: Date.now(),
  };

  const mediastackPromise = mediastackAvailable
    ? fetchMediastackBatch(
        rankedPeople.map(p => ({ id: p.id, name: p.name, newsQueryWidened: p.newsQueryWidened })),
        3,
        400,
        {
          cacheOnly: mediastackCacheOnly,
          widenCandidateIds: mediastackCacheOnly ? undefined : options.mediastackWidenCandidateIds,
        },
      )
    : Promise.resolve(null);

  const gdeltOptions: GdeltBatchOptions = {
    candidates: options.gdeltCandidates,
    timeBudgetMs: options.gdeltTimeBudgetMs ?? 180000,
    isDegraded: options.gdeltIsDegraded ?? false,
  };
  const gdeltPromise = fetchBatchGdeltNews(
    people.map(p => ({ id: p.id, name: p.name, searchQueryOverride: p.searchQueryOverride })),
    gdeltOptions,
  );

  const serperPromise = fetchSerperNewsBatch(
    people.map(p => ({ id: p.id, name: p.name })),
    2,
    500,
  );

  const [mediastackSettled, gdeltSettled, serperSettled] = await Promise.allSettled([
    mediastackPromise,
    gdeltPromise,
    serperPromise,
  ]);

  const providerSummary: AggregatorStats["providers"] = {
    mediastack: { attempted: mediastackAvailable, succeeded: false, peopleWithData: 0, peopleWithArticles: 0, elapsedMs: 0 },
    gdelt: { attempted: true, succeeded: false, peopleWithData: 0, peopleWithArticles: 0, elapsedMs: 0 },
    serper: { attempted: true, succeeded: false, peopleWithData: 0, peopleWithArticles: 0, elapsedMs: 0 },
  };

  // ── Unpack Mediastack ─────────────────────────────────────────────────
  let mediastackMap = new Map<string, MediastackNewsData>();
  let mediastackBatchStats: MediastackBatchStats | null = null;
  if (mediastackSettled.status === "fulfilled" && mediastackSettled.value) {
    mediastackMap = mediastackSettled.value.data;
    mediastackBatchStats = mediastackSettled.value.stats;
    providerSummary.mediastack.succeeded = true;
    providerSummary.mediastack.peopleWithData = mediastackMap.size;
    providerSummary.mediastack.peopleWithArticles = Array.from(mediastackMap.values())
      .filter(v => (v.articles?.length ?? 0) > 0).length;
  } else if (mediastackSettled.status === "rejected") {
    providerSummary.mediastack.error = String(mediastackSettled.reason);
    console.warn("[News Aggregator] Mediastack batch failed:", mediastackSettled.reason);
  }
  providerSummary.mediastack.elapsedMs = Date.now() - providerStart.mediastack;

  // ── Unpack GDELT ──────────────────────────────────────────────────────
  let gdeltMap = new Map<string, GdeltNewsData>();
  let gdeltBatchStats: GdeltBatchStats | null = null;
  if (gdeltSettled.status === "fulfilled") {
    gdeltMap = gdeltSettled.value.data;
    gdeltBatchStats = gdeltSettled.value.stats;
    providerSummary.gdelt.succeeded = true;
    providerSummary.gdelt.peopleWithData = gdeltMap.size;
    providerSummary.gdelt.peopleWithArticles = Array.from(gdeltMap.values())
      .filter(v => (v.articles?.length ?? 0) > 0).length;
  } else {
    providerSummary.gdelt.error = String(gdeltSettled.reason);
    console.warn("[News Aggregator] GDELT batch failed:", gdeltSettled.reason);
  }
  providerSummary.gdelt.elapsedMs = Date.now() - providerStart.gdelt;

  // ── Unpack Serper News ────────────────────────────────────────────────
  let serperMap = new Map<string, SerperNewsCountData>();
  if (serperSettled.status === "fulfilled") {
    serperMap = serperSettled.value;
    providerSummary.serper.succeeded = true;
    providerSummary.serper.peopleWithData = serperMap.size;
    providerSummary.serper.peopleWithArticles = Array.from(serperMap.values())
      .filter(v => (v.articles?.length ?? 0) > 0).length;
  } else {
    providerSummary.serper.error = String(serperSettled.reason);
    console.warn("[News Aggregator] Serper News batch failed:", serperSettled.reason);
  }
  providerSummary.serper.elapsedMs = Date.now() - providerStart.serper;

  // ── Fuse per-person ───────────────────────────────────────────────────
  const data = new Map<string, AggregatedNewsData>();
  let totalUniqueUrls = 0;
  let totalOverlappingUrls = 0;
  let unionSum = 0;
  let peopleWithAnyData = 0;
  let peopleUnionBeatsMediastack = 0;
  let peopleMediastackBeatsUnion = 0;
  let biggestGainPerson: AggregatorStats["biggestGainPerson"] = null;

  for (const person of people) {
    const ms = mediastackMap.get(person.id);
    const gd = gdeltMap.get(person.id);
    const sn = serperMap.get(person.id);

    const hasAny = !!ms || !!gd || !!sn;
    if (!hasAny) continue;
    peopleWithAnyData++;

    // Build URL dedup set. Each source's contribution may be missing if
    // the cached entry predates the `articles` field addition — graceful.
    const urlSet = new Set<string>();
    const urlFirstSeenBy = new Map<string, "mediastack" | "gdelt" | "serper_news">();
    let perPersonOverlap = 0;

    const addUrls = (
      list: Array<{ url: string; title?: string; publishedAt?: string }> | undefined,
      provider: "mediastack" | "gdelt" | "serper_news",
    ) => {
      if (!list) return;
      for (const a of list) {
        const key = canonicalizeArticleUrl(a.url);
        if (!key) continue;
        if (urlSet.has(key)) {
          perPersonOverlap++;
          continue;
        }
        urlSet.add(key);
        urlFirstSeenBy.set(key, provider);
      }
    };
    addUrls(ms?.articles, "mediastack");
    addUrls(gd?.articles, "gdelt");
    addUrls(sn?.articles, "serper_news");

    const unionCount = urlSet.size;
    totalUniqueUrls += unionCount;
    totalOverlappingUrls += perPersonOverlap;
    unionSum += unionCount;

    // Per-source raw counts (what each provider claims independently).
    const perSourceCounts = {
      mediastack: ms?.paginationTotal ?? ms?.articleCount24h ?? 0,
      gdelt: gd?.articleCount24h ?? 0,
      serper: sn?.articleCount24h ?? 0,
    };

    // Final count formula: preserve Mediastack's uncapped signal for mega
    // stories (where paginationTotal can be 1000+), but override with union
    // when the union caught articles Mediastack missed.
    const mediastackTotal = perSourceCounts.mediastack;
    const legacyTieredCount = mediastackTotal > 0 ? mediastackTotal : Math.max(perSourceCounts.gdelt, perSourceCounts.serper);
    const finalCount = Math.max(mediastackTotal, unionCount);

    if (unionCount > mediastackTotal) peopleUnionBeatsMediastack++;
    if (mediastackTotal > unionCount && mediastackTotal > 0) peopleMediastackBeatsUnion++;

    const gain = finalCount - legacyTieredCount;
    if (gain > 0 && (!biggestGainPerson || gain > (biggestGainPerson.final - biggestGainPerson.legacy))) {
      biggestGainPerson = { name: person.name, legacy: legacyTieredCount, final: finalCount };
    }

    // 7d stats: GDELT/Serper provide these, Mediastack hardcodes 0. Pick the
    // largest non-zero as the 7d signal (Serper multiplies by 2.5 already).
    const count7dCandidates = [
      gd?.articleCount7d ?? 0,
      sn?.articleCount7d ?? 0,
    ];
    const articleCount7d = Math.max(...count7dCandidates, 0);
    const averageDaily7d = articleCount7d / 7;
    const delta = averageDaily7d > 0
      ? (finalCount - averageDaily7d) / averageDaily7d
      : (finalCount > 0 ? 1 : 0);

    const contributingProviders: Array<"mediastack" | "gdelt" | "serper_news"> = [];
    if (ms && (ms.articleCount24h > 0 || (ms.articles?.length ?? 0) > 0)) contributingProviders.push("mediastack");
    if (gd && (gd.articleCount24h > 0 || (gd.articles?.length ?? 0) > 0)) contributingProviders.push("gdelt");
    if (sn && (sn.articleCount24h > 0 || (sn.articles?.length ?? 0) > 0)) contributingProviders.push("serper_news");

    const topHeadlines = mergeHeadlines(ms?.topHeadlines, gd?.topHeadlines, sn?.topHeadlines);

    data.set(person.id, {
      query: ms?.query ?? gd?.query ?? sn?.query ?? person.name,
      articleCount24h: finalCount,
      articleCount7d,
      averageDaily7d,
      delta,
      topHeadlines,
      source: "union",
      paginationTotal: finalCount,
      languageRelaxed: ms?.languageRelaxed === true,
      unionCount,
      mediastackPaginationTotal: mediastackTotal,
      contributingProviders,
      perSourceCounts,
      legacyTieredCount,
    });
  }

  const stats: AggregatorStats = {
    peopleTotal: peopleCount,
    peopleWithAnyData,
    providers: providerSummary,
    totalUniqueUrls,
    totalOverlappingUrls,
    avgUnionCount: peopleWithAnyData > 0 ? unionSum / peopleWithAnyData : 0,
    peopleUnionBeatsMediastack,
    peopleMediastackBeatsUnion,
    biggestGainPerson,
    elapsedMs: Date.now() - batchStart,
  };

  const overlapPct = totalUniqueUrls > 0
    ? ((totalOverlappingUrls / (totalUniqueUrls + totalOverlappingUrls)) * 100).toFixed(1)
    : "0.0";
  console.log(
    `[News Aggregator] Batch complete: ${peopleWithAnyData}/${peopleCount} people with data, ` +
    `${totalUniqueUrls} unique URLs (${totalOverlappingUrls} overlapping, ${overlapPct}% dedup rate), ` +
    `avgUnion=${stats.avgUnionCount.toFixed(1)}, unionBeats=${peopleUnionBeatsMediastack}, ` +
    `msBeats=${peopleMediastackBeatsUnion}, elapsed=${(stats.elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log(
    `[News Aggregator] Providers: ` +
    `mediastack ${providerSummary.mediastack.succeeded ? "OK" : "FAIL"} (${providerSummary.mediastack.peopleWithData} people, ${providerSummary.mediastack.peopleWithArticles} with URLs, ${(providerSummary.mediastack.elapsedMs / 1000).toFixed(1)}s), ` +
    `gdelt ${providerSummary.gdelt.succeeded ? "OK" : "FAIL"} (${providerSummary.gdelt.peopleWithData} people, ${providerSummary.gdelt.peopleWithArticles} with URLs, ${(providerSummary.gdelt.elapsedMs / 1000).toFixed(1)}s), ` +
    `serper ${providerSummary.serper.succeeded ? "OK" : "FAIL"} (${providerSummary.serper.peopleWithData} people, ${providerSummary.serper.peopleWithArticles} with URLs, ${(providerSummary.serper.elapsedMs / 1000).toFixed(1)}s)`,
  );
  if (biggestGainPerson) {
    console.log(`[News Aggregator] Biggest gain: ${biggestGainPerson.name} legacy=${biggestGainPerson.legacy} → final=${biggestGainPerson.final}`);
  }

  return {
    data,
    stats,
    mediastackBatchStats,
    gdeltBatchStats,
    mediastackCadence,
  };
}
