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

/** Sunday 17:30–18:00 UTC — rank snapshots run before the in-app digest. */
export function isRankSnapshotFireWindow(now: Date = new Date()): boolean {
  if (now.getUTCDay() !== 0) return false;
  const minutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutesSinceMidnight >= 17 * 60 + 30 && minutesSinceMidnight < 18 * 60;
}

/** Sunday 18:30–19:00 UTC — Weekly Wrap email fires after the in-app digest. */
export function isWeeklyWrapFireWindow(now: Date = new Date()): boolean {
  if (now.getUTCDay() !== 0) return false;
  const minutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutesSinceMidnight >= 18 * 60 + 30 && minutesSinceMidnight < 19 * 60;
}

/**
 * ISO week immediately before `isoWeek` (e.g. 2026-W21 → 2026-W20).
 * Returns null if parsing fails.
 */
export function previousIsoYearWeek(isoWeek: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) {
    return null;
  }
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const targetMonday = new Date(week1Monday);
  targetMonday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7 - 7);
  return isoYearWeek(targetMonday);
}

/** In-app digest body fields (subset of full weekly stats). */
export interface WeeklyDigestStats {
  wins: number;
  losses: number;
  netCredits: number;
  bestPick?: {
    label: string;
    profit: number;
  };
}

/** Full stats for Weekly Wrap email + shared digest computation. */
export interface FullWeeklyDigestStats {
  wins: number;
  losses: number;
  netCredits: number;
  bestPick: { label: string; profit: number } | null;
  worstPick: { label: string; profit: number } | null;
  rankDelta: { previous: number; current: number } | null;
  jackpot: { won: boolean; profit: number } | null;
  topWeeklyGainers: Array<{ name: string; change7d: number }>;
  windowStart: Date;
  windowEnd: Date;
}

/** Pure roll-up over settled buy rows — extracted so it can be unit tested. */
export interface SettledBuyRow {
  status: string;
  stakeAmount: number | null;
  payoutAmount: number | null;
  marketTitle: string | null;
  /** Pre-resolved display label (caller runs resolvePickContextLabel). */
  pickLabel: string | null;
}

export interface BuyRollUp {
  wins: number;
  losses: number;
  netCredits: number;
  bestPick: { label: string; profit: number } | null;
  worstPick: { label: string; profit: number } | null;
}

/**
 * Roll resolved buy rows into wins/losses/net + best/worst-pick callouts.
 *
 * Mirrors the legacy logic from `deriveWeeklyDigest`:
 *   - wins  = status='won' AND payout > 0
 *   - losses = status='lost'
 *   - bestPick   = the largest +profit win
 *   - worstPick  = the largest -profit loss (signed profit, always negative)
 */
export function rollUpSettledBuys(rows: SettledBuyRow[]): BuyRollUp {
  let wins = 0;
  let losses = 0;
  let netCredits = 0;
  let bestPick: BuyRollUp["bestPick"] = null;
  let worstPick: BuyRollUp["worstPick"] = null;

  for (const bet of rows) {
    const stake = bet.stakeAmount ?? 0;
    const payout = bet.payoutAmount ?? 0;
    const label = bet.pickLabel ?? bet.marketTitle ?? "Top pick";
    if (bet.status === "won" && payout > 0) {
      wins += 1;
      const profit = payout - stake;
      netCredits += profit;
      if (profit > 0 && (!bestPick || profit > bestPick.profit)) {
        bestPick = { label, profit };
      }
    } else if (bet.status === "lost") {
      losses += 1;
      const loss = -stake;
      netCredits += loss;
      if (stake > 0 && (!worstPick || stake > Math.abs(worstPick.profit))) {
        worstPick = {
          label: bet.pickLabel ?? bet.marketTitle ?? "Tough call",
          profit: loss,
        };
      }
    }
  }

  return { wins, losses, netCredits, bestPick, worstPick };
}

export interface JackpotRow {
  status: string;
  stakeAmount: number | null;
  payoutAmount: number | null;
}

/**
 * Net jackpot P&L + "did any ticket pay out" boolean. Returns null when the
 * user didn't settle any jackpot rows this week so the email can omit the
 * whole section.
 */
export function summariseJackpotRows(
  rows: JackpotRow[],
): { won: boolean; profit: number } | null {
  if (rows.length === 0) return null;
  let net = 0;
  let anyWin = false;
  for (const row of rows) {
    const stake = row.stakeAmount ?? 0;
    if (row.status === "won") {
      const payout = row.payoutAmount ?? 0;
      net += payout - stake;
      if (payout > 0) anyWin = true;
    } else if (row.status === "lost") {
      net -= stake;
    }
  }
  return { won: anyWin && net > 0, profit: net };
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
