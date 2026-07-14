/**
 * Fame snapshot lookup for native market settlement.
 *
 * Open priority: metadata.openingScore → snapshot near startAt → snapshot near
 * created_at → legacy wide-tolerance fallback (only when no metadata scores).
 *
 * Close priority: snapshot within tolerance of endAt → last official ingest at
 * or before endAt (covers demoted-roster gaps when close window is empty).
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { trendSnapshots } from "@shared/schema";
import { db } from "../db";
import { log } from "../log";
import { officialSnapshotOriginCondition } from "../scoring/official-snapshots";
import {
  computeMedianFameScore,
  ensureDate,
  getCloseSnapshotFallbackMaxHours,
  getNativeCloseMedianHours,
  getStoredOpeningScore,
  type MedianCloseSnapshot,
  type SnapshotScore,
} from "./market-snapshot-utils";

export {
  computeMedianFameScore,
  ensureDate,
  getCloseSnapshotFallbackMaxHours,
  getNativeCloseMedianHours,
  getStoredOpeningScore,
  type MedianCloseSnapshot,
  type SnapshotScore,
} from "./market-snapshot-utils";

export const SNAPSHOT_TOLERANCE_HOURS = 3;

async function findSnapshotScore(
  personId: string,
  rawTargetTime: Date | string,
  direction: "before" | "after",
): Promise<SnapshotScore | null> {
  const targetTime = ensureDate(rawTargetTime);
  if (!targetTime) return null;
  const toleranceMs = SNAPSHOT_TOLERANCE_HOURS * 60 * 60 * 1000;

  if (direction === "before") {
    const rows = await db
      .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
      .from(trendSnapshots)
      .where(and(
        eq(trendSnapshots.personId, personId),
        officialSnapshotOriginCondition(),
        lte(trendSnapshots.timestamp, targetTime),
        gte(trendSnapshots.timestamp, new Date(targetTime.getTime() - toleranceMs)),
      ))
      .orderBy(desc(trendSnapshots.timestamp))
      .limit(1);
    if (rows.length > 0 && rows[0].fameIndex != null) {
      return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp)! };
    }
  }

  if (direction === "after") {
    const rows = await db
      .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
      .from(trendSnapshots)
      .where(and(
        eq(trendSnapshots.personId, personId),
        officialSnapshotOriginCondition(),
        gte(trendSnapshots.timestamp, targetTime),
        lte(trendSnapshots.timestamp, new Date(targetTime.getTime() + 60 * 60 * 1000)),
      ))
      .orderBy(asc(trendSnapshots.timestamp))
      .limit(1);
    if (rows.length > 0 && rows[0].fameIndex != null) {
      return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp)! };
    }
  }

  return null;
}

/**
 * First official ingest at/after market creation, else nearest before within tolerance.
 * Used for mid-week markets whose startAt predates their first scored snapshot.
 */
async function findSnapshotNearCreatedAt(
  personId: string,
  rawCreatedAt: Date | string,
): Promise<SnapshotScore | null> {
  const createdAt = ensureDate(rawCreatedAt);
  if (!createdAt) return null;

  const after = await findSnapshotScore(personId, createdAt, "after");
  if (after) return after;

  const toleranceMs = SNAPSHOT_TOLERANCE_HOURS * 60 * 60 * 1000;
  const rows = await db
    .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      officialSnapshotOriginCondition(),
      lte(trendSnapshots.timestamp, createdAt),
      gte(trendSnapshots.timestamp, new Date(createdAt.getTime() - toleranceMs)),
    ))
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);

  if (rows.length > 0 && rows[0].fameIndex != null) {
    return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp)! };
  }

  return null;
}

async function findLastIngestBefore(personId: string, endAt: Date): Promise<SnapshotScore | null> {
  const rows = await db
    .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      officialSnapshotOriginCondition(),
      lte(trendSnapshots.timestamp, endAt),
    ))
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);

  if (rows.length > 0 && rows[0].fameIndex != null) {
    return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp)! };
  }
  return null;
}

export async function getCloseSnapshot(personId: string, endAt: Date): Promise<SnapshotScore | null> {
  const withinTolerance = (await findSnapshotScore(personId, endAt, "before"))
    ?? (await findSnapshotScore(personId, endAt, "after"));
  if (withinTolerance) return withinTolerance;

  const fallback = await findLastIngestBefore(personId, endAt);
  if (!fallback) return null;

  const ageHours = (endAt.getTime() - fallback.capturedAt.getTime()) / (60 * 60 * 1000);
  const maxAgeHours = getCloseSnapshotFallbackMaxHours();
  if (ageHours > maxAgeHours) {
    log(
      `[MarketSnapshot] close fallback rejected for person=${personId.slice(0, 8)}: ` +
        `last ingest ${ageHours.toFixed(1)}h before endAt (max ${maxAgeHours}h)`,
    );
    return null;
  }

  log(
    `[MarketSnapshot] close fallback for person=${personId.slice(0, 8)}: ` +
      `last ingest before endAt (${fallback.capturedAt.toISOString()}, score=${fallback.score})`,
  );
  return fallback;
}

