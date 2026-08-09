/**
 * Display ordering for multi-outcome World Market legs.
 *
 * Polymarket returns an event's sub-markets in no useful order, so the scout
 * sorts them by price descending — right for "who will win" fields, where the
 * favourite belongs at the top. It is wrong for numeric bracket fields, where
 * price order scrambles the number line and the market reads as broken:
 *
 *   Under $4M | $4M-$10M | $15M-$50M | $10M-$15M | Over $50M
 *
 * When every named leg parses to a distinct magnitude we sort by that instead,
 * so brackets and thresholds ascend the way a reader expects.
 */

import { isOtherStyleOutcomeLabel } from "./other-outcome";

const MAGNITUDE_UNITS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  mm: 1e6,
  b: 1e9,
  bn: 1e9,
  t: 1e12,
};

/** Leading "under / below / less than / <" — the open bucket at the bottom. */
const LOWER_TAIL = /^\s*(?:<|under\b|below\b|less\s+than\b|up\s+to\b)/i;

/** A bare quantity: optional currency, digits, optional unit suffix. */
const QUANTITY = /(\d+(?:[.,]\d+)?)\s*(mm|bn|[kmbt])?\b/i;

/**
 * Lower bound of the bucket a label describes, or null when it carries no
 * parseable quantity. Ranges take their low end ("$4M-$10M" → 4e6) so
 * adjacent buckets sort in sequence; an open lower tail sorts before every
 * numbered bucket.
 */
export function parseOutcomeMagnitude(label: string | null | undefined): number | null {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return null;

  const match = QUANTITY.exec(trimmed);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  if (LOWER_TAIL.test(trimmed)) return Number.NEGATIVE_INFINITY;

  const unit = (match[2] ?? "").toLowerCase();
  return value * (MAGNITUDE_UNITS[unit] ?? 1);
}

/**
 * Order outcome legs for display. Numeric bracket / threshold fields ascend by
 * magnitude; everything else keeps price-descending "favourite first". Any
 * catch-all ("Other", "The Field") is always pinned last.
 *
 * Ordering only switches to magnitude when EVERY named leg parses to a
 * DISTINCT value, so a single unparseable or duplicate label leaves a
 * name field (where a stray "Team 100" would otherwise hijack the sort)
 * on the price ordering it should have.
 */
export function orderOutcomesForDisplay<T extends { label: string; price: number }>(
  outcomes: T[],
): T[] {
  const named = outcomes.filter((o) => !isOtherStyleOutcomeLabel(o.label));
  const catchAlls = outcomes.filter((o) => isOtherStyleOutcomeLabel(o.label));

  const magnitudes = named.map((o) => parseOutcomeMagnitude(o.label));
  const allParsed = magnitudes.every((m): m is number => m !== null);
  const allDistinct = allParsed && new Set(magnitudes).size === magnitudes.length;

  const sortedNamed = [...named];
  if (allParsed && allDistinct && named.length >= 2) {
    const byLabel = new Map(named.map((o, i) => [o, magnitudes[i] as number]));
    sortedNamed.sort((a, b) => (byLabel.get(a) ?? 0) - (byLabel.get(b) ?? 0));
  } else {
    sortedNamed.sort((a, b) => b.price - a.price);
  }

  return [...sortedNamed, ...catchAlls];
}
