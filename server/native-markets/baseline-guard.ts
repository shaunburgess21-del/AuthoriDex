/**
 * Cohort-level anomaly guard for weekly opening baselines.
 *
 * When the Sunday-evening 6h window looks systemically wrong (level anomaly
 * or provider outage fingerprint), the weekly generator falls back to the
 * 7d median for the whole cohort for that week only.
 */

function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function envNumber(value: string | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : fallback;
}

/** Master kill-switch. Default ON — set BASELINE_GUARD_ENABLED=false to disable. */
export const BASELINE_GUARD_ENABLED =
  process.env.BASELINE_GUARD_ENABLED === undefined
    ? true
    : envFlag(process.env.BASELINE_GUARD_ENABLED);

export const BASELINE_GUARD_MIN_RATIO = envNumber(
  process.env.BASELINE_GUARD_MIN_RATIO,
  0.85,
);
export const BASELINE_GUARD_MAX_RATIO = envNumber(
  process.env.BASELINE_GUARD_MAX_RATIO,
  1.15,
);
export const BASELINE_GUARD_DARK_SHARE = envNumber(
  process.env.BASELINE_GUARD_DARK_SHARE,
  0.5,
);
export const BASELINE_GUARD_MIN_COHORT = Math.max(
  1,
  Math.floor(envNumber(process.env.BASELINE_GUARD_MIN_COHORT, 20)),
);

export type BaselineGuardPersonInput = {
  personId: string;
  /** 6h median / 7d median; only set when both medians exist and 7d > 0. */
  ratio6hTo7d?: number;
  /** True when MAX(news_count) across the 6h window is 0. */
  newsDark?: boolean;
  /** True when MAX(wiki_pageviews) across the 6h window is 0. */
  wikiDark?: boolean;
};

export type BaselineGuardReason =
  | "disabled"
  | "cohort_too_small"
  | "ratio_below_min"
  | "ratio_above_max"
  | "news_dark_share"
  | "wiki_dark_share"
  | "pass";

export type BaselineGuardResult = {
  triggered: boolean;
  reason: BaselineGuardReason;
  cohortMedianRatio: number | null;
  newsDarkShare: number | null;
  wikiDarkShare: number | null;
  evaluatedCount: number;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function darkShare(flags: boolean[]): number | null {
  if (flags.length === 0) return null;
  const dark = flags.filter(Boolean).length;
  return dark / flags.length;
}

export type BaselineGuardThresholds = {
  enabled?: boolean;
  minRatio?: number;
  maxRatio?: number;
  darkShare?: number;
  minCohort?: number;
};

/**
 * Pure evaluation — no DB access. Returns `triggered: true` when the cohort
 * should use 7d-median baselines instead of 6h-median for this week.
 */
export function evaluateBaselineCohortGuard(
  people: BaselineGuardPersonInput[],
  thresholds: BaselineGuardThresholds = {},
): BaselineGuardResult {
  const enabled = thresholds.enabled ?? BASELINE_GUARD_ENABLED;
  const minRatio = thresholds.minRatio ?? BASELINE_GUARD_MIN_RATIO;
  const maxRatio = thresholds.maxRatio ?? BASELINE_GUARD_MAX_RATIO;
  const darkShareThreshold = thresholds.darkShare ?? BASELINE_GUARD_DARK_SHARE;
  const minCohort = thresholds.minCohort ?? BASELINE_GUARD_MIN_COHORT;

  if (!enabled) {
    return {
      triggered: false,
      reason: "disabled",
      cohortMedianRatio: null,
      newsDarkShare: null,
      wikiDarkShare: null,
      evaluatedCount: people.length,
    };
  }

  const withRatio = people.filter(
    (p) => p.ratio6hTo7d != null && Number.isFinite(p.ratio6hTo7d),
  );
  const withNews = people.filter((p) => p.newsDark != null);
  const withWiki = people.filter((p) => p.wikiDark != null);

  const evaluable = new Set([
    ...withRatio.map((p) => p.personId),
    ...withNews.map((p) => p.personId),
    ...withWiki.map((p) => p.personId),
  ]);

  if (evaluable.size < minCohort) {
    return {
      triggered: false,
      reason: "cohort_too_small",
      cohortMedianRatio: median(withRatio.map((p) => p.ratio6hTo7d!)),
      newsDarkShare: darkShare(withNews.map((p) => p.newsDark!)),
      wikiDarkShare: darkShare(withWiki.map((p) => p.wikiDark!)),
      evaluatedCount: evaluable.size,
    };
  }

  const cohortMedianRatio = median(withRatio.map((p) => p.ratio6hTo7d!));
  const newsDarkShareVal = darkShare(withNews.map((p) => p.newsDark!));
  const wikiDarkShareVal = darkShare(withWiki.map((p) => p.wikiDark!));

  if (cohortMedianRatio != null && cohortMedianRatio < minRatio) {
    return {
      triggered: true,
      reason: "ratio_below_min",
      cohortMedianRatio,
      newsDarkShare: newsDarkShareVal,
      wikiDarkShare: wikiDarkShareVal,
      evaluatedCount: evaluable.size,
    };
  }

  if (cohortMedianRatio != null && cohortMedianRatio > maxRatio) {
    return {
      triggered: true,
      reason: "ratio_above_max",
      cohortMedianRatio,
      newsDarkShare: newsDarkShareVal,
      wikiDarkShare: wikiDarkShareVal,
      evaluatedCount: evaluable.size,
    };
  }

  if (newsDarkShareVal != null && newsDarkShareVal > darkShareThreshold) {
    return {
      triggered: true,
      reason: "news_dark_share",
      cohortMedianRatio,
      newsDarkShare: newsDarkShareVal,
      wikiDarkShare: wikiDarkShareVal,
      evaluatedCount: evaluable.size,
    };
  }

  if (wikiDarkShareVal != null && wikiDarkShareVal > darkShareThreshold) {
    return {
      triggered: true,
      reason: "wiki_dark_share",
      cohortMedianRatio,
      newsDarkShare: newsDarkShareVal,
      wikiDarkShare: wikiDarkShareVal,
      evaluatedCount: evaluable.size,
    };
  }

  return {
    triggered: false,
    reason: "pass",
    cohortMedianRatio,
    newsDarkShare: newsDarkShareVal,
    wikiDarkShare: wikiDarkShareVal,
    evaluatedCount: evaluable.size,
  };
}
