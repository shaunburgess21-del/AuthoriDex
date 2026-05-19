/**
 * Daily LLM budget cap for the world-market engine.
 *
 * --------------------------------------------------------------------------
 * Purpose
 * --------------------------------------------------------------------------
 * Per-process safety rail on world-market OpenAI spend. NOT an accounting
 * boundary — the point is to bound worst-case overnight spend if a TTL
 * loop misbehaves, a short-horizon catalogue spike lands, or the per-call
 * estimate proves wildly off.
 *
 * Each `tryReserveLlmCall()` pessimistically pre-increments the counter
 * BEFORE the OpenAI call fires, so concurrent reservations can't race
 * past the cap. If the call later fails (network error, empty response,
 * schema mismatch), the caller invokes `release()` and the reservation
 * is refunded — failed calls don't burn budget.
 *
 * The dedup in `worldMarketEngine.getOrCreateAssessment` already prevents
 * the in-flight stampede (only ONE call per market per TTL window), so
 * this layer's job is purely "stop new calls when today's estimated
 * spend exceeds the cap."
 *
 * --------------------------------------------------------------------------
 * State + rollover
 * --------------------------------------------------------------------------
 * Single module-level `state` keyed by UTC `YYYY-MM-DD`. Every call to
 * `tryReserveLlmCall` first invokes `rolloverIfNewDay()` which compares
 * today's date to the stored one — if different, logs a one-line summary
 * of the previous day, then resets.
 *
 * Per-process: a Railway redeploy mid-day resets the counter. Worst case
 * is "cap × number of redeploys", typically 1-2x. Acceptable for a safety
 * rail; the DB-persistence complexity (locking, advisory locks, cross-
 * instance sync) isn't worth it at this stage.
 *
 * --------------------------------------------------------------------------
 * Logging
 * --------------------------------------------------------------------------
 *   - First block of the day: `[WorldEngineBudget] cap exhausted ...`
 *     One line per day per process. Subsequent blocks are silent (avoid
 *     log spam — once the cap is hit, every refused call follows; we
 *     don't need to repeat the same fact 50 times).
 *   - Daily rollover: `[WorldEngineBudget] Day rolled over: ...`
 *     Always fires when a new day is detected. Useful as a heartbeat.
 *
 * The runbook (`ops/AMM_MONITORING_RUNBOOK.md` section 14) tells operators
 * which log filter to watch in Railway.
 */

/**
 * Hard daily budget cap (USD) for world-market LLM calls. Resolves at
 * import time so each process gets a stable value for its lifetime.
 * Operator raises via Railway env `WORLD_MARKETS_DAILY_BUDGET_USD`.
 */
