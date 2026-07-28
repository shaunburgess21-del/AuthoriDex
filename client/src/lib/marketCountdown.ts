/**
 * Shared market countdown labels for Predict cards and My Predictions.
 * Returns "Closed" once the cutoff has passed so the badge never
 * contradicts a Closed CTA.
 */

export type MarketCountdown = {
  /** Human label, e.g. "3d left", "2h left", "45m left", "Closed". */
  label: string;
  /** True when under one hour remains (and not yet closed). */
  isUrgent: boolean;
};

/**
 * Format a countdown to an ISO/date cutoff.
 * Empty / invalid input returns `{ label: "", isUrgent: false }`.
 */
export function formatMarketCountdown(
  iso: string | Date | null | undefined,
  nowMs: number = Date.now(),
): MarketCountdown {
  if (iso == null || iso === "") {
    return { label: "", isUrgent: false };
  }
  const end = typeof iso === "string" || iso instanceof Date
    ? new Date(iso).getTime()
    : Number.NaN;
  if (Number.isNaN(end)) {
    return { label: "", isUrgent: false };
  }
  const diff = end - nowMs;
  if (diff <= 0) {
    return { label: "Closed", isUrgent: false };
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return { label: `${minutes}m left`, isUrgent: true };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { label: `${hours}h left`, isUrgent: false };
  }
  const days = Math.floor(hours / 24);
  return { label: `${days}d left`, isUrgent: false };
}

/**
 * Back-compat string helper (MyPredictionCard and similar call sites).
 * Prefer `formatMarketCountdown` when you need the urgency flag.
 */
export function formatCountdown(iso: string): string {
  return formatMarketCountdown(iso).label;
}
