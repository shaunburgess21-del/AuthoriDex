import { formatVoxCompact } from "@/lib/currency";

/**
 * Shown in place of a trader count only when the count is truly zero.
 * One trader still reads "1 trader".
 */
export const FIRST_TO_PREDICT = "Be the first to predict";

/**
 * Opening LMSR prices are equal before anyone trades. House seed
 * volume can be non-zero with zero traders, so this note keys off
 * trader count, not volume. It is not shown once anyone has predicted
 * — equal prices can still be a real result.
 */
export const OPENING_ODDS_NOTE = "Odds start equal until people predict.";

export function traderCountLabel(
  count: number,
  noun: "trader" | "participant" = "trader",
): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n <= 0) return FIRST_TO_PREDICT;
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/** Null once anyone has traded. Callers skip the line. */
export function openingOddsNote(traderCount: number): string | null {
  const n = Number.isFinite(traderCount) ? Math.floor(traderCount) : 0;
  return n > 0 ? null : OPENING_ODDS_NOTE;
}

/**
 * Binary rows keep their side name ("Yes 33%"). Multi-option rows
 * pass no side label and render the chance alone ("33%").
 */
export function formatOutcomeChance(pct: number, sideLabel?: string | null): string {
  const n = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
  const side = sideLabel?.trim();
  return side ? `${side} ${n}%` : `${n}%`;
}

/**
 * Compact volume plus the unit, as one string. Volume chips sit in
 * `inline-flex` badges; a separate " vol" text node loses its leading
 * space and renders "1.5Kvol".
 */
export function formatVolumeWithUnit(value: number | null | undefined): string | null {
  const compact = formatVoxCompact(value);
  if (!compact) return null;
  return `${compact} vol`;
}
