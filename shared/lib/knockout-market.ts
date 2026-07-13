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

/** Optional market fields used to infer knockout when metadata is missing. */
export interface KnockoutMarketHints {
  title?: string | null;
  category?: string | null;
  entryLabels?: Array<string | null | undefined>;
  externalSlug?: string | null;
  tags?: string[] | null;
  summaryOrDescription?: string | null;
}

function readMetadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object") return null;
  return metadata as Record<string, unknown>;
}

/**
 * Infer knockout single-winner for scouted World Cup sports 1X2 imports
 * when GPT omits `drawEligible`. Group-stage fixtures stay draw-eligible.
 */
export function inferDrawEligibleForSportsImport(args: {
  drawEligible?: boolean;
  category: string;
  entryLabels: string[];
  externalSlug?: string | null;
  tags?: string[] | null;
  title?: string;
  summary?: string | null;
  description?: string | null;
}): boolean {
  if (args.drawEligible === false) return false;
  if (args.drawEligible === true) return true;
  if (args.category !== "sports") return true;
  if (!looksLikeThreeWayMoneyline(args.entryLabels)) return true;

  const slug = (args.externalSlug ?? "").trim().toLowerCase();
  const text = [
    args.title ?? "",
    args.summary ?? "",
    args.description ?? "",
    ...(args.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const isWorldCup =
    slug.startsWith("fifwc-") ||
    /\bworld cup\b|\bfifa\b/.test(text);
  if (!isWorldCup) return true;

  if (/\bgroup\s+[a-h]\b|\bgroup stage\b/.test(text)) return true;

  // Round of 16+ at World Cup: default single-winner unless GPT said otherwise.
  return false;
}

/**
 * Build runtime knockout hints from a market row + entries.
 */
export function knockoutHintsFromMarket(
  market: {
    title?: string | null;
    category?: string | null;
    metadata?: unknown;
  },
  entryLabels?: Array<string | null | undefined>,
): KnockoutMarketHints {
  const meta = readMetadataRecord(market.metadata);
  const source =
    meta?.source && typeof meta.source === "object"
      ? (meta.source as Record<string, unknown>)
      : null;
  return {
    title: market.title,
    category: market.category,
    entryLabels,
    externalSlug:
      typeof source?.externalSlug === "string" ? source.externalSlug : null,
    tags: Array.isArray(source?.tags)
      ? (source.tags as string[])
      : null,
    summaryOrDescription:
      typeof meta?.scoutWatch === "string" ? meta.scoutWatch : null,
  };
}

/**
 * Conservative runtime hint when metadata was not stamped at import
 * (legacy rows, or mid-flight markets like France vs Spain).
 */
export function inferLikelySingleWinnerKnockout(hints: KnockoutMarketHints): boolean {
  const labels = hints.entryLabels ?? [];
  if (labels.length > 0 && !looksLikeThreeWayMoneyline(labels)) return false;

  const category = (hints.category ?? "").toLowerCase();
  const slug = (hints.externalSlug ?? "").trim().toLowerCase();
  const isSports = category === "sports" || slug.startsWith("fifwc-");
  if (!isSports) return false;

  const text = [
    hints.title ?? "",
    hints.summaryOrDescription ?? "",
    hints.externalSlug ?? "",
    ...(hints.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (/\bgroup\s+[a-h]\b|\bgroup stage\b/.test(text)) return false;

  if (
    /\b(quarter[- ]?final|semi[- ]?final|semifinal|round of 16|round of 32|last 16|knockout|playoff|play-off|elimination)\b/.test(
      text,
    )
  ) {
    return true;
  }

  if (slug.startsWith("fifwc-") && /\bwho (will )?win\b/.test((hints.title ?? "").toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Read the single-winner knockout flag from market metadata, with optional
 * hints for legacy / mid-flight markets missing metadata stamps.
 */
export function isSingleWinnerKnockoutMarket(
  metadata: unknown,
  hints?: KnockoutMarketHints,
): boolean {
  const m = readMetadataRecord(metadata);
  if (m?.singleWinnerKnockout === true) return true;
  if (m?.drawEligible === false) return true;
  // Explicit group-stage marker — never treat as knockout.
  if (m?.drawEligible === true) return false;
  if (hints) return inferLikelySingleWinnerKnockout(hints);
  return false;
}

/** Replace regulation-draw criteria when importing a knockout market. */
export function normalizeKnockoutResolutionCriteria(
  criteria: string[],
): string[] {
  const kept = criteria.filter(
    (c) =>
      !/\bdraw\b.*\b(regulation|90|level|tie)\b/i.test(c) &&
      !/\bif the (match|game).*\b(level|draw|tie)\b/i.test(c),
  );
  const knockoutBullets = [
    "Resolves to the team that wins the tie and advances, including extra time and penalties.",
    "Draw is not a valid final outcome for this knockout market.",
    "Use the official competition match result as the source of truth.",
  ];
  return [...kept, ...knockoutBullets].slice(0, 5);
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
  hints?: KnockoutMarketHints;
}): { rejected: true; message: string } | { rejected: false } {
  if (!isSingleWinnerKnockoutMarket(args.metadata, args.hints)) {
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
