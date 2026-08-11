/**
 * Time-aware lock-in fair value for native prediction markets.
 *
 * Pure functions — zero I/O. Models the probability that an Up/Down market
 * resolves UP given the current score vs weekly opening baseline and time
 * remaining until resolution.
 *
 *   FAIR(up) = Phi( ln(current/baseline) / sigmaRemain )
 *   sigmaRemain = sigma1d * (hoursLeft / 24)^beta
 */

import type { TrendSignals } from "./types";

/** Measured 1-day fame_index vol (May 2026); override via env if needed. */
export const LOCKIN_SIGMA_1D = (() => {
  const raw = Number(process.env.LOCKIN_SIGMA_1D);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.109;
})();

/** Mean-reversion exponent for residual vol vs time (sqrt-law would be 0.5). */
export const LOCKIN_BETA = (() => {
  const raw = Number(process.env.LOCKIN_BETA);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.36;
})();

/** Never quote exactly 0 or 1 — keeps AMM buys possible. */
export const LOCKIN_FAIR_MAX = 0.985;
export const LOCKIN_FAIR_MIN = 0.015;

/** |pctChangeVsOpen| at or above this → force favoured side (binary up/down). */
export const LOCKIN_DECISIVE_PCT = 0.10;

const MS_PER_HOUR = 3_600_000;
const MIN_HOURS_LEFT = 0.25;

/** Abramowitz & Stegun 7.1.26 — standard normal CDF via erf. */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}

export function sigmaRemain(hoursLeft: number, sigma1d = LOCKIN_SIGMA_1D, beta = LOCKIN_BETA): number {
  if (!Number.isFinite(hoursLeft) || hoursLeft <= 0) return sigma1d * 0.01;
  const h = Math.max(MIN_HOURS_LEFT, hoursLeft);
  return sigma1d * Math.pow(h / 24, beta);
}

export interface LockInFairInput {
  signals: TrendSignals;
  /** Hours until market endAt; <=0 treated as imminent close. */
  hoursRemaining: number;
  marketType?: string;
  sigma1d?: number;
  beta?: number;
  /** H2H: entry ids + live scores for fairByEntryId. */
  entryAId?: string;
  entryBId?: string;
  scoreA?: number;
  scoreB?: number;
  /** Gainer: entry id → pctChangeVsOpen for fairByEntryId. */
  pctByEntryId?: Record<string, number | null | undefined>;
}

export interface LockInFairResult {
  /** P(UP resolves) for binary up/down; null when not applicable. */
  fairUp: number | null;
  /** P(entry i wins) for H2H — keyed by entry id. */
  fairByEntryId?: Record<string, number>;
  sigmaRemain: number;
  logMoneyness: number | null;
}

function clampFair(p: number): number {
  return Math.max(LOCKIN_FAIR_MIN, Math.min(LOCKIN_FAIR_MAX, p));
}

/**
 * Invert `normalCdf` by bisection.
 *
 * Deliberately bisects against THIS module's `normalCdf` rather than adding a
 * closed-form inverse (Acklam et al). Two independent approximations would not
 * round-trip: `normalCdf(ppf(0.4))` would come back 0.3999-something, so a
 * drift calibrated to open at exactly 0.40 would not actually open there. The
 * cost is ~50 iterations of trivial arithmetic, called once per calibration.
 */
