// Pure DataForSEO Content Analysis sentiment helpers (no DB / API deps).

/** Weekly refresh — sentiment is a slow-moving corpus aggregate. */
export const SENTIMENT_FETCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Persisted sentinel for methodology cutover / routes freshness gate.
 *  v2: per-request fetch (v1 batched 100 tasks/POST but summary/live is
 *  single-task, so v1 only ever covered the first person per chunk).
 *  v3: English-only corpus (initial_dataset_filters language="en") to match
 *  our western-English audience; bump forces a clean full re-fetch. */
export const WEB_SENTIMENT_METHOD = "summary_pos_over_posneg_v3";

/** Window label persisted on snapshots; also part of the cache key, so changing
 *  it invalidates pre-English-filter cached readings. English-only lifetime corpus. */
export const WEB_SENTIMENT_WINDOW = "lifetime_en";

/** Minimum opinionated citations (pos+neg) before we surface a headline %. */
export const WEB_SENTIMENT_MIN_OPINIONATED = 50;

/** Minimum total citations (pos+neg+neutral) to show the bar without a headline %. */
export const WEB_SENTIMENT_MIN_MENTIONS = 100;

export interface SentimentCounts {
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

export interface WebSentimentReading extends SentimentCounts {
  positivePct: number | null;
}

/**
 * Whether ingest should call Content Analysis this cycle.
 * `lastFetchAt` is the latest real fetch time, not carry-forward snapshot time.
 */
export function shouldFetchWebSentiment(
  lastFetchAt: Date | null,
  nowMs = Date.now(),
  intervalMs = SENTIMENT_FETCH_INTERVAL_MS,
): boolean {
  if (lastFetchAt == null) return true;
  const lastMs = lastFetchAt.getTime();
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMs;
}

/** Parse one summary/live task → citation counts. */
export function parseSentimentSummaryTask(task: unknown): SentimentCounts | null {
  const t = task as {
    status_code?: number;
    result?: Array<{
      connotation_types?: { positive?: number; negative?: number; neutral?: number };
      total_count?: number;
    }>;
  };
  if (t?.status_code !== 20000) return null;

  const result = t.result?.[0];
  const ct = result?.connotation_types;
  if (!ct) return null;

  const positive = Math.max(0, Number(ct.positive ?? 0));
  const negative = Math.max(0, Number(ct.negative ?? 0));
  const neutral = Math.max(0, Number(ct.neutral ?? 0));
  const total =
    Number.isFinite(result?.total_count) && (result!.total_count ?? 0) > 0
      ? Number(result!.total_count)
      : positive + negative + neutral;

  return { positive, negative, neutral, total };
}

/** Organic headline: positive / (positive + negative). Neutral excluded. */
export function computePositivePct(positive: number, negative: number): number | null {
  const pos = Number(positive);
  const neg = Number(negative);
  if (!Number.isFinite(pos) || !Number.isFinite(neg)) return null;
  const opinionated = pos + neg;
  if (opinionated < WEB_SENTIMENT_MIN_OPINIONATED) return null;
  return Math.round((pos / opinionated) * 100);
}

export function webSentimentReadingFromCounts(counts: SentimentCounts): WebSentimentReading {
  return {
    ...counts,
    positivePct: computePositivePct(counts.positive, counts.negative),
  };
}

/** Level tiers for UI (higher positivePct = more positive press). */
export function webSentimentLevel(positivePct: number | null): "none" | "low" | "medium" | "high" {
  if (positivePct == null || !Number.isFinite(positivePct)) return "none";
  if (positivePct < 40) return "low";
  if (positivePct < 60) return "medium";
  return "high";
}
