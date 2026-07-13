/**
 * Knockout / single-winner World Market helpers.
 *
 * Polymarket soccer fixtures often ship as a 90-minute 1X2 (Team A / Draw /
 * Team B). For knockout ties ("Who will win A vs B?"), VoxDex treats the
 * market as single-winner: the team that advances (incl. extra time /
 * penalties). Draw is not a valid settlement outcome.
 *
 * Group-stage / league fixtures remain draw-eligible 1X2 markets.
 */

/** True when a label is a regulation-time draw/tie outcome. */
export function isDrawStyleOutcomeLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "draw" || normalized === "tie" || normalized === "x") {
    return true;
  }
  // Polymarket groupItemTitle style: "Draw (Norway vs. England)"
  if (normalized.startsWith("draw (") || normalized.startsWith("tie (")) {
    return true;
  }
  return false;
}

/** True when labels look like a classic three-way moneyline with a Draw. */
export function looksLikeThreeWayMoneyline(
  labels: Array<string | null | undefined>,
): boolean {
  if (labels.length !== 3) return false;
  return labels.some((l) => isDrawStyleOutcomeLabel(l));
}

/**
 * Read the single-winner knockout flag from market metadata.
 * Set at scout import when `drawEligible === false`.
 */
export function isSingleWinnerKnockoutMarket(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const m = metadata as Record<string, unknown>;
  if (m.singleWinnerKnockout === true) return true;
  if (m.drawEligible === false) return true;
  return false;
}

/**
 * Indices to keep when stripping Draw from a knockout 1X2 import.
 * Returns null when there is nothing to strip (not a 1X2 with Draw).
 */
export function knockoutKeepIndices(
  labels: Array<string | null | undefined>,
): number[] | null {
  if (!looksLikeThreeWayMoneyline(labels)) return null;
  const keep = labels
    .map((label, i) => ({ label, i }))
    .filter(({ label }) => !isDrawStyleOutcomeLabel(label))
    .map(({ i }) => i);
  // Need exactly two team outcomes remaining.
  if (keep.length !== 2) return null;
  return keep;
}

export interface StripDrawResult<T extends { label: string; price: number }> {
  outcomes: T[];
  labels: string[];
  stripped: boolean;
}

/**
 * Drop the Draw row from a knockout 1X2 outcome vector and renormalize
 * remaining prices so they still sum to ~1 for the exhaustiveness guard.
 */
export function stripDrawForKnockoutImport<
  T extends { label: string; price: number },
>(outcomes: T[], labels: string[]): StripDrawResult<T> {
  const keep = knockoutKeepIndices(labels.length === outcomes.length ? labels : outcomes.map((o) => o.label));
  if (!keep) {
    return { outcomes, labels, stripped: false };
  }

  const nextOutcomes = keep.map((i) => outcomes[i]);
  const nextLabels = keep.map((i) => labels[i] ?? outcomes[i].label);
  const sum = nextOutcomes.reduce((s, o) => s + (Number.isFinite(o.price) ? o.price : 0), 0);
  const renormalized =
    sum > 0
      ? nextOutcomes.map((o) => ({
          ...o,
          price: Math.max(0, Math.min(1, o.price / sum)),
        }))
      : nextOutcomes;

  return { outcomes: renormalized, labels: nextLabels, stripped: true };
}

/**
 * Guard used by admin settle routes: refuse Draw as winner on a
 * single-winner knockout market.
 */
export function rejectDrawWinnerOnKnockout(args: {
  metadata: unknown;
  winnerLabel: string | null | undefined;
}): { rejected: true; message: string } | { rejected: false } {
  if (!isSingleWinnerKnockoutMarket(args.metadata)) {
    return { rejected: false };
  }
  if (!isDrawStyleOutcomeLabel(args.winnerLabel)) {
    return { rejected: false };
  }
  return {
    rejected: true,
    message:
      "This is a single-winner knockout market — Draw is not a valid outcome. " +
      "Resolve to the team that advanced (including extra time / penalties).",
  };
}