/**
 * Trailing-median close for native settlement (up/down, H2H, gainer).
 *
 * Mirrors the 6h opening-score median so open→close is not comparing a
 * smoothed week-open to a single Sunday-night tick (the weekend common-mode
 * artifact). When fewer than 2 valid hourly samples exist in the window,
 * falls through to {@link getCloseSnapshot} (single-point / staleness-guarded).
 *
 * Pass `preloadedSingle` to avoid a duplicate `getCloseSnapshot` round-trip
 * when the caller already fetched it for flip-audit comparison.
 */
export async function getMedianCloseSnapshot(
  personId: string,
  endAt: Date,
  windowHours: number = getNativeCloseMedianHours(),
  options?: { preloadedSingle?: SnapshotScore | null },
): Promise<MedianCloseSnapshot | null> {
  const hours = Number.isFinite(windowHours) && windowHours >= 1
    ? Math.min(12, Math.floor(windowHours))
    : getNativeCloseMedianHours();
  const windowStart = new Date(endAt.getTime() - hours * 60 * 60 * 1000);

  const rows = await db
    .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      officialSnapshotOriginCondition(),
      lte(trendSnapshots.timestamp, endAt),
      gte(trendSnapshots.timestamp, windowStart),
    ))
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(hours);

  const valid = rows.filter((r) => r.fameIndex != null && Number.isFinite(Number(r.fameIndex)));
  if (valid.length >= 2) {
    const median = computeMedianFameScore(valid.map((r) => Number(r.fameIndex)));
    if (median == null) return null;
    const capturedAt = ensureDate(valid[0]!.timestamp)!;
    return {
      score: median,
      capturedAt,
      method: "median",
      windowHours: hours,
      sampleCount: valid.length,
    };
  }

  const single =
    options && "preloadedSingle" in (options ?? {})
      ? (options!.preloadedSingle ?? null)
      : await getCloseSnapshot(personId, endAt);
  if (!single) return null;
  return {
    ...single,
    method: "single",
    windowHours: hours,
    sampleCount: 1,
  };
}

export type NativeClosePair = {
  /** Score used for settlement (median when available, else single). */
  settled: MedianCloseSnapshot;
  /** Single-point close for flip-audit comparison (may be null). */
  single: SnapshotScore | null;
};

/**
 * One round-trip pair: single close + median close (median reuses the single
 * on fallback so we never hit `getCloseSnapshot` twice).
 */
export async function resolveNativeClosePair(
  personId: string,
  endAt: Date,
): Promise<NativeClosePair | null> {
  const single = await getCloseSnapshot(personId, endAt);
  const settled = await getMedianCloseSnapshot(personId, endAt, getNativeCloseMedianHours(), {
    preloadedSingle: single,
  });
  if (!settled) return null;
  return { settled, single };
}

/**
 * When any entry in a multi-person market falls back to single-point close,
 * force every entry onto single so we don't compare median vs single across
 * people. Pure helper — exported for unit tests.
 */
export function alignCloseMethodsForMarket(
  pairs: NativeClosePair[],
): MedianCloseSnapshot[] {
  const anySingle = pairs.some((p) => p.settled.method === "single");
  if (!anySingle) return pairs.map((p) => p.settled);

  return pairs.map((p) => {
    if (p.single) {
      return {
        ...p.single,
        method: "single" as const,
        windowHours: p.settled.windowHours,
        sampleCount: 1,
      };
    }
    return p.settled;
  });
}

export async function getOpenSnapshot(
  personId: string,
  rawStartAt: Date | string,
  market: { id?: string; createdAt?: Date | string; metadata?: unknown },
): Promise<SnapshotScore | null> {
  const stored = getStoredOpeningScore(market, personId);
  if (stored) return stored;

  const startAt = ensureDate(rawStartAt);
  if (!startAt) return null;

  const nearStart = (await findSnapshotScore(personId, startAt, "after"))
    ?? (await findSnapshotScore(personId, startAt, "before"));
  if (nearStart) return nearStart;

  if (market.createdAt) {
    const nearCreated = await findSnapshotNearCreatedAt(personId, market.createdAt);
    if (nearCreated) {
      log(
        `[MarketSnapshot] open via created_at for market=${market.id?.slice(0, 8) ?? "?"} ` +
          `person=${personId.slice(0, 8)}: ${nearCreated.capturedAt.toISOString()}, score=${nearCreated.score}`,
      );
      return nearCreated;
    }
  }

  const meta = market.metadata as Record<string, unknown> | null | undefined;
  const hasMetadataScores = meta?.openingScore || meta?.openingScores;
  if (hasMetadataScores) {
    return null;
  }

  log(`[MarketSnapshot] wide-tolerance fallback for legacy market ${market.id ?? "?"}`);
  const wideRows = await db
    .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      officialSnapshotOriginCondition(),
      gte(trendSnapshots.timestamp, new Date(startAt.getTime() - 7 * 24 * 60 * 60 * 1000)),
      lte(trendSnapshots.timestamp, new Date(startAt.getTime() + 24 * 60 * 60 * 1000)),
    ))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${trendSnapshots.timestamp} - ${startAt}::timestamp))`)
    .limit(1);
  if (wideRows.length > 0 && wideRows[0].fameIndex != null) {
    return { score: wideRows[0].fameIndex, capturedAt: ensureDate(wideRows[0].timestamp)! };
  }
  return null;
}
