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
  ensureDate,
  getCloseSnapshotFallbackMaxHours,
  getStoredOpeningScore,
  type SnapshotScore,
} from "./market-snapshot-utils";

export {
  ensureDate,
  getCloseSnapshotFallbackMaxHours,
  getStoredOpeningScore,
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
