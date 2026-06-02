/**
 * Canonical hourly snapshot stream for settlement, opening baselines, and agents.
 *
 * Only `snapshot_origin = 'ingest'` rows are official closes (hour-truncated,
 * one per person per hour from the ingest job). Money-critical and eligibility
 * reads must go through this module — never query `trend_snapshots` unfiltered.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import { trendSnapshots } from "@shared/schema";

/** Origin written by hourly ingest — the single settlement / eligibility basis. */
export const OFFICIAL_SNAPSHOT_ORIGIN = "ingest" as const;

/** Reserved for future intra-hour cosmetic ticks (not persisted today). */
export const LIVE_SNAPSHOT_ORIGIN = "live" as const;

/** Bootstrap rows for new inductees (must match DB chk_snapshot_origin_values). */
export const INDUCTION_ONBOARD_SNAPSHOT_ORIGIN = "ingest" as const;

export function officialSnapshotOriginCondition(): SQL {
  return eq(trendSnapshots.snapshotOrigin, OFFICIAL_SNAPSHOT_ORIGIN);
}

/** Raw SQL fragment for hand-written queries (openingScores, etc.). */
export const OFFICIAL_SNAPSHOT_ORIGIN_SQL = sql`'ingest'`;

/** Hour-bucket guard — official ingest rows are always on the hour. */
export const OFFICIAL_SNAPSHOT_HOURLY_SQL = sql`timestamp = date_trunc('hour', timestamp)`;
