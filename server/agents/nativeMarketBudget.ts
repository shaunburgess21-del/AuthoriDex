/**
 * Daily LLM budget cap for native-market assessments (updown / h2h / gainer).
 * Mirrors worldMarketBudget.ts — separate counter so world + native caps
 * don't compete. Like the world budget, the in-memory counter is mirrored
 * to `llm_daily_spend` once the server boot calls
 * `initNativeBudgetPersistence()`; tests stay pure in-memory.
 */

function resolveDailyBudgetUsd(): number {
  const raw = Number(process.env.NATIVE_MARKETS_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 2.0;
}

function resolvePerCallEstimateUsd(): number {
  const raw = Number(process.env.NATIVE_MARKETS_PER_CALL_ESTIMATE_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.012;
}

let CAP_USD = resolveDailyBudgetUsd();
let DEFAULT_ESTIMATE_USD = resolvePerCallEstimateUsd();

type ClockFn = () => Date;
let getNow: ClockFn = () => new Date();

function todayUtcDateString(): string {
  return getNow().toISOString().slice(0, 10);
}

interface BudgetState {
  dateUtc: string;
  spendUsd: number;
  callsReserved: number;
  callsReleased: number;
  callsBlocked: number;
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

// --- Persistence (Phase 2): write-through mirror to llm_daily_spend. ---
// See worldMarketBudget.ts for the full design commentary.

type SpendStore = typeof import("./llmSpendStore");

const FEATURE_KEY = "native_markets";
let store: SpendStore | null = null;
let loggedPersistErrorToday = false;

export async function initNativeBudgetPersistence(): Promise<void> {
  store = await import("./llmSpendStore");
  await hydrateFromDb();
}

async function hydrateFromDb(): Promise<void> {
  if (!store) return;
  const day = state.dateUtc;
  try {
    const persisted = await store.loadPersistedSpend(FEATURE_KEY, day);
    if (persisted && state.dateUtc === day && persisted.spendUsd > state.spendUsd) {
      state.spendUsd = persisted.spendUsd;
    }
  } catch (err) {
    logPersistErrorOnce(err);
  }
}

function logPersistErrorOnce(err: unknown): void {
  if (loggedPersistErrorToday) return;
  loggedPersistErrorToday = true;
  console.error(
    "[NativeEngineBudget] DB persistence error (falling back to in-memory):",
    err,
  );
}

function persistDelta(day: string, deltaUsd: number, deltaCalls: number): void {
  if (!store) return;
  store
    .persistSpendDelta(FEATURE_KEY, day, deltaUsd, deltaCalls)
    .then((persisted) => {
      if (persisted && state.dateUtc === day && persisted.spendUsd > state.spendUsd) {
        state.spendUsd = persisted.spendUsd;
      }
    })
    .catch(logPersistErrorOnce);
}

export interface NativeBudgetSnapshot {
  dateUtc: string;
  spendUsd: number;
  callsReserved: number;
  callsReleased: number;
  callsBlocked: number;
  capUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

export function getNativeBudgetSnapshot(): NativeBudgetSnapshot {
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

export function getNativeCapUsd(): number {
  return CAP_USD;
}

function rolloverIfNewDay(): void {
  const today = todayUtcDateString();
  if (today === state.dateUtc) return;
  const successfulCalls = state.callsReserved - state.callsReleased;
  console.log(
    `[NativeEngineBudget] Day rolled over: ${state.dateUtc}=$${state.spendUsd.toFixed(2)} ` +
      `in ${successfulCalls} successful calls, ${state.callsBlocked} blocked. Resetting for ${today}.`,
  );
  state = freshStateFor(today);
  loggedPersistErrorToday = false;
  void hydrateFromDb();
}

export type NativeReservation =
  | {
      allowed: true;
      commit: () => void;
      release: () => void;
    }
  | {
      allowed: false;
      reason: "cap_exhausted";
      snapshot: NativeBudgetSnapshot;
    };

export function tryReserveNativeLlmCall(estimatedCostUsd?: number): NativeReservation {
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
        `[NativeEngineBudget] cap exhausted ($${state.spendUsd.toFixed(2)} of $${CAP_USD.toFixed(2)})`,
      );
      state.loggedCapExhaustionToday = true;
    }
    return {
      allowed: false,
      reason: "cap_exhausted",
      snapshot: getNativeBudgetSnapshot(),
    };
  }

  state.spendUsd += cost;
  state.callsReserved += 1;
  // Day captured at reserve time so a midnight-straddling release
  // refunds the row it debited.
  const reservedDay = state.dateUtc;
  persistDelta(reservedDay, cost, 1);
  let consumed = false;
  return {
    allowed: true,
    commit: () => {
      consumed = true;
    },
    release: () => {
      if (consumed) return;
      consumed = true;
      state.spendUsd = Math.max(0, state.spendUsd - cost);
      state.callsReleased += 1;
      persistDelta(reservedDay, -cost, -1);
    },
  };
}

export function _resetNativeBudgetForTesting(): void {
  CAP_USD = resolveDailyBudgetUsd();
  DEFAULT_ESTIMATE_USD = resolvePerCallEstimateUsd();
  state = freshStateFor(todayUtcDateString());
  store = null; // persistence is never active in tests
  loggedPersistErrorToday = false;
}

export function _overrideNativeClockForTesting(clock: ClockFn | null): void {
  getNow = clock ?? (() => new Date());
}
