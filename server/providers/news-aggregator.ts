/**
 * Multi-source news aggregator.
 *
 * Parallel-fetches Mediastack, Currents, GDELT, and Serper News for every person, then
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
import { gdeltUnionAttributionCount } from "./gdelt-parse";
import type { CascadeNewsSource } from "./cascade-news";
export type { CascadeNewsSource } from "./cascade-news";
export { pickCascadeWinningSource } from "./cascade-news";
import {
  fetchDataForSeoNewsBatch,
  isDataForSeoNewsConfigured,
  type DataForSeoNewsBatchStats,
  type DataForSeoNewsData,
} from "./dataforseo-news";
import {
  fetchSerperNewsBatch24h,
  type SerperNewsCountData,
} from "./serper";
import {
  fetchCurrentsBatch,
  isCurrentsConfigured,
  shouldRefreshCurrents,
  type CurrentsBatchStats,
  type CurrentsNewsData,
} from "./currents";

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
  /** When true, Currents batch uses cache only (cadence / budget throttle). */
  currentsCacheOnly?: boolean;
  /** Currents budget hard-stop flag (for THROTTLED reporting). */
  currentsBudgetThrottled?: boolean;
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
  contributingProviders: Array<"mediastack" | "currents" | "gdelt" | "serper_news">;
  /** Raw per-source counts; useful for diagnostics and baseline-drift tracking. */
  perSourceCounts: {
    mediastack: number;
    currents: number;
    gdelt: number;
    serper: number;
  };
  /** URLs first seen by each provider — shows each provider's unique contribution to unionCount. */
  uniqueContributed: {
    mediastack: number;
    currents: number;
    gdelt: number;
    serper: number;
  };
  /**
   * Legacy-comparable count = what the tier cascade (Mediastack → GDELT → Serper)
   * would have returned in the absence of union mode. Approximate because
   * tier-gates in the ingest pipeline are batch-wide (coverage/quality) rather
   * than per-person; this just models the per-person preference order.
   */
  legacyTieredCount: number;
}

export interface AggregatorProviderSummary {
  attempted: boolean;
  succeeded: boolean;
  peopleWithData: number;
  peopleWithArticles: number;
  elapsedMs: number;
  error?: string;
  /**
   * Mediastack-only: number of cached entries that predate the `articles[]`
   * field (added Apr 2026). Those entries still contribute their paginationTotal
   * count to `finalCount` via the max() operation, but contribute zero URLs to
   * the dedup union. Watch this drop to 0 as the 2h Mediastack cache cycles.
   */
  legacyCacheEntries?: number;
  /**
   * Mediastack-only: people who got nothing because the batch ran in cache-only
   * mode and the cache was empty. Distinct from `succeeded=false`/`error` —
   * this is a self-imposed throttle, not an external failure.
   */
  cacheOnlyEmpty?: number;
  /**
   * Mediastack-only: true when the batch was forced into cache-only mode by
   * the budget hard-stop. Lets the ingest layer report a `THROTTLED` source
   * status instead of a misleading `DEGRADED`.
   */
  budgetThrottled?: boolean;
}

export interface AggregatorStats {
  peopleTotal: number;
  peopleWithAnyData: number;
  providers: {
    mediastack: AggregatorProviderSummary;
    currents: AggregatorProviderSummary;
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
  /** Currents cadence info (refresh vs cache-only). */
  currentsCadence: Awaited<ReturnType<typeof shouldRefreshCurrents>> | null;
  currentsBatchStats: CurrentsBatchStats | null;
}

/**
 * Per-person news payload from cascade mode — shape-compatible with ingest
 * expectations (`articleCount24h`, `topHeadlines`, `delta`, etc.).
 */
export interface CascadeNewsData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  source: CascadeNewsSource;
  paginationTotal: number;
  winningSource: CascadeNewsSource;
  perSourceCounts: {
    currents: number;
    dataforseo: number;
    serper: number;
    gdelt: number;
  };
  contributingProviders: CascadeNewsSource[];
  /** Mirrors articleCount24h for diagnostics readers that expect union fields. */
  unionCount: number;
  mediastackPaginationTotal: number;
  legacyTieredCount: number;
}

