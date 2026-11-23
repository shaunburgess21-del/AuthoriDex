/**
 * Returning-user strip on /vote (item 44).
 *
 * Visibility, the resolved-count, and the last-seen stamp are pure so the
 * slot can be decided synchronously and tested without a browser. Rank
 * progress uses shared/rank-config.ts — the same ladder XPProgressBar
 * reads from the ranks API — so the strip does not fetch ranks.
 */

import { RANKS } from "@shared/rank-config";

export const RETURNING_USER_ID_STORAGE_KEY = "voxdex_returning_user_id";
export const RESOLVED_LAST_SEEN_STORAGE_KEY = "voxdex_vote_resolved_seen_at";

export interface StripStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ReturningUserGateInput {
  /** Signed-in user, or null when auth has no user yet. */
  user: unknown;
  /** Profile field. Undefined while the profile has not loaded. */
  onboardingCompletedAt: string | null | undefined;
  firstVisitSession: boolean;
}

/**
 * Canonical visibility gate: signed-in, onboarding finished, and not the
 * visitor's first browser session. Signed-out and first-visit users fail.
 */
export function shouldShowReturningUserStrip(input: ReturningUserGateInput): boolean {
  return Boolean(input.user) && Boolean(input.onboardingCompletedAt) && !input.firstVisitSession;
}

export interface ReturningStripPaintInput extends ReturningUserGateInput {
  /** Profile loaded for this user, or auth settled with nobody signed in. */
  profileSettled: boolean;
  /** User id in the persisted Supabase session, read synchronously. */
  persistedUserId: string | null;
  /** User id we previously observed with onboardingCompletedAt set. */
  cachedReturningUserId: string | null;
}

/**
 * First-paint decision. Returning status is known from the persisted
 * session plus the onboarding cache, so the slot is either in the first
 * commit or not at all. Callers must latch this — flipping it on once
 * the profile arrives mounts the row late and shifts the page.
 */
export function returningStripVisibleAtPaint(input: ReturningStripPaintInput): boolean {
  if (input.firstVisitSession) return false;
  if (input.profileSettled) {
    return shouldShowReturningUserStrip(input);
  }
  const userId = userIdOf(input.user) ?? input.persistedUserId;
  return Boolean(userId) && userId === input.cachedReturningUserId;
}

