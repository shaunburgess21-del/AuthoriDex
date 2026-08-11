/**
 * Opening `velocityScore` per person — the input to the Up/Down opening-price
 * prior (`updown-opening-prices.ts`).
 *
 * Deliberately mirrors `loadOpeningScoreMap`'s primary path: the trailing
 * 6-hour median ending at `asOf`, requiring at least 3 hourly samples. With
 * `asOf = monday` (00:00 UTC) that is the median of Sunday 18:00 → Monday
 * 00:00, i.e. the same window the market's opening *score* is taken from, so
 * price and baseline are measured on the same instant.
 *
 * Two deliberate differences from `loadOpeningScoreMap`:
 *
 *   - **No 7d or latest-tick fallback.** A person with a sparse 6h window has
 *     an unreliable velocity reading, and the correct response is to decline
 *     to price rather than to price on a weaker proxy. Absent from the map →
 *     `pickUpDownOpeningPrices` returns null → the market opens 50/50 exactly
 *     as it does today. Failing to a coin flip is always safe here.
 *   - **No cohort guard.** The baseline guard exists to stop a systemically
 *     wrong Sunday-evening window from moving every market's *resolution*
 *     goalposts. This value only chooses an opening price, and the guard's
 *     7d-median fallback would measure velocity over a window that does not
 *     match the fitted one.
 *
 * Note on the fit: the band threshold in `updown-opening-prices.ts` was
 * measured with a slightly looser snapshot filter (`snapshot_origin =
 * 'ingest'` without the hourly constraint applied here). At a threshold of
 * 40 on a 0–100 scale that difference is far inside the noise, but it is why
 * the threshold is a round number rather than a fitted decimal.
 */

import { sql } from "drizzle-orm";
import {
  OFFICIAL_SNAPSHOT_ORIGIN_SQL,
  OFFICIAL_SNAPSHOT_HOURLY_SQL,
} from "../scoring/official-snapshots";

/** Matches `SIX_HOUR_MIN_SAMPLES` in `openingScores.ts`. */
const SIX_HOUR_MIN_SAMPLES = 3;

export type OpeningVelocity = {
  /** Trailing-6h median `velocity_score`, 0–100. */
  velocity: number;
  /** Latest snapshot timestamp in the window, ISO. */
  snapshotAt: string;
  /** Number of snapshots the median was taken over. */
  sampleCount: number;
};

type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows?: Record<string, unknown>[] }>;
};

export type LoadOpeningVelocityOptions = {
  /** Anchor the trailing window to this instant (defaults to NOW()). */
  asOf?: Date;
};

/**
 * Trailing-6h median `velocity_score` per person.
 *
 * People with fewer than 3 hourly samples in the window are omitted rather
 * than approximated — see the module note.
 */
export async function loadOpeningVelocityMap(
  personIds: string[],
  executor: SqlExecutor,
  options: LoadOpeningVelocityOptions = {},
): Promise<Map<string, OpeningVelocity>> {
  const map = new Map<string, OpeningVelocity>();
  if (personIds.length === 0) return map;

  const asOfIso = (options.asOf ?? new Date()).toISOString();
  const idList = sql.join(
    personIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const rows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY velocity_score)::float AS opening_velocity,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${idList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND velocity_score IS NOT NULL
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - INTERVAL '6 hours'
    GROUP BY person_id
    HAVING COUNT(*) >= ${SIX_HOUR_MIN_SAMPLES}
  `);

  for (const row of rows.rows ?? []) {
    if (row.opening_velocity == null) continue;
    const velocity = Number(row.opening_velocity);
    if (!Number.isFinite(velocity)) continue;
    map.set(String(row.person_id), {
      velocity,
      snapshotAt: new Date(row.snapshot_at as string).toISOString(),
      sampleCount: Number(row.sample_count ?? SIX_HOUR_MIN_SAMPLES),
    });
  }

  return map;
}
