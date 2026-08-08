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
 *
 * Requires a generic noun + a SINGLE trailing letter/digit — matching the
 * real "Movie B"…"Movie O" / "Person A" convention — so genuine short names
 * like "Team USA", "Team GB", or "Person of Interest" are never mistaken for
 * placeholders.
 */
export function isPlaceholderOutcomeLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return /^(movie|person|team|candidate|player|option|choice|entry|contestant|nominee|driver|horse)\s+[a-z0-9]$/.test(
    normalized,
  );
}

// ---------------------------------------------------------------------------
// Cumulative "by <date>" / "reaches <threshold>" ladders
// ---------------------------------------------------------------------------

/**
 * Polymarket runs "when will X happen?" and "how high will Y get?" events as
 * a group of INDEPENDENT Yes/No markets — one per deadline or threshold —
 * whose prices are CUMULATIVE: P("by Aug 15") already contains P("by Jul 17").
 * Only a negRisk event declares its outcomes mutually exclusive.
 *
 * Imported naively as one entry per sub-market, such a ladder produces a
 * market that cannot settle. The rungs are not exclusive, their prices sum
 * above 1, and — fatally — no rung represents "never / below the lowest
 * threshold", which is usually the likeliest outcome. Those markets can only
 * be voided.
 *
 * Detection is deliberately multi-signal, because no single one is safe:
 *   - An over-subscribed book is NOT sufficient. A genuine negRisk field
 *     routinely sums to 1.02-1.13 on bid/ask mid (Emmy nominee categories).
 *   - A monotone label set is NOT sufficient. Exhaustive band partitions
 *     ("<15m | 15-20m | 20-25m | 30m+") look superficially similar but are
 *     mutually exclusive and need no catch-all.
 */
export type LadderSignal =
  | "independent_binaries"
  | "distinct_end_dates"
  | "cumulative_labels"
  | "monotone_prices"
  | "oversubscribed";

export interface CumulativeLadderDetection {
  isLadder: boolean;
  signals: LadderSignal[];
  /** Input indices ordered along the ladder, or null when no order was established. */
  order: number[] | null;
  /** Short, admin-facing rationale. */
  reason: string;
}

/** Σ named prices above this is treated as an over-subscribed book. */
const OVERSUBSCRIBED_THRESHOLD = 1.02;

const LADDER_MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * A range ("15-20m", "$4M-$10M") or an open lower tail ("<15m", "Under $4M")
 * only ever appears in an exhaustive band partition, never in a cumulative
 * ladder. One such label vetoes ladder detection for the whole set.
 */
const LADDER_RANGE_LABEL = /\d\s*(?:[-–—]|\bto\b)\s*\$?\d/;
const LADDER_LOWER_TAIL_LABEL = /^\s*(?:<|under\b|below\b|less\s+than\b)/i;

/**
 * A threshold rung: "↑ 130m", "50+", "30m+", "≥ 107m". Requires an explicit
 * direction marker (↑ / ≥ / trailing +) so plain point values ("25 bps
 * increase", "3.75%") and bare years are never mistaken for a ladder.
 */
const LADDER_THRESHOLD_LABEL =
  /^(?:↑|≥|>=)?\s*\$?(\d+(?:\.\d+)?)\s*(k|m|b|bn)?\s*(\+)?$/i;

const LADDER_DATE_LABEL = /^([a-z]+)\.?\s*(\d{1,2})?(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i;

type RungKind = "date" | "threshold";

interface RungKey {
  kind: RungKind;
  value: number;
  /** True when the label carried an explicit year (date rungs only). */
  explicitYear: boolean;
}

function thresholdMultiplier(unit: string | undefined): number {
  switch ((unit ?? "").toLowerCase()) {
    case "k":
      return 1e3;
    case "m":
      return 1e6;
    case "b":
    case "bn":
      return 1e9;
    default:
      return 1;
  }
}

/** Parse one ladder rung label into a comparable key, or null. */
function parseRungKey(label: string): RungKey | null {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const threshold = LADDER_THRESHOLD_LABEL.exec(trimmed);
  if (threshold) {
    const hasMarker = /^(?:↑|≥|>=)/.test(trimmed) || threshold[3] === "+";
    if (hasMarker) {
      return {
        kind: "threshold",
        value: Number(threshold[1]) * thresholdMultiplier(threshold[2]),
        explicitYear: false,
      };
    }
    return null;
  }

  const date = LADDER_DATE_LABEL.exec(trimmed);
  if (date) {
    const month = LADDER_MONTHS[date[1].toLowerCase()];
    if (month === undefined) return null;
    const day = date[2] ? Number(date[2]) : 1;
    const year = date[3] ? Number(date[3]) : 2000;
    return {
      kind: "date",
      value: Date.UTC(year, month, day),
      explicitYear: !!date[3],
    };
  }

  return null;
}

function isMonotone(values: number[]): boolean {
  let nonDecreasing = true;
  let nonIncreasing = true;
  let changed = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) nonIncreasing = false;
    if (values[i] < values[i - 1]) nonDecreasing = false;
    if (values[i] !== values[i - 1]) changed = true;
  }
  return changed && (nonDecreasing || nonIncreasing);
}

