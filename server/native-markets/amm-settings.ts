/**
 * Admin-tunable AMM knobs, backed by the `amm_runtime_settings`
 * singleton row. Read path is **synchronous** (cached) so existing
 * sync call sites — `getAmmTradingCutoff`, `getMarketBettingCutoff`,
 * the bet endpoints, the market generator — don't have to async-
 * cascade. The cache is warmed at boot via `initAmmSettings()` and
 * refreshed in the background every `REFRESH_INTERVAL_MS`.
 *
 * Currently exposes a single knob:
 *   - `preResolveCooldownMs` — gap between the AMM trading cutoff and
 *     `endAt`. Defaults to 5 minutes; promoted out of `lifecycle.ts`
 *     so we can dial it up once Phase 10 wakes the agents and we see
 *     how late-hour sniping actually behaves on a live AMM market.
 *
 * Designed to grow as Phase 10/11/12 introduce more tunables (Kelly
 * cap, per-engine max-loss override, etc.).
 */

import { eq } from "drizzle-orm";
import { ammRuntimeSettings } from "@shared/schema";

const SINGLETON_ID = "global";
const REFRESH_INTERVAL_MS = 10_000;

export const DEFAULT_PRE_RESOLVE_COOLDOWN_MS = 5 * 60 * 1000;
// Hard floor + ceiling so an admin typo can't accidentally close
// trading 24h early or eliminate the resolver-race buffer entirely.
// 60s is the smallest cooldown that still gives the resolver cron
// (5-min cadence) a comfortable window without a tight race; 1h is a
// generous upper bound for any realistic last-hour-volatility tuning.
export const MIN_PRE_RESOLVE_COOLDOWN_MS = 60 * 1000;
export const MAX_PRE_RESOLVE_COOLDOWN_MS = 60 * 60 * 1000;

interface CachedSettings {
  preResolveCooldownMs: number;
  updatedAt: Date;
  updatedBy: string | null;
  fetchedAt: number;
}

let cache: CachedSettings | null = null;
let inflight: Promise<CachedSettings> | null = null;

async function loadFromDb(): Promise<CachedSettings> {
  // Lazy import keeps this module importable from contexts without a
  // configured DATABASE_URL (e.g. unit tests that pull in `lifecycle.ts`).
  // Pre-boot reads still resolve via the in-memory default; only when
  // something actually triggers a refresh do we hit the DB.
  const { db } = await import("../db");
  const rows = await db
    .select()
    .from(ammRuntimeSettings)
    .where(eq(ammRuntimeSettings.id, SINGLETON_ID))
    .limit(1);

  const row = rows[0];
  // Missing row (fresh DB, migration not yet applied) → fall back to
  // the default. Never throw; the cooldown read path is on the hot
  // path of every bet/list query.
  const next: CachedSettings = {
    preResolveCooldownMs: clampCooldown(row?.preResolveCooldownMs ?? DEFAULT_PRE_RESOLVE_COOLDOWN_MS),
    updatedAt: row?.updatedAt ?? new Date(0),
    updatedBy: row?.updatedBy ?? null,
    fetchedAt: Date.now(),
  };
  cache = next;
  return next;
}

function clampCooldown(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_PRE_RESOLVE_COOLDOWN_MS;
  return Math.max(MIN_PRE_RESOLVE_COOLDOWN_MS, Math.min(MAX_PRE_RESOLVE_COOLDOWN_MS, Math.round(ms)));
}

function maybeRefreshInBackground(): void {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < REFRESH_INTERVAL_MS) return;
  if (inflight) return;
  inflight = loadFromDb()
    .catch((err) => {
      // Background refresh failures must never throw to the request
      // path. Log and keep serving the stale cached value.
      console.error("[AmmSettings] Background refresh failed:", err);
      return cache!;
    })
    .finally(() => {
      inflight = null;
    }) as Promise<CachedSettings>;
}

/**
 * Synchronous fast read used by `getAmmTradingCutoff` etc. Returns
 * the cached value immediately and triggers a background refresh
 * when the cache is stale.
 *
 * Pre-boot (before `initAmmSettings()` runs), returns the compiled-in
 * default so `lifecycle.ts` always has *some* sensible answer.
 */
export function getAmmCooldownMs(): number {
  maybeRefreshInBackground();
  return cache?.preResolveCooldownMs ?? DEFAULT_PRE_RESOLVE_COOLDOWN_MS;
}

/**
 * Warm the cache at boot. Best-effort: if the DB read fails we
 * continue with the compiled-in default and log loudly. Subsequent
 * sync `getAmmCooldownMs()` calls will keep retrying via the
 * background-refresh path.
 */
export async function initAmmSettings(): Promise<void> {
  try {
    await loadFromDb();
  } catch (err) {
    console.error("[AmmSettings] Initial load failed; falling back to defaults:", err);
  }
}

/** Full settings snapshot for admin diagnostics. */
export async function getAmmSettings(): Promise<{
  preResolveCooldownMs: number;
  updatedAt: Date;
  updatedBy: string | null;
}> {
  // Force a fresh read for the admin endpoint so we never show a
  // stale value on the panel — the hot read path keeps using cache.
  const fresh = await loadFromDb();
  return {
    preResolveCooldownMs: fresh.preResolveCooldownMs,
    updatedAt: fresh.updatedAt,
    updatedBy: fresh.updatedBy,
  };
}

interface SetCooldownOpts {
  preResolveCooldownMs: number;
  actorId?: string | null;
}

/**
 * Admin-only mutation. Upserts the singleton row, clamps the value
 * to `[MIN, MAX]`, and busts the cache so subsequent reads see the
 * new value immediately within this process.
 */
export async function setAmmCooldownMs(opts: SetCooldownOpts): Promise<{
  preResolveCooldownMs: number;
  updatedAt: Date;
  updatedBy: string | null;
}> {
  const clamped = clampCooldown(opts.preResolveCooldownMs);
  const now = new Date();
  const { db } = await import("../db");
  await db
    .insert(ammRuntimeSettings)
    .values({
      id: SINGLETON_ID,
      preResolveCooldownMs: clamped,
      updatedAt: now,
      updatedBy: opts.actorId ?? null,
    })
    .onConflictDoUpdate({
      target: ammRuntimeSettings.id,
      set: {
        preResolveCooldownMs: clamped,
        updatedAt: now,
        updatedBy: opts.actorId ?? null,
      },
    });

  cache = null;
  const fresh = await loadFromDb();
  return {
    preResolveCooldownMs: fresh.preResolveCooldownMs,
    updatedAt: fresh.updatedAt,
    updatedBy: fresh.updatedBy,
  };
}

/** Test-only: forces the next read to hit the DB. */
export function _resetAmmSettingsCache(): void {
  cache = null;
}
