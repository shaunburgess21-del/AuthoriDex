/**
 * Additive crowd fields for GET /api/me/votes.
 *
 * Percents come from counts the handler already grouped (or one
 * batched read for types that had no tally). No per-row queries.
 */

export interface CrowdOptionCount {
  key: string;
  label: string;
  count: number;
}

export interface CrowdOptionPercent {
  key: string;
  label: string;
  percent: number;
}

export interface CrowdShare {
  crowdPercent: number | null;
  optionPercents: CrowdOptionPercent[] | null;
}

const EMPTY_SHARE: CrowdShare = { crowdPercent: null, optionPercents: null };

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/**
 * Integer percents from a tally. The user's share is the option whose
 * key matches `userKey`. An empty tally stays null so the client can
 * keep the previous card.
 */
export function crowdSharesFromCounts(
  options: readonly CrowdOptionCount[],
  userKey: string | null,
): CrowdShare {
  const counts = options.map((option) => ({
    key: option.key,
    label: option.label,
    count: safeCount(option.count),
  }));
  const total = counts.reduce((sum, option) => sum + option.count, 0);
  if (total <= 0) return EMPTY_SHARE;
  const optionPercents = counts.map((option) => ({
    key: option.key,
    label: option.label,
    percent: Math.round((option.count / total) * 100),
  }));
  const user = userKey ? optionPercents.find((option) => option.key === userKey) : undefined;
  return {
    crowdPercent: user ? user.percent : null,
    optionPercents,
  };
}

export interface LabeledPercent {
  key: string;
  label: string;
  percent: number | null | undefined;
}

/**
 * Sentiment and value votes already store display percents on
 * celebrity_metrics. Pass those through; don't recompute them.
 */
export function crowdSharesFromPercents(
  options: readonly LabeledPercent[],
  userKey: string | null,
): CrowdShare {
  const optionPercents: CrowdOptionPercent[] = [];
  for (const option of options) {
    if (option.percent == null || !Number.isFinite(option.percent)) continue;
    optionPercents.push({
      key: option.key,
      label: option.label,
      percent: Math.max(0, Math.min(100, Math.round(option.percent))),
    });
  }
  if (optionPercents.length === 0 || optionPercents.every((option) => option.percent <= 0)) {
    return EMPTY_SHARE;
  }
  const user = userKey ? optionPercents.find((option) => option.key === userKey) : undefined;
  return {
    crowdPercent: user ? user.percent : null,
    optionPercents,
  };
}

/** Bucket share for a 1–5 rating. `counts` is index 0 = rating 1. */
export function ratingBucketShare(
  counts: readonly number[] | null | undefined,
  rating: number | null | undefined,
): CrowdShare {
  if (!counts || counts.length === 0) return EMPTY_SHARE;
  const labels = ["Hate", "Dislike", "Neutral", "Like", "Love"];
  const options = counts.map((count, index) => ({
    key: String(index + 1),
    label: labels[index] ?? String(index + 1),
    count,
  }));
  const userKey = rating != null && Number.isFinite(rating) ? String(Math.round(rating)) : null;
  return crowdSharesFromCounts(options, userKey);
}
