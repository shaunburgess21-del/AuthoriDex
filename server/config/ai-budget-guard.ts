/**
 * Generic soft daily spend cap for LLM features.
 *
 * --------------------------------------------------------------------------
 * Why this exists alongside worldMarketBudget / nativeMarketBudget
 * --------------------------------------------------------------------------
 * Those two modules are strict reserve/release rails: they pre-increment a
 * counter BEFORE the OpenAI call so concurrent reservations can't race past
 * the cap, and they refund on failure. That precision is worth the machinery
 * for the web_search paths, where a single call can cost ~$0.40.
 *
 * Most other features (`sharp_ranker`, `why_trending`, `agent_comments`, …)
 * only report spend AFTER the fact via `recordLlmUsage`, at one to a few
 * cents per call. What they lack is any ceiling at all: a retry loop or a
 * cache-invalidation bug could run all night unnoticed. This module is that
 * ceiling.
 *
 * --------------------------------------------------------------------------
 * Soft, not strict — read this before relying on it
 * --------------------------------------------------------------------------
 * Spend is recorded after each call, and the reading is cached briefly, so
 * this cap can overshoot by (calls landing inside one cache window). It is a
 * runaway-loop brake, NOT an accounting boundary. Sizing guidance: set the
 * cap well above normal daily spend, so tripping it always means "something
 * is wrong", never "today was busy".
 *
 * Fail-open by design: if the spend table can't be read we allow the call.
 * A billing-observability outage must not silently disable product features.
 *
 * `llmSpendStore` is imported dynamically inside `isFeatureOverDailyCap` (same
 * pattern as `ai-cost.ts` / `worldMarketBudget.ts`): it pulls in `server/db`,
 * which throws without a DATABASE_URL. A static import here would break every
 * unit test that imports a module wired to this guard.
 */

/** How long a spend reading is reused before we re-read the table. */
const CACHE_TTL_MS = 60_000;

interface CachedSpend {
  day: string;
  spendUsd: number;
  readAtMs: number;
}

const cache = new Map<string, CachedSpend>();

/**
 * Features already logged as blocked today — one log line per feature per day
 * instead of one per refused call. Scoped to `blockedLoggedDay` and cleared on
 * rollover so this can't accumulate an entry per feature-day forever in a
 * long-lived process.
 */
const blockedLogged = new Set<string>();
let blockedLoggedDay = "";

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Read a positive USD cap from `env`, or null when unset/invalid/<=0.
 * An unset cap means "no ceiling" — callers keep their previous behaviour
 * until an operator opts in via Railway.
 */
export function resolveFeatureCapUsd(env: string | undefined): number | null {
  const raw = Number(env);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * True when today's recorded spend for `feature` has reached `capUsd` and the
 * caller should skip its LLM call.
 *
 * Pass `capUsd = null` (the default when the env var is unset) to disable the
 * check entirely — this returns false without touching the database.
 */
export async function isFeatureOverDailyCap(
  feature: string,
  capUsd: number | null,
): Promise<boolean> {
  if (capUsd == null) return false;

  const day = todayUtcDateString();
  const cached = cache.get(feature);
  const fresh =
    cached &&
    cached.day === day &&
    Date.now() - cached.readAtMs < CACHE_TTL_MS;

  let spendUsd: number;
  if (fresh) {
    spendUsd = cached!.spendUsd;
  } else {
    try {
      const { loadPersistedSpend } = await import("../agents/llmSpendStore");
      const persisted = await loadPersistedSpend(feature, day);
      spendUsd = persisted?.spendUsd ?? 0;
      cache.set(feature, { day, spendUsd, readAtMs: Date.now() });
    } catch (err) {
      // Fail open — see module header.
      console.warn(
        `[AiBudgetGuard] Could not read spend for ${feature}; allowing call:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  if (spendUsd < capUsd) return false;

  if (blockedLoggedDay !== day) {
    blockedLoggedDay = day;
    blockedLogged.clear();
  }
  if (!blockedLogged.has(feature)) {
    blockedLogged.add(feature);
    console.warn(
      `[AiBudgetGuard] ${feature} hit its daily cap ` +
        `($${spendUsd.toFixed(4)} of $${capUsd.toFixed(2)}) — skipping further ` +
        `calls until 00:00 UTC. Raise the cap or investigate a runaway loop.`,
    );
  }
  return true;
}

/** Test hook: drop cached readings and the once-per-day log guards. */
export function _resetBudgetGuardForTesting(): void {
  cache.clear();
  blockedLogged.clear();
  blockedLoggedDay = "";
}

/**
 * Test hook: pre-load a spend reading so `isFeatureOverDailyCap` resolves from
 * the cache instead of the database.
 *
 * Without this the cap decision itself is untestable: the tests run with no
 * DATABASE_URL, so the dynamic `llmSpendStore` import always throws and every
 * call takes the fail-open path. Seeding a fresh reading exercises the real
 * comparison and logging branches. Pass an older `day` to simulate a stale
 * reading that must be re-read rather than trusted.
 */
export function _seedSpendForTesting(
  feature: string,
  spendUsd: number,
  day: string = todayUtcDateString(),
): void {
  cache.set(feature, { day, spendUsd, readAtMs: Date.now() });
}
