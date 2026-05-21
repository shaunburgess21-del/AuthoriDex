/**
 * Pure helpers for the `weekly_pnl_digest` deriver.
 *
 * Three concerns split out so unit tests can exercise them without
 * touching the DB:
 *   - `isoYearWeek`: stable per-week key used in the idempotency
 *     namespace, so a single user gets at most one digest per ISO
 *     week regardless of how many cron ticks land in the fire window.
 *   - `isWeeklyDigestFireWindow`: gates the deriver to Sunday
 *     18:00-18:30 UTC. The 30-minute window covers ~3 cron ticks
 *     (10-min cadence), all collapsed by the ISO-week idempotency
 *     key into a single row per user.
 *   - `formatWeeklyDigestBody`: tight ~140-char body string for the
 *     panel UI. Encodes the win/loss tally, net Vox, and the
 *     "Best:" call-out when there's a stand-out winning pick.
 */

import { CURRENCY } from "@shared/currency";

/**
 * ISO-8601 week-of-year, formatted "YYYY-W##" with two-digit week.
 *
 * Rules (per spec):
 *   - Week 1 is the week containing the first Thursday of the year.
 *   - The "ISO year" can differ from the calendar year for dates in
 *     late December (which may belong to week 1 of the next year) or
 *     early January (which may belong to week 52/53 of the previous
 *     year).
 *
 * Implementation mirrors the well-known UTC algorithm — clone, snap
 * to the nearest Thursday, then count weeks from the Jan 4 anchor.
 */
export function isoYearWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${isoYear}-W${week.toString().padStart(2, "0")}`;
}

/**
 * Fire-window gate for the weekly digest deriver. Sunday 18:00-18:30
 * UTC. The 30-minute width gives the 10-minute cron pipeline three
 * shots to land at least once — and the ISO-week idempotency on the
 * notification row absorbs all but the first.
 */
export function isWeeklyDigestFireWindow(now: Date = new Date()): boolean {
  if (now.getUTCDay() !== 0) return false;
  const minutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutesSinceMidnight >= 18 * 60 && minutesSinceMidnight < 18 * 60 + 30;
}

export interface WeeklyDigestStats {
  /** Count of resolved buy rows where the user's side won AND payout > stake. */
  wins: number;
  /** Count of resolved buy rows where the user's side lost (status='lost'). */
  losses: number;
  /** Net Vox delta over the week (signed). Field name kept as
   *  `netCredits` to match the internal DB / ledger naming. */
  netCredits: number;
  /** Best winning pick, if any won by enough to be worth a call-out. */
  bestPick?: {
    /** Person name or market title — whichever reads best on the chip. */
    label: string;
    /** Signed profit on the pick (always positive for a "best" call-out). */
    profit: number;
  };
}

/**
 * Format the digest body — tight enough to render cleanly in the
 * notifications panel. Example outputs:
 *
 *   "This week: +Ꝟ1,247 (8 wins, 3 losses). Best: Jake Paul vs KSI (+Ꝟ470)."
 *   "This week: −Ꝟ250 (2 wins, 4 losses)."
 *   "This week: Ꝟ0 (1 win, 1 loss)."
 *
 * Inputs are not validated here — the deriver constructs them from a
 * fresh DB roll-up and there's no untrusted data path.
 */
export function formatWeeklyDigestBody(stats: WeeklyDigestStats): string {
  const { wins, losses, netCredits, bestPick } = stats;
  // Whole-number Vox, with a sign prefix that uses a real Unicode
  // minus for the negative case so spacing matches the "+" on wins.
  const absNet = Math.abs(netCredits).toLocaleString("en-US");
  const sign = netCredits > 0 ? "+" : netCredits < 0 ? "\u2212" : "";
  const signedNet = `${sign}${CURRENCY.symbol}${absNet}`;
  const winsLabel = wins === 1 ? "1 win" : `${wins} wins`;
  const lossesLabel = losses === 1 ? "1 loss" : `${losses} losses`;
  let body = `This week: ${signedNet} (${winsLabel}, ${lossesLabel}).`;
  if (bestPick && bestPick.profit > 0) {
    const signed = `+${CURRENCY.symbol}${bestPick.profit.toLocaleString("en-US")}`;
    body += ` Best: ${bestPick.label} (${signed}).`;
  }
  return body;
}

/**
 * Title is uniform — the body carries the per-user variation. Kept
 * here so the tests pin the exact wording.
 */
export const WEEKLY_DIGEST_TITLE = "Your week in predictions";