export interface CascadeAggregatorStats {
  peopleTotal: number;
  peopleWithAnyData: number;
  peopleCurrentsHit: number;
  peopleDataForSeoHit: number;
  peopleSerperHit: number;
  peopleGdeltHit: number;
  elapsedMs: number;
  providers: {
    currents: AggregatorProviderSummary;
    dataforseo: AggregatorProviderSummary;
    serper: AggregatorProviderSummary;
    gdelt: AggregatorProviderSummary;
  };
}

export interface CascadeAggregatorResult {
  data: Map<string, CascadeNewsData>;
  stats: CascadeAggregatorStats;
  currentsCadence: Awaited<ReturnType<typeof shouldRefreshCurrents>> | null;
  currentsBatchStats: CurrentsBatchStats | null;
  dataforseoBatchStats: DataForSeoNewsBatchStats | null;
  gdeltBatchStats: GdeltBatchStats | null;
}

export interface CascadeAggregatorOptions {
  gdeltCandidates?: Set<string>;
  gdeltIsDegraded?: boolean;
  gdeltTimeBudgetMs?: number;
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
  currents: string[] | undefined,
  serper: string[] | undefined,
  gdelt: string[] | undefined,
  limit = 3,
): string[] {
  // Prefer Mediastack English headlines (if any), then Currents (fresh hourly SLA),
  // then Serper (Google News, usually English), then GDELT (can be any language).
  // Dedup on a normalised title prefix.
  //
  // NOTE on language: when Mediastack widens to a no-language query (languageRelaxed=true),
  // it intentionally returns `topHeadlines: []` so we never surface non-English titles.
  // In that case Serper's English headlines take the first slots automatically, which is
  // why union mode doesn't need the separate english-headline-backfill pass that
  // tiered mode runs in ingest.ts. If Serper also returns nothing, we fall through to
  // GDELT which can include non-English titles — acceptable as a last resort since at
  // that point the person has no English news coverage to show anyway.
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
  if (out.length < limit) for (const h of currents || []) push(h);
  if (out.length < limit) for (const h of serper || []) push(h);
  if (out.length < limit) for (const h of gdelt || []) push(h);

  return out.slice(0, limit);
}

export { gdeltUnionAttributionCount } from "./gdelt-parse";

// ── MAIN AGGREGATOR ─────────────────────────────────────────────────────────

/**
 * GDELT is excluded from the union. Two reasons (confirmed against live data
 * June 2026):
 *   1. Its artlist query has no language filter, so it injects foreign-language
 *      articles (Russian/Arabic/Hindi/Greek/etc.) into an English/US attention
 *      signal where every other provider is scoped to English.
 *   2. Its live contribution is negligible — ~6/162 people had any URLs.
 * Set to true to re-enable. Cascade and tiered modes still use GDELT independently.
 */
const UNION_INCLUDE_GDELT = false;

