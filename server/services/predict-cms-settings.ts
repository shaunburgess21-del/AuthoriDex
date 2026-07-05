/**
 * Admin-tunable Predict CMS presentation knobs, backed by the
 * `predict_cms_settings` singleton row.
 *
 * First knob: `worldMarketsSortMode` — how the PUBLIC /api/open-markets
 * feed is ordered for everyone. Lets an admin flip the front-end to
 * "newest first" (e.g. to showcase a fresh scout batch) and back to the
 * default volume sort without a deploy.
 *
 * Cache pattern matches `server/native-markets/amm-settings.ts`: a short
 * TTL in-process cache so the hot list endpoint doesn't pay a DB read per
 * request, while CMS changes still propagate within seconds. Reads never
 * throw — any failure falls back to the default mode.
 */

import { eq } from "drizzle-orm";
import { predictCmsSettings } from "@shared/schema";

const SINGLETON_ID = "global";
const REFRESH_INTERVAL_MS = 10_000;

export const WORLD_MARKETS_SORT_MODES = ["volume", "newest", "manual", "endAt"] as const;
export type WorldMarketsSortMode = (typeof WORLD_MARKETS_SORT_MODES)[number];
export const DEFAULT_WORLD_MARKETS_SORT_MODE: WorldMarketsSortMode = "volume";

function coerceMode(v: unknown): WorldMarketsSortMode {
  return WORLD_MARKETS_SORT_MODES.includes(v as WorldMarketsSortMode)
    ? (v as WorldMarketsSortMode)
    : DEFAULT_WORLD_MARKETS_SORT_MODE;
}

interface CachedSettings {
  worldMarketsSortMode: WorldMarketsSortMode;
  updatedAt: Date;
  updatedBy: string | null;
  fetchedAt: number;
}

let cache: CachedSettings | null = null;
let inflight: Promise<CachedSettings> | null = null;

async function loadFromDb(): Promise<CachedSettings> {
  const { db } = await import("../db");
  const rows = await db
    .select()
    .from(predictCmsSettings)
    .where(eq(predictCmsSettings.id, SINGLETON_ID))
    .limit(1);

  const row = rows[0];
  // Missing row (fresh DB, migration not yet applied) → default mode.
  const next: CachedSettings = {
    worldMarketsSortMode: coerceMode(row?.worldMarketsSortMode),
    updatedAt: row?.updatedAt ?? new Date(0),
    updatedBy: row?.updatedBy ?? null,
    fetchedAt: Date.now(),
  };
  cache = next;
  return next;
}

/**
 * Cached read for the public list endpoint. Serves the cached value when
 * fresh; otherwise refreshes inline (first call) or in the background.
 * Never throws — falls back to the default mode on DB errors.
 */
export async function getWorldMarketsSortMode(): Promise<WorldMarketsSortMode> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < REFRESH_INTERVAL_MS) {
    return cache.worldMarketsSortMode;
  }
  if (!inflight) {
    inflight = loadFromDb().finally(() => {
      inflight = null;
    });
  }
  try {
    const fresh = await inflight;
    return fresh.worldMarketsSortMode;
  } catch (err) {
    console.error("[PredictCmsSettings] Read failed; using default sort:", err);
    return cache?.worldMarketsSortMode ?? DEFAULT_WORLD_MARKETS_SORT_MODE;
  }
}

/** Fresh snapshot for the admin panel (bypasses the TTL cache). */
export async function getPredictCmsSettings(): Promise<{
  worldMarketsSortMode: WorldMarketsSortMode;
  updatedAt: Date;
  updatedBy: string | null;
}> {
  const fresh = await loadFromDb();
  return {
    worldMarketsSortMode: fresh.worldMarketsSortMode,
    updatedAt: fresh.updatedAt,
    updatedBy: fresh.updatedBy,
  };
}

/**
 * Admin-only mutation. Upserts the singleton row and busts the cache so
 * the public feed picks up the new order on the next request from this
 * process (other instances converge within REFRESH_INTERVAL_MS).
 */
export async function setWorldMarketsSortMode(opts: {
  mode: WorldMarketsSortMode;
  actorId?: string | null;
}): Promise<{
  worldMarketsSortMode: WorldMarketsSortMode;
  updatedAt: Date;
  updatedBy: string | null;
}> {
  const mode = coerceMode(opts.mode);
  const now = new Date();
  const { db } = await import("../db");
  await db
    .insert(predictCmsSettings)
    .values({
      id: SINGLETON_ID,
      worldMarketsSortMode: mode,
      updatedAt: now,
      updatedBy: opts.actorId ?? null,
    })
    .onConflictDoUpdate({
      target: predictCmsSettings.id,
      set: {
        worldMarketsSortMode: mode,
        updatedAt: now,
        updatedBy: opts.actorId ?? null,
      },
    });

  cache = null;
  const fresh = await loadFromDb();
  return {
    worldMarketsSortMode: fresh.worldMarketsSortMode,
    updatedAt: fresh.updatedAt,
    updatedBy: fresh.updatedBy,
  };
}