/**
 * Decide whether a multi-outcome source event is a cumulative ladder rather
 * than a mutually-exclusive field. Pure + shared so the importer, the scout
 * advisory, and the admin modal all agree.
 *
 * `mutuallyExclusiveSource` is Polymarket's negRisk flag — the authoritative
 * structural signal. The admin modal has no such flag and passes labels only,
 * where a parsed monotone rung set is enough to advise a catch-all: a
 * hand-built date ladder without one is unresolvable regardless of prices.
 */
export function detectCumulativeLadder(args: {
  labels: Array<string | null | undefined>;
  prices?: Array<number | null | undefined> | null;
  /** Per-outcome source sub-market end date (ISO), when available. */
  sourceEndDates?: Array<string | null | undefined> | null;
  /** Polymarket negRisk: source declares the outcomes mutually exclusive. */
  mutuallyExclusiveSource?: boolean | null;
}): CumulativeLadderDetection {
  const labels = (args.labels ?? []).map((l) => (l ?? "").trim());
  const rungs = labels.filter((l) => l && !isOtherStyleOutcomeLabel(l));
  const none: CumulativeLadderDetection = {
    isLadder: false,
    signals: [],
    order: null,
    reason: "Not a cumulative ladder.",
  };

  if (rungs.length < 2) return none;
  if (rungs.some((l) => LADDER_RANGE_LABEL.test(l) || LADDER_LOWER_TAIL_LABEL.test(l))) {
    return {
      ...none,
      reason: "Range / lower-tail labels — exhaustive band partition, not a ladder.",
    };
  }

  const signals: LadderSignal[] = [];
  if (args.mutuallyExclusiveSource === false) signals.push("independent_binaries");

  // Ordering key: prefer the source sub-market end dates (authoritative, and
  // year-safe), fall back to parsed labels. Only a per-rung-distinct set of
  // end dates can order the ladder; a shared event-level date cannot.
  const rungIndexes = labels
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l && !isOtherStyleOutcomeLabel(l))
    .map(({ i }) => i);

  const endDates = args.sourceEndDates ?? null;
  let order: number[] | null = null;
  if (endDates) {
    const endMsByIndex = new Map<number, number>();
    for (const i of rungIndexes) {
      const raw = endDates[i];
      const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
      if (Number.isFinite(ms)) endMsByIndex.set(i, ms);
    }
    const distinct = new Set(endMsByIndex.values()).size;
    if (endMsByIndex.size === rungIndexes.length && distinct === rungIndexes.length) {
      signals.push("distinct_end_dates");
      order = [...rungIndexes].sort(
        (a, b) => (endMsByIndex.get(a) ?? 0) - (endMsByIndex.get(b) ?? 0),
      );
    }
  }

  const keyByIndex = new Map<number, RungKey>();
  for (const i of rungIndexes) {
    const key = parseRungKey(labels[i]);
    if (key) keyByIndex.set(i, key);
  }
  const parsedKeys = [...keyByIndex.values()];
  const kinds = new Set(parsedKeys.map((k) => k.kind));
  const labelsFormLadder =
    keyByIndex.size === rungIndexes.length &&
    kinds.size === 1 &&
    new Set(parsedKeys.map((k) => k.value)).size === parsedKeys.length;

  if (labelsFormLadder) {
    signals.push("cumulative_labels");
    // Year-less date labels cannot be ordered across a year boundary
    // ("June 30, 2027" sorts before "December 31"), so only trust the label
    // order when the years are consistent.
    const mixedYears =
      kinds.has("date") && new Set(parsedKeys.map((k) => k.explicitYear)).size > 1;
    if (!order && !mixedYears) {
      order = [...rungIndexes].sort(
        (a, b) => (keyByIndex.get(a)?.value ?? 0) - (keyByIndex.get(b)?.value ?? 0),
      );
    }
  }

  const prices = args.prices ?? null;
  let namedSum: number | null = null;
  if (prices) {
    const values = rungIndexes.map((i) => {
      const p = prices[i];
      return typeof p === "number" && Number.isFinite(p) ? p : null;
    });
    if (values.every((v): v is number => v !== null)) {
      namedSum = values.reduce((s, v) => s + v, 0);
      if (namedSum > OVERSUBSCRIBED_THRESHOLD) signals.push("oversubscribed");
      if (order && isMonotone(order.map((i) => prices[i] as number))) {
        signals.push("monotone_prices");
      }
    }
  }

  const structural = signals.includes("independent_binaries");
  const shape =
    signals.includes("cumulative_labels") || signals.includes("distinct_end_dates");
  const priceEvidence =
    signals.includes("monotone_prices") || signals.includes("oversubscribed");

  const isLadder =
    (structural && (shape || priceEvidence)) ||
    (shape && priceEvidence) ||
    (shape && namedSum === null);

  if (!isLadder) return { ...none, signals, order };

  return {
    isLadder: true,
    signals,
    order,
    reason:
      "Source runs this as cumulative \"by date / reaches threshold\" legs, not " +
      "mutually exclusive outcomes — it needs a catch-all for \"neither / never\", " +
      "which is usually the likeliest result.",
  };
}