function userIdOf(user: unknown): string | null {
  if (!user || typeof user !== "object" || !("id" in user)) return null;
  const id = (user as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function readCachedReturningUserId(storage: Pick<StripStorage, "getItem">): string | null {
  try {
    const raw = storage.getItem(RETURNING_USER_ID_STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function rememberReturningUser(storage: Pick<StripStorage, "setItem">, userId: string): void {
  try {
    storage.setItem(RETURNING_USER_ID_STORAGE_KEY, userId);
  } catch {
    /* private mode / quota */
  }
}

export function forgetReturningUser(storage: Pick<StripStorage, "removeItem">): void {
  try {
    storage.removeItem(RETURNING_USER_ID_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

/** Epoch ms, or null when the visitor has never left the strip. */
export function readResolvedLastSeenAt(storage: Pick<StripStorage, "getItem">): number | null {
  try {
    const raw = storage.getItem(RESOLVED_LAST_SEEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function stampResolvedLastSeenAt(storage: Pick<StripStorage, "setItem">, now: number): void {
  try {
    storage.setItem(RESOLVED_LAST_SEEN_STORAGE_KEY, String(now));
  } catch {
    /* private mode / quota */
  }
}

export interface SettledPredictionRow {
  result: string;
  settledAt?: string | null;
  /**
   * Carried so callers can see the market, but the count does not branch
   * on it. Up/Down, head-to-head, gainer, jackpot, and world markets all
   * count once they have a non-pending result and a settlement time.
   */
  marketType?: string | null;
}

export type ResolvedLastSeenReason =
  | "mount"
  | "fetch"
  | "visibility-hidden"
  | "unmount"
  | "other-page"
  | "results-sheet";

/**
 * The chip stays until the visitor opens the results sheet.
 * Mount, fetch, hiding the tab, leaving /vote, and other pages must not
 * advance the stamp — those used to mark an overnight settlement as seen
 * before the sheet was opened, and a reload then kept the chip hidden.
 */
export function shouldStampResolvedLastSeen(reason: ResolvedLastSeenReason): boolean {
  return reason === "results-sheet";
}

/**
 * A non-pending row whose settledAt is strictly after the stamp.
 * A missing stamp uses cutoff 0, so every dated settlement counts.
 * The caller must read this before writing a new stamp.
 */
export function settledAfterLastSeen(
  row: SettledPredictionRow,
  lastSeenAtMs: number | null,
): boolean {
  if (row.result === "pending") return false;
  if (!row.settledAt) return false;
  const settled = Date.parse(row.settledAt);
  const cutoff = lastSeenAtMs ?? 0;
  return Number.isFinite(settled) && settled > cutoff;
}

/**
 * Rows from GET /api/me/predictions that settled after `lastSeenAtMs`.
 * Pending rows never count. A missing stamp counts every settled row
 * (cutoff 0) — the caller must compute this before writing the stamp.
 */
export function countNewlyResolvedPredictions(
  rows: readonly SettledPredictionRow[],
  lastSeenAtMs: number | null,
): number {
  let count = 0;
  for (const row of rows) {
    if (settledAfterLastSeen(row, lastSeenAtMs)) count += 1;
  }
  return count;
}

export function settledAtFromPayload(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

/** Accepts the `{ predictions }` payload and the legacy bare array. */
export function rowsFromPredictionsResponse(data: unknown): SettledPredictionRow[] {
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        "predictions" in data &&
        Array.isArray((data as { predictions: unknown }).predictions)
      ? (data as { predictions: unknown[] }).predictions
      : [];
  const rows: SettledPredictionRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { result?: unknown; settledAt?: unknown; marketType?: unknown };
    rows.push({
      result: typeof row.result === "string" ? row.result : "",
      settledAt: settledAtFromPayload(row.settledAt),
      marketType: typeof row.marketType === "string" && row.marketType.length > 0 ? row.marketType : null,
    });
  }
  return rows;
}

export interface XpRankProgress {
  /** Null at the top tier. */
  xpToNext: number | null;
  nextRankName: string | null;
  /** 0–100, same ratio XPProgressBar paints. */
  progressPct: number;
}

/**
 * Same lookup XPProgressBar uses against the ranks API: the tier whose
 * window contains `xp`, then the next row in tier order. Thresholds come
 * from shared/rank-config.ts, which seeds that API.
 */
export function xpRankProgress(xp: number): XpRankProgress {
  const safeXp = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  const sorted = [...RANKS].sort((a, b) => a.tier - b.tier);
  const current =
    sorted.find((rank) => safeXp >= rank.minXp && (rank.maxXp === null || safeXp <= rank.maxXp)) ??
    sorted[0];
  const currentIdx = sorted.indexOf(current);
  const next = currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;
  if (!next) {
    return { xpToNext: null, nextRankName: null, progressPct: 100 };
  }
  const span = next.minXp - current.minXp;
  const raw = span > 0 ? ((safeXp - current.minXp) / span) * 100 : 100;
  return {
    xpToNext: next.minXp - safeXp,
    nextRankName: next.name,
    progressPct: Math.min(100, Math.max(0, raw)),
  };
}

/** "530 XP to Aspirant", or the top-tier line XPProgressBar uses. */
export function xpRankProgressLabel(progress: XpRankProgress): string {
  if (progress.xpToNext == null || progress.nextRankName == null) return "Max rank reached";
  return `${progress.xpToNext.toLocaleString("en-US")} XP to ${progress.nextRankName}`;
}

/** "4-day streak", or the zero-streak prompt. */
export function streakStripLabel(streak: number): string {
  const days = Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0;
  if (days <= 0) return "Start a streak today";
  return `${days}-day streak`;
}

export function browserLocalStorage(): StripStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