function resolveDailyBudgetUsd(): number {
  const raw = Number(process.env.WORLD_MARKETS_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5.0;
}

/**
 * Per-call cost ESTIMATE used to reserve budget before each LLM call.
 * Deliberately conservative (high) so we refuse a borderline call rather
 * than overshoot the cap by accident. Real cost varies with web_search
 * activity + output token count; ops should reconcile against actual
 * OpenAI billing weekly. Overridable via Railway env
 * `WORLD_MARKETS_PER_CALL_ESTIMATE_USD`.
 */
function resolvePerCallEstimateUsd(): number {
  const raw = Number(process.env.WORLD_MARKETS_PER_CALL_ESTIMATE_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.4;
}

// Snapshotted at module load. `getCapUsd()` / `getDefaultEstimate()`
// return these so tests can read them without importing from constants.
let CAP_USD = resolveDailyBudgetUsd();
let DEFAULT_ESTIMATE_USD = resolvePerCallEstimateUsd();

export function getCapUsd(): number {
  return CAP_USD;
}

export function getDefaultPerCallEstimateUsd(): number {
  return DEFAULT_ESTIMATE_USD;
}

// ---------------------------------------------------------------------------
// Clock — injectable for tests
// ---------------------------------------------------------------------------

type ClockFn = () => Date;
let getNow: ClockFn = () => new Date();

function todayUtcDateString(): string {
  // ISO date in UTC: 2026-05-19. Drives the daily rollover comparison.
  return getNow().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

interface BudgetState {
  dateUtc: string;
  spendUsd: number;
  callsReserved: number;
  callsReleased: number;
  callsBlocked: number;
  /** Prevents log spam — once the cap is hit on day X, every subsequent
   *  block fires silently until rollover. */
  loggedCapExhaustionToday: boolean;
}

function freshStateFor(dateUtc: string): BudgetState {
  return {
    dateUtc,
    spendUsd: 0,
    callsReserved: 0,
    callsReleased: 0,
    callsBlocked: 0,
    loggedCapExhaustionToday: false,
  };
}

let state: BudgetState = freshStateFor(todayUtcDateString());

// ---------------------------------------------------------------------------
// Snapshot — read-only view for ops / tests
// ---------------------------------------------------------------------------

export interface BudgetSnapshot {
  dateUtc: string;
  spendUsd: number;
  callsReserved: number;
  callsReleased: number;
  callsBlocked: number;
  capUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

export function getBudgetSnapshot(): BudgetSnapshot {
  rolloverIfNewDay();
  const remaining = Math.max(0, CAP_USD - state.spendUsd);
  return {
    dateUtc: state.dateUtc,
    spendUsd: state.spendUsd,
    callsReserved: state.callsReserved,
    callsReleased: state.callsReleased,
    callsBlocked: state.callsBlocked,
    capUsd: CAP_USD,
    remainingUsd: remaining,
    exhausted: state.spendUsd >= CAP_USD,
  };
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

function rolloverIfNewDay(): void {
  const today = todayUtcDateString();
  if (today === state.dateUtc) return;

  // Log a one-line summary of the day we're leaving. `console.log` rather
  // than the project `log()` helper because this module deliberately
  // has zero imports beyond Node built-ins — keeps the test surface
  // self-contained.
  const successfulCalls = state.callsReserved - state.callsReleased;
  console.log(
    `[WorldEngineBudget] Day rolled over: ${state.dateUtc}=$${state.spendUsd.toFixed(2)} ` +
      `in ${successfulCalls} successful calls, ${state.callsBlocked} blocked. ` +
      `Resetting for ${today}.`,
  );

  state = freshStateFor(today);
}

// ---------------------------------------------------------------------------
// Reservation
// ---------------------------------------------------------------------------

export type Reservation =
  | {
      allowed: true;
      /** Mark the reservation as actually used. No-op today (counter is
       *  already pre-incremented), but exists for API symmetry and so a
       *  future "lazy commit" model is a non-breaking change. */
      commit: () => void;
      /** Refund the reservation. Safe to call multiple times — second+
       *  calls are silent no-ops. Used when the OpenAI call fails before
       *  producing a billable response. */
      release: () => void;
    }
  | {
      allowed: false;
      reason: "cap_exhausted";
      snapshot: BudgetSnapshot;
    };

/**
 * Try to reserve budget for one LLM call. If the cap would be breached,
 * returns `allowed: false` and the caller MUST abstain (return null,
 * skip the OpenAI call). Otherwise pre-increments the spend counter and
 * returns a `{ allowed: true; commit; release }` handle.
 *
 * Concurrency note: JS single-thread + synchronous counter update means
 * two reservations can't actually race within a single process. The
 * pessimistic increment guarantees that even a burst of awaited calls
 * gated only at the `await` boundary cannot collectively overshoot the
 * cap — once one reservation lands, the next one sees the updated
 * `spendUsd` synchronously.
 */
export function tryReserveLlmCall(estimatedCostUsd?: number): Reservation {
  rolloverIfNewDay();

  const cost =
    typeof estimatedCostUsd === "number" &&
    Number.isFinite(estimatedCostUsd) &&
    estimatedCostUsd > 0
      ? estimatedCostUsd
      : DEFAULT_ESTIMATE_USD;

  if (state.spendUsd + cost > CAP_USD) {
    state.callsBlocked += 1;

    if (!state.loggedCapExhaustionToday) {
      console.log(
        `[WorldEngineBudget] cap exhausted ($${state.spendUsd.toFixed(2)} of ` +
          `$${CAP_USD.toFixed(2)}) — agents will abstain for rest of UTC day. ` +
          `Next reservation tried to add $${cost.toFixed(2)}.`,
      );
      state.loggedCapExhaustionToday = true;
    }

    return {
      allowed: false,
      reason: "cap_exhausted",
      snapshot: snapshotInternal(),
    };
  }

  // Pessimistic reserve — the counter increments BEFORE the OpenAI call
  // returns. If the call fails the caller invokes release() to refund.
  state.spendUsd += cost;
  state.callsReserved += 1;

  let consumed = false;
  return {
    allowed: true,
    commit: () => {
      // Counter already updated; nothing to do. Flag the local "consumed"
      // so an out-of-order release() after commit() is a no-op rather
      // than a spurious refund.
      consumed = true;
    },
    release: () => {
      if (consumed) return; // commit already finalised; ignore late release
      consumed = true; // also defends against double-release
      state.spendUsd = Math.max(0, state.spendUsd - cost);
      state.callsReleased += 1;
    },
  };
}

// Internal snapshot used by the `allowed: false` branch so we don't
// re-trigger rolloverIfNewDay() recursively from inside the same call.
function snapshotInternal(): BudgetSnapshot {
  const remaining = Math.max(0, CAP_USD - state.spendUsd);
  return {
    dateUtc: state.dateUtc,
    spendUsd: state.spendUsd,
    callsReserved: state.callsReserved,
    callsReleased: state.callsReleased,
    callsBlocked: state.callsBlocked,
    capUsd: CAP_USD,
    remainingUsd: remaining,
    exhausted: state.spendUsd >= CAP_USD,
  };
}

// ---------------------------------------------------------------------------
// Test helpers — NOT for production code paths
// ---------------------------------------------------------------------------

/**
 * Resets the in-memory state to a fresh day at the current clock. Lets
 * tests run in isolation without inheriting state from earlier tests.
 * Also re-reads env vars in case the test set them after import.
 */
export function _resetBudgetForTesting(): void {
  CAP_USD = resolveDailyBudgetUsd();
  DEFAULT_ESTIMATE_USD = resolvePerCallEstimateUsd();
  state = freshStateFor(todayUtcDateString());
}

/**
 * Override the clock used for `todayUtcDateString()`. Tests use this to
 * exercise the daily-rollover path without actually waiting for UTC
 * midnight. Pass `null` to restore the real clock.
 */
export function _overrideClockForTesting(clock: ClockFn | null): void {
  getNow = clock ?? (() => new Date());
}
