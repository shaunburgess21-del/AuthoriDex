/**
 * Pure helpers for healthy-path vs degraded news smoothing (ingest.ts).
 */

export type NewsHealthState = "HEALTHY" | "RECOVERY" | "DEGRADED" | "OUTAGE" | string;

export function isNewsProviderHealthyState(state: NewsHealthState): boolean {
  return state === "HEALTHY" || state === "RECOVERY";
}

/** 24h decay-floor applies only on outage/degraded/fallback paths. */
export function shouldApplyNews24hDecayFloor(opts: {
  newsNeedsOutageFallback: boolean;
  newsUsedFallback: boolean;
  newsHealthState: NewsHealthState;
}): boolean {
  return (
    opts.newsNeedsOutageFallback ||
    opts.newsUsedFallback ||
    opts.newsHealthState === "OUTAGE" ||
    opts.newsHealthState === "DEGRADED"
  );
}

/** Healthy path: skip 3-tick mean on 24h news_count (use raw/smoothed ingest value). */
export function shouldUseRawNewsCountForScoring(opts: {
  newsHealthState: NewsHealthState;
  newsUsedFallback: boolean;
  newsNeedsOutageFallback: boolean;
}): boolean {
  return (
    isNewsProviderHealthyState(opts.newsHealthState) &&
    !opts.newsUsedFallback &&
    !opts.newsNeedsOutageFallback
  );
}

export type UnionNewsSmoothingMode = "all" | "serper_dominant";

const DEFAULT_UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO = 0.2;

export function isUnionNewsSmoothingEnabled(): boolean {
  return process.env.UNION_NEWS_SMOOTHING_ENABLED === "true";
}

export function getUnionNewsSmoothingMode(): UnionNewsSmoothingMode {
  const raw = (process.env.UNION_NEWS_SMOOTHING_MODE ?? "serper_dominant").trim().toLowerCase();
  return raw === "all" ? "all" : "serper_dominant";
}

export function getUnionNewsSmoothingMediastackRatio(): number {
  const raw = parseFloat(process.env.UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO ?? "");
  if (!Number.isFinite(raw) || raw <= 0 || raw >= 1) {
    return DEFAULT_UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO;
  }
  return raw;
}

/** True when Mediastack contributes little relative to the URL union (Serper-driven count). */
export function isSerperDominantUnionNews(opts: {
  mediastackTotal?: number | null;
  unionCount?: number | null;
  mediastackRatio?: number;
}): boolean {
  const unionCount = opts.unionCount ?? 0;
  if (unionCount <= 0) return false;
  const mediastackTotal = opts.mediastackTotal ?? 0;
  const ratio = opts.mediastackRatio ?? getUnionNewsSmoothingMediastackRatio();
  return mediastackTotal < unionCount * ratio;
}

/**
 * Healthy union path: apply 3-tick smoothing when env-enabled (and mode matches).
 * Degraded paths still smooth via the existing !newsProviderHealthy branch in ingest.
 */
export function shouldSmoothUnionNewsForScoring(opts: {
  newsSource: string;
  newsProviderHealthy: boolean;
  mediastackTotal?: number | null;
  unionCount?: number | null;
}): boolean {
  if (!isUnionNewsSmoothingEnabled()) return false;
  if (!opts.newsProviderHealthy) return false;
  if (opts.newsSource !== "union") return false;

  const mode = getUnionNewsSmoothingMode();
  if (mode === "all") return true;

  return isSerperDominantUnionNews({
    mediastackTotal: opts.mediastackTotal,
    unionCount: opts.unionCount,
  });
}
