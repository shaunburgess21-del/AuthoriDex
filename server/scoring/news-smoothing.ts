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
