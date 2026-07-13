/**
 * Catch-all / residual outcome helpers for multi-outcome World Markets.
 *
 * Polymarket (and VoxDex) markets are single-winner. When the named
 * outcomes are a non-exhaustive set, we append an "Other" entry so the
 * market can still settle cleanly when no listed name wins — instead of
 * forcing a void.
 */

/** Canonical label used when the scout synthesizes a residual outcome. */
export const OTHER_OUTCOME_LABEL = "Other";

/**
 * Minimum residual probability (1 − Σ named prices) before we auto-append
 * an "Other" outcome at import. Below this the named set is treated as
 * exhaustive enough (e.g. Love Island women after the field locked in).
 */
export const OTHER_OUTCOME_RESIDUAL_THRESHOLD = 0.03;

/**
 * True when a label is an explicit catch-all ("Other", "None of the listed",
 * "The Field"). Deliberately avoids substring matches like `includes("field")`
 * which false-positive on contestant names (Greenfield, Midfield, Fielding).
 */
export function isOtherStyleOutcomeLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? "").trim().toLowerCase();
  if (!normalized) return false;

  if (
    normalized === "other" ||
    normalized === "field" ||
    normalized === "the field" ||
    normalized === "none of the listed" ||
    normalized === "none of the above" ||
    normalized === "none of these"
  ) {
    return true;
  }

  // "Other candidates", "Someone other" — word-bounded, not mid-name.
  if (
    normalized.startsWith("other ") ||
    normalized.endsWith(" other") ||
    normalized.includes(" other ")
  ) {
    return true;
  }

  if (normalized.startsWith("none of the ")) {
    return true;
  }

  return false;
}