export function normalPpf(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0;
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Log-drift per DAY that makes an unmoved card price at `targetOpenProbability`
 * when `totalHours` remain.
 *
 * Solves `Phi(mu_total / sigmaRemain(totalHours)) = target` for the total
 * drift, then divides by the number of days so the caller can scale it to
 * whatever time is actually left. Negative for a target below 0.5.
 *
 * Pure math and deliberately unopinionated about WHICH target is right —
 * the calibration lives with the prior it belongs to
 * (`UPDOWN_AGENT_DRIFT_PER_DAY` in `native-markets/updown-opening-prices.ts`),
 * not here.
 */
export function driftPerDayForTargetOpen(
  targetOpenProbability: number,
  totalHours: number,
  sigma1d = LOCKIN_SIGMA_1D,
  beta = LOCKIN_BETA,
): number {
  if (
    !Number.isFinite(targetOpenProbability) ||
    targetOpenProbability <= 0 ||
    targetOpenProbability >= 1
  ) {
    return 0;
  }
  if (!Number.isFinite(totalHours) || totalHours <= 0) return 0;
  const totalDrift = normalPpf(targetOpenProbability) * sigmaRemain(totalHours, sigma1d, beta);
  return totalDrift / (totalHours / 24);
}

/**
 * Binary Up/Down: fair probability UP wins (close score > opening baseline).
 *
 * `driftPerDay` is the expected log-drift per day of remaining time, and
 * defaults to 0 — a driftless random walk, i.e. byte-identical to the
 * behaviour every existing call site has always had. This matters because the
 * function is shared by the decision engine, the agent runner, the arb agent
 * and `liveConvergence.ts`, and that last one moves real prices mid-week.
 * Opt in per call site; never change this default.
 *
 * Why a drift term exists at all: with `driftPerDay = 0` this is a martingale,
 * so at open (`pctChangeVsOpen === 0`) it is forced to return exactly 0.5. The
 * measured Up rate for a high-velocity card is 31.6%, so 0.5 is known to be
 * wrong precisely when there is no information yet. A negative drift expresses
 * the mean reversion that `velocity_score`'s percentile normalisation builds in.
 *
 * Drift accumulates linearly in remaining time while volatility scales as
 * `(h/24)^beta`, so the correction is largest at open and self-extinguishes
 * toward close (≈ -0.10 at 168h, -0.03 at 24h, -0.002 in the last 15 minutes).
 * Late-week and settlement-adjacent pricing are therefore unaffected, and a
 * decisive realised move still dominates.
 */
export function computeLockInFairUp(
  pctChangeVsOpen: number | null | undefined,
  hoursRemaining: number,
  sigma1d = LOCKIN_SIGMA_1D,
  beta = LOCKIN_BETA,
  driftPerDay = 0,
): number | null {
  if (pctChangeVsOpen == null || !Number.isFinite(pctChangeVsOpen)) return null;
  const ratio = 1 + pctChangeVsOpen;
  if (ratio <= 0) return pctChangeVsOpen > 0 ? LOCKIN_FAIR_MAX : LOCKIN_FAIR_MIN;
  const sig = sigmaRemain(hoursRemaining, sigma1d, beta);
  if (sig <= 0) return 0.5;
  // Drift must follow the same horizon convention as `sigmaRemain`, which
  // collapses to `sigma1d * 0.01` once there is no time left. Holding drift at
  // the MIN_HOURS_LEFT floor while sigma collapses would divide a fixed drift
  // by a near-zero sigma and leave a ~3pp tilt on a market that is already
  // past its close — with no time left, no drift can accumulate.
  const noTimeLeft = !Number.isFinite(hoursRemaining) || hoursRemaining <= 0;
  const drift =
    noTimeLeft || !Number.isFinite(driftPerDay)
      ? 0
      : driftPerDay * (Math.max(MIN_HOURS_LEFT, hoursRemaining) / 24);
  const z = (Math.log(ratio) + drift) / sig;
  return clampFair(normalCdf(z));
}

/**
 * H2H: P(entry A beats B at close) from current score ratio.
 */
export function computeLockInFairH2H(
  scoreA: number,
  scoreB: number,
  hoursRemaining: number,
  sigma1d = LOCKIN_SIGMA_1D,
  beta = LOCKIN_BETA,
): number {
  const a = Math.max(scoreA, 1);
  const b = Math.max(scoreB, 1);
  const sig = sigmaRemain(hoursRemaining, sigma1d, beta);
  if (sig <= 0) return 0.5;
  const z = Math.log(a / b) / (sig * Math.SQRT2);
  return clampFair(normalCdf(z));
}

/**
 * H2H fair probabilities keyed by entry id (P(A wins), P(B wins) = 1 - P(A)).
 */
export function fairH2HByEntryId(
  entryAId: string,
  scoreA: number,
  entryBId: string,
  scoreB: number,
  hoursRemaining: number,
  sigma1d = LOCKIN_SIGMA_1D,
  beta = LOCKIN_BETA,
): Record<string, number> {
  const pA = computeLockInFairH2H(scoreA, scoreB, hoursRemaining, sigma1d, beta);
  return {
    [entryAId]: pA,
    [entryBId]: clampFair(1 - pA),
  };
}

/** Favored entry id and fair on that side from a fair map. */
export function favoredH2HFromFairMap(
  fairByEntryId: Record<string, number>,
): { entryId: string; fair: number } | null {
  const entries = Object.entries(fairByEntryId);
  if (entries.length === 0) return null;
  const [bestId, bestFair] = entries.reduce((best, cur) =>
    cur[1] > best[1] ? cur : best,
  );
  return { entryId: bestId, fair: bestFair };
}

/** Alias — same helper works for H2H and gainer fair maps. */
export const favoredFromFairMap = favoredH2HFromFairMap;

export interface GainerFairEntryInput {
  entryId: string;
  pctChangeVsOpen: number | null | undefined;
}

const GAINER_Z_MIN = -6;
const GAINER_Z_MAX = 6;
const GAINER_Z_STEP = 0.02;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

function standardNormalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / SQRT_2PI;
}

/** Locked-in log-gain from weekly pct change vs open (gainer resolution metric). */
export function logGainFromPctChange(
  pctChangeVsOpen: number | null | undefined,
): number {
  if (pctChangeVsOpen == null || !Number.isFinite(pctChangeVsOpen)) return 0;
  const ratio = 1 + pctChangeVsOpen;
  if (ratio <= 0) return -10;
  return Math.log(ratio);
}

/**
 * P(entry i is the top gainer) via Gaussian-argmax grid integration.
 * L_i = m_i + sigma * Z_i, Z_i i.i.d. N(0,1); winner = argmax_i L_i.
 */