/** Which signal drove an Other-outcome recommendation. */
export type OtherOutcomeAdviceSignal =
  | "cumulative_ladder"
  | "augmented_negrisk"
  | "residual"
  | "semantic";

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
  /**
   * 1 − Σ named prices, clamped to [0, 1] for display. A cumulative ladder
   * sums ABOVE 1, which clamps to 0 — read `oversubscribed` rather than
   * inferring "field is exhaustive" from a zero residual.
   */
  residual?: number;
  /** Σ named prices as supplied, unclamped, when price data was available. */
  namedPriceSum?: number;
  /** True when Σ named prices exceeds 1 — the outcomes are not exclusive. */
  oversubscribed?: boolean;
  /** Signals behind a cumulative-ladder verdict, for admin traceability. */
  ladderSignals?: LadderSignal[];
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
  /** Σ of named (non-Other) source prices. Above 1 on a cumulative ladder. */
  namedPriceSum?: number | null;
  /** Source uses augmented negRisk (explicit Other or placeholder slots). */
  augmentedNegRisk?: boolean;
  hasExplicitOther?: boolean;
  placeholderCount?: number;
  title?: string | null;
  /** Per-outcome prices / source end dates, for ladder detection. */
  prices?: Array<number | null | undefined> | null;
  sourceEndDates?: Array<string | null | undefined> | null;
  /** Polymarket negRisk: source declares the outcomes mutually exclusive. */
  mutuallyExclusiveSource?: boolean | null;
  /** Detection the importer already ran; re-detected from labels when absent. */
  ladder?: CumulativeLadderDetection | null;
}): OtherOutcomeAdvice {
  const labels = args.entryLabels ?? [];
  const hasOther = labels.some((l) => isOtherStyleOutcomeLabel(l));
  const namedCount = labels.filter(
    (l) => (l ?? "").trim() && !isOtherStyleOutcomeLabel(l),
  ).length;

  const namedPriceSum =
    typeof args.namedPriceSum === "number" && Number.isFinite(args.namedPriceSum)
      ? args.namedPriceSum
      : undefined;
  const residual =
    namedPriceSum !== undefined
      ? Math.max(0, Math.min(1, 1 - namedPriceSum))
      : undefined;
  const oversubscribed =
    namedPriceSum !== undefined ? namedPriceSum > OVERSUBSCRIBED_THRESHOLD : undefined;

  const ladder =
    args.ladder ??
    detectCumulativeLadder({
      labels,
      prices: args.prices,
      sourceEndDates: args.sourceEndDates,
      mutuallyExclusiveSource: args.mutuallyExclusiveSource,
    });

  const base: OtherOutcomeAdvice = {
    recommended: false,
    hasOther,
    reason: "",
    residual,
    namedPriceSum,
    oversubscribed,
    ladderSignals: ladder.signals.length ? ladder.signals : undefined,
    placeholderCount: args.placeholderCount,
  };

  if (args.structure === "binary" || args.structure === "updown") {
    return { ...base, reason: "Not applicable to binary / small-field markets." };
  }
  if (hasOther) {
    return { ...base, reason: "A catch-all outcome is already present." };
  }

  // Before the small-field guard: a two-rung ladder ("September Meeting |
  // October Meeting") is just as unresolvable as a four-rung one.
  if (ladder.isLadder) {
    return {
      ...base,
      recommended: true,
      signal: "cumulative_ladder",
      reason: ladder.reason,
    };
  }

  if (namedCount < 3) {
    return { ...base, reason: "Not applicable to binary / small-field markets." };
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
      reason: 'This reads like an open-ended "which/who will..." field - consider an "Other" in case a contender outside the list wins.',
    };
  }

  if (namedPriceSum !== undefined && oversubscribed) {
    // Σ > 1 without a ladder verdict: the book cannot be a clean exclusive
    // distribution, but we can't say why. Never report this as "complete".
    return {
      ...base,
      reason:
        `Listed options price to ~${Math.round(namedPriceSum * 100)}% of the book ` +
        `(over 100%), so they are not mutually exclusive. Check the source ` +
        `structure before publishing.`,
    };
  }

  return { ...base, reason: "Listed options look complete — an \"Other\" isn't needed." };
}
