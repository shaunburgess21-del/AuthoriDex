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

/**
 * Soft residual threshold (2%) used ONLY for the advisory recommendation.
 * Deliberately lower than OTHER_OUTCOME_RESIDUAL_THRESHOLD (which gates the
 * automatic import) so the scout still *suggests* an Other in borderline
 * cases where it won't auto-add one.
 */
export const OTHER_OUTCOME_ADVICE_RESIDUAL_THRESHOLD = 0.02;

/**
 * Placeholder outcome slots Polymarket parks in an augmented negRisk event
 * (e.g. "Movie B", "Person A", "Team 1"). Their presence is a strong signal
 * that the field is open-ended and should carry an "Other" catch-all.
 * Word-bounded so real names ("Movie Night", "Person of Interest") don't match.
 */
export function isPlaceholderOutcomeLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return /^(movie|person|team|candidate|player|option|choice|entry|contestant|nominee|driver|horse)\s+[a-z0-9]{1,3}$/.test(
    normalized,
  );
}

/** Which signal drove an Other-outcome recommendation. */
export type OtherOutcomeAdviceSignal = "augmented_negrisk" | "residual" | "semantic";

/** Structured advice on whether a multi market should carry an "Other". */
export interface OtherOutcomeAdvice {
  /** True when we recommend the market carry an "Other" catch-all. */
  recommended: boolean;
  /** Whether an Other-style outcome is already present in the field. */
  hasOther: boolean;
  /** Short, admin-facing rationale. */
  reason: string;
  /** Which signal drove the recommendation (present when recommended). */
  signal?: OtherOutcomeAdviceSignal;
  /** 1 − Σ named prices, when price data was available. */
  residual?: number;
  /** Count of dormant placeholder slots on the source (augmented negRisk). */
  placeholderCount?: number;
}

/** Superlative + open-scope title patterns that usually warrant an "Other". */
function looksLikeOpenFieldTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (!t) return false;
  const superlative = /\b(biggest|highest|largest|most|top|best|first|win|wins|winner)\b/.test(t);
  const openScope = /\b(which|who|what)\b/.test(t);
  return superlative && openScope;
}

/**
 * Decide whether a multi-outcome market should carry an "Other" catch-all.
 * Pure + shared so the importer, the scout, and the admin modal all agree.
 * Price/negRisk signals are optional — the client can call this with only
 * labels + title (semantic-only) for manually-built markets.
 */
export function computeOtherOutcomeAdvice(args: {
  structure?: "binary" | "multi" | "updown" | string | null;
  entryLabels: Array<string | null | undefined>;
  /** Σ of named (non-Other) source prices, in [0, ~1]. */
  namedPriceSum?: number | null;
  /** Source uses augmented negRisk (explicit Other or placeholder slots). */
  augmentedNegRisk?: boolean;
  hasExplicitOther?: boolean;
  placeholderCount?: number;
  title?: string | null;
}): OtherOutcomeAdvice {
  const labels = args.entryLabels ?? [];
  const hasOther = labels.some((l) => isOtherStyleOutcomeLabel(l));
  const namedCount = labels.filter(
    (l) => (l ?? "").trim() && !isOtherStyleOutcomeLabel(l),
  ).length;

  const residual =
    typeof args.namedPriceSum === "number" && Number.isFinite(args.namedPriceSum)
      ? Math.max(0, Math.min(1, 1 - args.namedPriceSum))
      : undefined;

  const base: OtherOutcomeAdvice = {
    recommended: false,
    hasOther,
    reason: "",
    residual,
    placeholderCount: args.placeholderCount,
  };

  if (args.structure === "binary" || args.structure === "updown" || namedCount < 3) {
    return { ...base, reason: "Not applicable to binary / small-field markets." };
  }
  if (hasOther) {
    return { ...base, reason: "A catch-all outcome is already present." };
  }

  const placeholderCount = args.placeholderCount ?? 0;
  if (args.augmentedNegRisk || args.hasExplicitOther || placeholderCount > 0) {
    const bits: string[] = [];
    if (args.hasExplicitOther) bits.push('an explicit "Other"');
    if (placeholderCount > 0) {
      bits.push(`${placeholderCount} placeholder slot${placeholderCount === 1 ? "" : "s"}`);
    }
    const detail = bits.length ? ` (source carries ${bits.join(" + ")})` : "";
    return {
      ...base,
      recommended: true,
      signal: "augmented_negrisk",
      reason: `Polymarket runs this as an open field${detail} — add an "Other" so an unlisted winner still settles cleanly instead of voiding.`,
    };
  }

  if (residual !== undefined && residual >= OTHER_OUTCOME_ADVICE_RESIDUAL_THRESHOLD) {
    const coverPct = Math.round((1 - residual) * 100);
    const gapPct = Math.round(residual * 100);
    return {
      ...base,
      recommended: true,
      signal: "residual",
      reason: `Listed options cover ~${coverPct}% of the book; ~${gapPct}% sits outside them. An "Other" avoids a void if none of the named win.`,
    };
  }

  // Semantic title signal is a weak heuristic — only trust it when we have NO
  // price data. If prices exist and the field is exhaustive (residual below
  // the advice threshold), the book is authoritative: don't nag.
  if (residual === undefined && args.title && looksLikeOpenFieldTitle(args.title)) {
    return {
      ...base,
      recommended: true,
      signal: "semantic",
      reason: 'This reads like an open-ended "which/who will…" field — consider an "Other" in case a contender outside the list wins.',
    };
  }

  return { ...base, reason: "Listed options look complete — an \"Other\" isn't needed." };
}