export async function fetchMultiSourceNewsBatch(
  people: AggregatorPerson[],
  options: AggregatorOptions = {},
): Promise<AggregatorResult> {
  const batchStart = Date.now();
  const peopleCount = people.length;

  const mediastackAvailable = isMediastackConfigured();
  const currentsAvailable = isCurrentsConfigured();
  const rankedPeople = options.peopleSortedByRank ?? people;

  // Kick off all provider batches in parallel. Each uses its own
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

  let currentsCadence: Awaited<ReturnType<typeof shouldRefreshCurrents>> | null = null;
  if (currentsAvailable) {
    try {
      currentsCadence = await shouldRefreshCurrents();
    } catch (err) {
      console.warn("[News Aggregator] Currents cadence check failed:", err);
    }
  }
  const currentsCacheOnly = options.currentsCacheOnly ?? (currentsCadence ? !currentsCadence.shouldRefresh : true);
  const currentsBudgetThrottled = options.currentsBudgetThrottled ?? (currentsCadence?.budgetThrottled ?? false);

  const providerStart = {
    mediastack: Date.now(),
    currents: Date.now(),
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
          budgetThrottled: mediastackCadence?.budgetThrottled ?? false,
        },
      )
    : Promise.resolve(null);

  const gdeltOptions: GdeltBatchOptions = {
    candidates: options.gdeltCandidates,
    timeBudgetMs: options.gdeltTimeBudgetMs ?? 180000,
    isDegraded: options.gdeltIsDegraded ?? false,
  };
  const gdeltPromise = UNION_INCLUDE_GDELT
    ? fetchBatchGdeltNews(
        people.map(p => ({ id: p.id, name: p.name, searchQueryOverride: p.searchQueryOverride })),
        gdeltOptions,
      )
    : Promise.resolve(null);

  // 24h-only Serper variant (7d from Serper when available; ingest prefers history)
  // for faster per-tick completion. Previous: (2, 500ms). Now: (4, 300ms).
  const serperPromise = fetchSerperNewsBatch24h(
    people.map(p => ({ id: p.id, name: p.name })),
    4,
    300,
  );

  const currentsPromise = currentsAvailable
    ? fetchCurrentsBatch(
        people.map(p => ({
          id: p.id,
          name: p.name,
          searchQueryOverride: p.searchQueryOverride,
        })),
        4,
        300,
        { cacheOnly: currentsCacheOnly, budgetThrottled: currentsBudgetThrottled },
      )
    : Promise.resolve(null);

  const [mediastackSettled, currentsSettled, gdeltSettled, serperSettled] = await Promise.allSettled([
    mediastackPromise,
    currentsPromise,
    gdeltPromise,
    serperPromise,
  ]);

  const providerSummary: AggregatorStats["providers"] = {
    mediastack: { attempted: mediastackAvailable, succeeded: false, peopleWithData: 0, peopleWithArticles: 0, elapsedMs: 0 },
    currents: { attempted: currentsAvailable, succeeded: false, peopleWithData: 0, peopleWithArticles: 0, elapsedMs: 0 },
    gdelt: { attempted: UNION_INCLUDE_GDELT, succeeded: false, peopleWithData: 0, peopleWithArticles: 0, elapsedMs: 0 },
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
    // Entries where `articles` is undefined are from cache versions that predate
    // the Apr 2026 articles-field addition. They contribute count via
    // paginationTotal but 0 URLs to the union — should go to 0 as the 2h cache
    // cycles through.
    providerSummary.mediastack.legacyCacheEntries = Array.from(mediastackMap.values())
      .filter(v => v.articles === undefined).length;
    providerSummary.mediastack.cacheOnlyEmpty = mediastackBatchStats.cacheOnlyEmpty;
    providerSummary.mediastack.budgetThrottled = mediastackBatchStats.budgetThrottled;
  } else if (mediastackSettled.status === "rejected") {
    providerSummary.mediastack.error = String(mediastackSettled.reason);
    console.warn("[News Aggregator] Mediastack batch failed:", mediastackSettled.reason);
  }
  providerSummary.mediastack.elapsedMs = Date.now() - providerStart.mediastack;

  // ── Unpack Currents ───────────────────────────────────────────────────
  let currentsMap = new Map<string, CurrentsNewsData>();
  let currentsBatchStats: CurrentsBatchStats | null = null;
  if (currentsSettled.status === "fulfilled" && currentsSettled.value) {
    currentsMap = currentsSettled.value.data;
    currentsBatchStats = currentsSettled.value.stats;
    providerSummary.currents.succeeded = true;
    providerSummary.currents.peopleWithData = currentsMap.size;
    providerSummary.currents.peopleWithArticles = Array.from(currentsMap.values())
      .filter(v => (v.articles?.length ?? 0) > 0).length;
    providerSummary.currents.cacheOnlyEmpty = currentsBatchStats.cacheOnlyEmpty;
    providerSummary.currents.budgetThrottled = currentsBatchStats.budgetThrottled;
  } else if (currentsSettled.status === "rejected") {
    providerSummary.currents.error = String(currentsSettled.reason);
    console.warn("[News Aggregator] Currents batch failed:", currentsSettled.reason);
  }
  providerSummary.currents.elapsedMs = Date.now() - providerStart.currents;

  // ── Unpack GDELT ──────────────────────────────────────────────────────
  let gdeltMap = new Map<string, GdeltNewsData>();
  let gdeltBatchStats: GdeltBatchStats | null = null;
  if (gdeltSettled.status === "fulfilled" && gdeltSettled.value) {
    gdeltMap = gdeltSettled.value.data;
    gdeltBatchStats = gdeltSettled.value.stats;
    providerSummary.gdelt.succeeded = true;
    providerSummary.gdelt.peopleWithData = gdeltMap.size;
    providerSummary.gdelt.peopleWithArticles = Array.from(gdeltMap.values())
      .filter(v => (v.articles?.length ?? 0) > 0).length;
  } else if (gdeltSettled.status === "rejected") {
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
    const cu = currentsMap.get(person.id);
    const gd = gdeltMap.get(person.id);
    const sn = serperMap.get(person.id);

    const hasAny = !!ms || !!cu || !!gd || !!sn;
    if (!hasAny) continue;
    peopleWithAnyData++;

    // Build URL dedup set. Each source's contribution may be missing if
    // the cached entry predates the `articles` field addition — graceful.
    const urlSet = new Set<string>();
    const urlFirstSeenBy = new Map<string, "mediastack" | "currents" | "gdelt" | "serper_news">();
    let perPersonOverlap = 0;

    const addUrls = (
      list: Array<{ url: string; title?: string; publishedAt?: string }> | undefined,
      provider: "mediastack" | "currents" | "gdelt" | "serper_news",
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
    addUrls(cu?.articles, "currents");
    addUrls(gd?.articles, "gdelt");
    addUrls(sn?.articles, "serper_news");

    const unionCount = urlSet.size;
    totalUniqueUrls += unionCount;
    totalOverlappingUrls += perPersonOverlap;
    unionSum += unionCount;

    // Per-source raw counts (what each provider claims independently).
    const gdeltUrlCount = gdeltUnionAttributionCount(gd);
    const perSourceCounts = {
      mediastack: ms?.paginationTotal ?? ms?.articleCount24h ?? 0,
      currents: cu?.articleCount24h ?? 0,
      gdelt: gdeltUrlCount,
      serper: sn?.articleCount24h ?? 0,
    };

    // Attribution: how many unique URLs each provider was first to see. This is
    // what each provider actually added to unionCount (vs just overlapping with
    // what others already had). Sums to unionCount by construction.
    const uniqueContributed = { mediastack: 0, currents: 0, gdelt: 0, serper: 0 };
    for (const provider of urlFirstSeenBy.values()) {
      if (provider === "mediastack") uniqueContributed.mediastack++;
      else if (provider === "currents") uniqueContributed.currents++;
      else if (provider === "gdelt") uniqueContributed.gdelt++;
      else uniqueContributed.serper++;
    }

    // Final count formula: preserve Mediastack's uncapped signal for mega
    // stories (where paginationTotal can be 1000+), but override with union
    // when the union caught articles Mediastack missed.
    const mediastackTotal = perSourceCounts.mediastack;
    // Legacy tiered approximation — models the per-person preference order
    // (Mediastack → GDELT → Serper News) that the tier cascade would have used.
    // Matches the real tier cascade's per-person outcome more closely than the
    // previous max(gdelt, serper) fallback did.
    const legacyTieredCount =
      mediastackTotal > 0
        ? mediastackTotal
        : perSourceCounts.gdelt > 0
          ? perSourceCounts.gdelt
          : perSourceCounts.serper;
    const finalCount = Math.max(mediastackTotal, unionCount);

    if (unionCount > mediastackTotal) peopleUnionBeatsMediastack++;
    if (mediastackTotal > unionCount && mediastackTotal > 0) peopleMediastackBeatsUnion++;

    const gain = finalCount - legacyTieredCount;
    if (gain > 0 && (!biggestGainPerson || gain > (biggestGainPerson.final - biggestGainPerson.legacy))) {
      biggestGainPerson = { name: person.name, legacy: legacyTieredCount, final: finalCount };
    }

    // 7d stats: Serper provides these when available; ingest prefers history-
    // derived 7d. GDELT no longer fetches 7d (throughput under rate limits).
    const count7dCandidates = [sn?.articleCount7d ?? 0];
    const articleCount7d = Math.max(...count7dCandidates, 0);
    const averageDaily7d = articleCount7d / 7;
    const delta = averageDaily7d > 0
      ? (finalCount - averageDaily7d) / averageDaily7d
      : (finalCount > 0 ? 1 : 0);

    const contributingProviders: Array<"mediastack" | "currents" | "gdelt" | "serper_news"> = [];
    if (ms && (ms.articleCount24h > 0 || (ms.articles?.length ?? 0) > 0)) contributingProviders.push("mediastack");
    if (cu && (cu.articleCount24h > 0 || (cu.articles?.length ?? 0) > 0)) contributingProviders.push("currents");
    if (gd && gdeltUrlCount > 0) contributingProviders.push("gdelt");
    if (sn && (sn.articleCount24h > 0 || (sn.articles?.length ?? 0) > 0)) contributingProviders.push("serper_news");

    const topHeadlines = mergeHeadlines(ms?.topHeadlines, cu?.topHeadlines, sn?.topHeadlines, gd?.topHeadlines);

    data.set(person.id, {
      query: ms?.query ?? cu?.query ?? gd?.query ?? sn?.query ?? person.name,
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
      uniqueContributed,
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
  const msLegacy = providerSummary.mediastack.legacyCacheEntries ?? 0;
  const cuEmpty = providerSummary.currents.cacheOnlyEmpty ?? 0;
  console.log(
    `[News Aggregator] Providers: ` +
    `mediastack ${providerSummary.mediastack.succeeded ? "OK" : "FAIL"} (${providerSummary.mediastack.peopleWithData} people, ${providerSummary.mediastack.peopleWithArticles} with URLs, ${(providerSummary.mediastack.elapsedMs / 1000).toFixed(1)}s${msLegacy > 0 ? `, ${msLegacy} legacy cache entries` : ""}), ` +
    `currents ${providerSummary.currents.succeeded ? "OK" : "FAIL"} (${providerSummary.currents.peopleWithData} people, ${providerSummary.currents.peopleWithArticles} with URLs, ${(providerSummary.currents.elapsedMs / 1000).toFixed(1)}s${cuEmpty > 0 ? `, ${cuEmpty} cache-only-empty` : ""}), ` +
    `gdelt ${!providerSummary.gdelt.attempted ? "SKIP" : providerSummary.gdelt.succeeded ? "OK" : "FAIL"} (${providerSummary.gdelt.peopleWithData} people, ${providerSummary.gdelt.peopleWithArticles} with URLs, ${(providerSummary.gdelt.elapsedMs / 1000).toFixed(1)}s), ` +
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
    currentsCadence,
    currentsBatchStats,
  };
}

// ── CASCADE MODE (Currents → DataForSEO → Serper → GDELT) ───────────────────

function emptyProviderSummary(): AggregatorProviderSummary {
  return {
    attempted: false,
    succeeded: false,
    peopleWithData: 0,
    peopleWithArticles: 0,
    elapsedMs: 0,
  };
}

function countFromCurrents(cu: CurrentsNewsData | undefined): number {
  return cu?.articleCount24h ?? 0;
}

function countFromSerper(sn: SerperNewsCountData | undefined): number {
  return sn?.articles?.length ?? sn?.articleCount24h ?? 0;
}

function countFromGdelt(gd: GdeltNewsData | undefined): number {
  return gdeltUnionAttributionCount(gd);
}

function countFromDataForSeo(dfs: DataForSeoNewsData | undefined): number {
  return dfs?.articleCount24h ?? 0;
}

/**
 * Per-person cascade: Currents for all 161; fall through to DataForSEO, Serper,
 * GDELT only when Currents returns exactly 0. First non-zero wins.
 */
export async function fetchCascadeNewsBatch(
  people: AggregatorPerson[],
  options: CascadeAggregatorOptions = {},
): Promise<CascadeAggregatorResult> {
  const batchStart = Date.now();
  const data = new Map<string, CascadeNewsData>();

  const providerSummary = {
    currents: emptyProviderSummary(),
    dataforseo: emptyProviderSummary(),
    serper: emptyProviderSummary(),
    gdelt: emptyProviderSummary(),
  };

  let currentsCadence: Awaited<ReturnType<typeof shouldRefreshCurrents>> | null = null;
  let currentsBatchStats: CurrentsBatchStats | null = null;
  let dataforseoBatchStats: DataForSeoNewsBatchStats | null = null;
  let gdeltBatchStats: GdeltBatchStats | null = null;

  const currentsMap = new Map<string, CurrentsNewsData>();
  const dfsMap = new Map<string, DataForSeoNewsData>();
  const serperMap = new Map<string, SerperNewsCountData>();
  const gdeltMap = new Map<string, GdeltNewsData>();

  // Stage 1 — Currents (full roster)
  const cuStart = Date.now();
  if (isCurrentsConfigured()) {
    providerSummary.currents.attempted = true;
    try {
      currentsCadence = await shouldRefreshCurrents();
    } catch (err) {
      console.warn("[Cascade] Currents cadence check failed:", err);
    }
    const currentsCacheOnly = currentsCadence ? !currentsCadence.shouldRefresh : true;
    const currentsBudgetThrottled = currentsCadence?.budgetThrottled ?? false;

    try {
      const cuResult = await fetchCurrentsBatch(
        people.map((p) => ({
          id: p.id,
          name: p.name,
          searchQueryOverride: p.searchQueryOverride,
        })),
        4,
        300,
        { cacheOnly: currentsCacheOnly, budgetThrottled: currentsBudgetThrottled },
      );
      for (const [id, v] of cuResult.data) currentsMap.set(id, v);
      currentsBatchStats = cuResult.stats;
      providerSummary.currents.succeeded = true;
      providerSummary.currents.peopleWithData = currentsMap.size;
      providerSummary.currents.peopleWithArticles = Array.from(currentsMap.values()).filter(
        (v) => countFromCurrents(v) > 0,
      ).length;
      providerSummary.currents.cacheOnlyEmpty = currentsCacheOnly ? cuResult.stats.cacheOnlyEmpty : 0;
      providerSummary.currents.budgetThrottled = currentsBudgetThrottled;
    } catch (err) {
      providerSummary.currents.error = String(err);
      console.warn("[Cascade] Currents batch failed:", err);
    }
  } else {
    console.warn("[Cascade] Currents not configured — cascade will rely on fallbacks only");
  }
  providerSummary.currents.elapsedMs = Date.now() - cuStart;

  let stillZero = people.filter((p) => countFromCurrents(currentsMap.get(p.id)) === 0);

  // Stage 2 — DataForSEO (Currents misses only)
  const dfsStart = Date.now();
  if (stillZero.length > 0 && isDataForSeoNewsConfigured()) {
    providerSummary.dataforseo.attempted = true;
    try {
      const dfsResult = await fetchDataForSeoNewsBatch(
        stillZero.map((p) => ({
          personId: p.id,
          name: p.name,
          keywordOverride: p.searchQueryOverride,
        })),
      );
      for (const [id, v] of dfsResult.data) dfsMap.set(id, v);
      dataforseoBatchStats = dfsResult.stats;
      providerSummary.dataforseo.succeeded = true;
      providerSummary.dataforseo.peopleWithData = dfsMap.size;
      providerSummary.dataforseo.peopleWithArticles = Array.from(dfsMap.values()).filter(
        (v) => countFromDataForSeo(v) > 0,
      ).length;
      providerSummary.dataforseo.budgetThrottled = dfsResult.stats.budgetThrottled;
    } catch (err) {
      providerSummary.dataforseo.error = String(err);
      console.warn("[Cascade] DataForSEO News batch failed:", err);
    }
  }
  providerSummary.dataforseo.elapsedMs = Date.now() - dfsStart;

  stillZero = stillZero.filter((p) => {
    const cu = countFromCurrents(currentsMap.get(p.id));
    const dfs = countFromDataForSeo(dfsMap.get(p.id));
    return cu === 0 && dfs === 0;
  });

  // Stage 3 — Serper (remaining zeros)
  const snStart = Date.now();
  if (stillZero.length > 0) {
    providerSummary.serper.attempted = true;
    try {
      const snResult = await fetchSerperNewsBatch24h(
        stillZero.map((p) => ({ id: p.id, name: p.name })),
        4,
        300,
      );
      for (const [id, v] of snResult) serperMap.set(id, v);
      providerSummary.serper.succeeded = true;
      providerSummary.serper.peopleWithData = serperMap.size;
      providerSummary.serper.peopleWithArticles = Array.from(serperMap.values()).filter(
        (v) => countFromSerper(v) > 0,
      ).length;
    } catch (err) {
      providerSummary.serper.error = String(err);
      console.warn("[Cascade] Serper News batch failed:", err);
    }
  }
  providerSummary.serper.elapsedMs = Date.now() - snStart;

  stillZero = stillZero.filter((p) => {
    const cu = countFromCurrents(currentsMap.get(p.id));
    const dfs = countFromDataForSeo(dfsMap.get(p.id));
    const sn = countFromSerper(serperMap.get(p.id));
    return cu === 0 && dfs === 0 && sn === 0;
  });

  // Stage 4 — GDELT (last resort)
  const gdStart = Date.now();
  if (stillZero.length > 0) {
    providerSummary.gdelt.attempted = true;
    try {
      const gdResult = await fetchBatchGdeltNews(
        stillZero.map((p) => ({
          id: p.id,
          name: p.name,
          searchQueryOverride: p.searchQueryOverride,
        })),
        {
          candidates: options.gdeltCandidates,
          timeBudgetMs: options.gdeltTimeBudgetMs ?? 180000,
          isDegraded: options.gdeltIsDegraded ?? false,
        },
      );
      for (const [id, v] of gdResult.data) gdeltMap.set(id, v);
      gdeltBatchStats = gdResult.stats;
      providerSummary.gdelt.succeeded = true;
      providerSummary.gdelt.peopleWithData = gdeltMap.size;
      providerSummary.gdelt.peopleWithArticles = Array.from(gdeltMap.values()).filter(
        (v) => countFromGdelt(v) > 0,
      ).length;
    } catch (err) {
      providerSummary.gdelt.error = String(err);
      console.warn("[Cascade] GDELT batch failed:", err);
    }
  }
  providerSummary.gdelt.elapsedMs = Date.now() - gdStart;

  let peopleCurrentsHit = 0;
  let peopleDataForSeoHit = 0;
  let peopleSerperHit = 0;
  let peopleGdeltHit = 0;

  for (const person of people) {
    const cu = currentsMap.get(person.id);
    const dfs = dfsMap.get(person.id);
    const sn = serperMap.get(person.id);
    const gd = gdeltMap.get(person.id);

    const perSourceCounts = {
      currents: countFromCurrents(cu),
      dataforseo: countFromDataForSeo(dfs),
      serper: countFromSerper(sn),
      gdelt: countFromGdelt(gd),
    };

    let winningSource: CascadeNewsSource = "currents";
    let articleCount24h = 0;
    let query = person.name;
    let topHeadlines: string[] = [];
    let delta = 0;

    if (perSourceCounts.currents > 0 && cu) {
      winningSource = "currents";
      articleCount24h = perSourceCounts.currents;
      query = cu.query;
      topHeadlines = cu.topHeadlines;
      delta = cu.delta;
      peopleCurrentsHit++;
    } else if (perSourceCounts.dataforseo > 0 && dfs) {
      winningSource = "dataforseo_news";
      articleCount24h = perSourceCounts.dataforseo;
      query = dfs.query;
      topHeadlines = dfs.topHeadlines;
      delta = dfs.delta;
      peopleDataForSeoHit++;
    } else if (perSourceCounts.serper > 0 && sn) {
      winningSource = "serper_news";
      articleCount24h = perSourceCounts.serper;
      query = sn.query;
      topHeadlines = sn.topHeadlines;
      delta = sn.delta;
      peopleSerperHit++;
    } else if (perSourceCounts.gdelt > 0 && gd) {
      winningSource = "gdelt";
      articleCount24h = perSourceCounts.gdelt;
      query = gd.query;
      topHeadlines = gd.topHeadlines;
      delta = gd.delta;
      peopleGdeltHit++;
    }

    const contributingProviders: CascadeNewsSource[] = [];
    if (perSourceCounts.currents > 0) contributingProviders.push("currents");
    if (perSourceCounts.dataforseo > 0) contributingProviders.push("dataforseo_news");
    if (perSourceCounts.serper > 0) contributingProviders.push("serper_news");
    if (perSourceCounts.gdelt > 0) contributingProviders.push("gdelt");

    data.set(person.id, {
      query,
      articleCount24h,
      articleCount7d: 0,
      averageDaily7d: 0,
      delta,
      topHeadlines,
      source: winningSource,
      paginationTotal: articleCount24h,
      winningSource,
      perSourceCounts,
      contributingProviders,
      unionCount: articleCount24h,
      mediastackPaginationTotal: 0,
      legacyTieredCount: articleCount24h,
    });
  }

  const stats: CascadeAggregatorStats = {
    peopleTotal: people.length,
    peopleWithAnyData: Array.from(data.values()).filter((d) => d.articleCount24h > 0).length,
    peopleCurrentsHit,
    peopleDataForSeoHit,
    peopleSerperHit,
    peopleGdeltHit,
    elapsedMs: Date.now() - batchStart,
    providers: providerSummary,
  };

  console.log(
    `[Cascade] Complete: ${stats.peopleWithAnyData}/${people.length} with news, ` +
      `currents=${peopleCurrentsHit} dfs=${peopleDataForSeoHit} serper=${peopleSerperHit} gdelt=${peopleGdeltHit}, ` +
      `${(stats.elapsedMs / 1000).toFixed(1)}s`,
  );

  return {
    data,
    stats,
    currentsCadence,
    currentsBatchStats,
    dataforseoBatchStats,
    gdeltBatchStats,
  };
}