function gainerWinProbGrid(
  mI: number,
  mOthers: number[],
  sigma: number,
): number {
  if (mOthers.length === 0) return 1;
  if (sigma <= 1e-9) {
    const all = [mI, ...mOthers];
    const maxM = Math.max(...all);
    if (mI < maxM) return 0;
    const ties = all.filter((m) => m === maxM).length;
    return 1 / ties;
  }
  let prob = 0;
  for (let z = GAINER_Z_MIN; z <= GAINER_Z_MAX + 1e-9; z += GAINER_Z_STEP) {
    const w = standardNormalPdf(z) * GAINER_Z_STEP;
    let factor = 1;
    for (const mJ of mOthers) {
      factor *= normalCdf((mI - mJ) / sigma + z);
    }
    prob += w * factor;
  }
  return prob;
}

/**
 * Gainer: P(entry i has highest pctChange at close) keyed by entry id.
 * Probabilities sum to 1 after normalization (per-entry clamp is applied at use sites).
 */
export function computeLockInFairGainer(
  entries: GainerFairEntryInput[],
  hoursRemaining: number,
  sigma1d = LOCKIN_SIGMA_1D,
  beta = LOCKIN_BETA,
): Record<string, number> {
  if (entries.length === 0) return {};
  const sigma = sigmaRemain(hoursRemaining, sigma1d, beta);
  const mById = entries.map((e) => ({
    entryId: e.entryId,
    m: logGainFromPctChange(e.pctChangeVsOpen),
  }));

  const raw: Record<string, number> = {};
  for (const { entryId, m } of mById) {
    const others = mById.filter((x) => x.entryId !== entryId).map((x) => x.m);
    raw[entryId] = gainerWinProbGrid(m, others, sigma);
  }

  let sum = Object.values(raw).reduce((a, b) => a + b, 0);
  if (sum <= 0 || !Number.isFinite(sum)) {
    const uniform = 1 / entries.length;
    const out: Record<string, number> = {};
    for (const e of entries) out[e.entryId] = uniform;
    return out;
  }

  const out: Record<string, number> = {};
  for (const [id, p] of Object.entries(raw)) {
    out[id] = p / sum;
  }
  return out;
}

/** Build gainer fair map from entry id → pctChangeVsOpen. */
export function fairGainerByEntryId(
  pctByEntryId: Record<string, number | null | undefined>,
  hoursRemaining: number,
  sigma1d = LOCKIN_SIGMA_1D,
  beta = LOCKIN_BETA,
): Record<string, number> {
  const entries = Object.entries(pctByEntryId).map(([entryId, pctChangeVsOpen]) => ({
    entryId,
    pctChangeVsOpen,
  }));
  return computeLockInFairGainer(entries, hoursRemaining, sigma1d, beta);
}

export function computeLockInFair(input: LockInFairInput): LockInFairResult {
  const { signals, hoursRemaining, marketType, sigma1d, beta } = input;
  const sig = sigmaRemain(hoursRemaining, sigma1d, beta);

  if (marketType === "h2h") {
    const { entryAId, entryBId, scoreA, scoreB } = input;
    if (
      entryAId &&
      entryBId &&
      scoreA != null &&
      Number.isFinite(scoreA) &&
      scoreB != null &&
      Number.isFinite(scoreB)
    ) {
      const fairByEntryId = fairH2HByEntryId(
        entryAId,
        scoreA,
        entryBId,
        scoreB,
        hoursRemaining,
        sigma1d,
        beta,
      );
      return {
        fairUp: null,
        fairByEntryId,
        sigmaRemain: sig,
        logMoneyness: null,
      };
    }
    return {
      fairUp: null,
      fairByEntryId: undefined,
      sigmaRemain: sig,
      logMoneyness: null,
    };
  }

  if (marketType === "gainer" && input.pctByEntryId) {
    const fairByEntryId = fairGainerByEntryId(
      input.pctByEntryId,
      hoursRemaining,
      sigma1d,
      beta,
    );
    return {
      fairUp: null,
      fairByEntryId,
      sigmaRemain: sig,
      logMoneyness: null,
    };
  }

  const pct = signals.pctChangeVsOpen;
  const fairUp = computeLockInFairUp(pct, hoursRemaining, sigma1d, beta);
  let logM: number | null = null;
  if (pct != null && Number.isFinite(pct) && 1 + pct > 0) {
    logM = Math.log(1 + pct) / sig;
  }

  return { fairUp, sigmaRemain: sig, logMoneyness: logM };
}

/** Hours from `now` until `endAt` (0 if past end). */
export function hoursUntilEnd(endAt: Date | null | undefined, now: Date = new Date()): number {
  if (!endAt) return 7 * 24;
  const ms = endAt.getTime() - now.getTime();
  return Math.max(0, ms / MS_PER_HOUR);
}

/** Fair target for a specific entry label (Up/Down hints). */
export function fairForEntry(
  fairUp: number | null,
  entryLabel: string | null | undefined,
  positiveHints: string[],
  negativeHints: string[],
): number | null {
  if (fairUp == null) return null;
  const label = (entryLabel ?? "").toLowerCase();
  if (positiveHints.some((h) => label.includes(h))) return fairUp;
  if (negativeHints.some((h) => label.includes(h))) return clampFair(1 - fairUp);
  return null;
}
