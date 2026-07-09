import { sql } from "drizzle-orm";
import { log } from "../log";
import {
  evaluateBaselineCohortGuard,
  type BaselineGuardPersonInput,
} from "./baseline-guard";
import {
  OFFICIAL_SNAPSHOT_ORIGIN_SQL,
  OFFICIAL_SNAPSHOT_HOURLY_SQL,
} from "../scoring/official-snapshots";

export type SnapshotScore = {
  score: number;
  snapshotAt: string;
  /** Number of trend_snapshots in the window; 1 when single-tick fallback. */
  sampleCount?: number;
  /** How the opening score was derived: 6h_median | 7d_median | latest_tick */
  windowMethod?: "6h_median" | "7d_median" | "latest_tick";
  windowDays?: number;
  /** True when the cohort baseline guard forced 7d median for this week. */
  guardTriggered?: boolean;
};

export type OpeningScore = SnapshotScore & {
  personId: string;
};

export type LoadOpeningScoreOptions = {
  /** Anchor the trailing window to this instant (defaults to NOW()). */
  asOf?: Date;
  /**
   * When true, evaluate the cohort anomaly guard (ratio band + provider-dark
   * share) and fall back to 7d median for everyone if tripped. Weekly
   * generator only — leave false for single-inductee paths.
   */
  cohortGuard?: boolean;
};

/**
 * Minimum samples for the 6h primary window. 3 is the smallest count that
 * makes a median meaningful; in practice hourly ingest produces 6 samples
 * for any person with healthy recent coverage.
 */
const SIX_HOUR_MIN_SAMPLES = 3;

/**
 * Minimum samples for the 7d fallback window. People who fall through to
 * this path have sparse recent coverage (e.g. a new inductee or someone
 * with an ingest gap); requiring 24 hourly samples over 7 days ensures
 * the fallback is still a real central tendency, not a couple of stray
 * ticks.
 */
const SEVEN_DAY_MIN_SAMPLES = 24;

type SixHourRow = {
  personId: string;
  openingScore: number;
  snapshotAt: string;
  sampleCount: number;
  maxNews: number;
  maxWiki: number;
};

type SevenDayRow = {
  personId: string;
  openingScore: number;
  snapshotAt: string;
  sampleCount: number;
};

export function buildOpeningScores(
  personIds: string[],
  snapMap: Map<string, SnapshotScore>,
): OpeningScore[] {
  return personIds
    .map((personId) => ({ personId, snap: snapMap.get(personId) }))
    .filter((row): row is { personId: string; snap: SnapshotScore } => Boolean(row.snap))
    .map((row) => ({
      personId: row.personId,
      score: row.snap.score,
      snapshotAt: row.snap.snapshotAt,
      ...(row.snap.sampleCount != null ? { sampleCount: row.snap.sampleCount } : {}),
      ...(row.snap.windowMethod != null ? { windowMethod: row.snap.windowMethod } : {}),
      ...(row.snap.windowDays != null ? { windowDays: row.snap.windowDays } : {}),
      ...(row.snap.guardTriggered != null ? { guardTriggered: row.snap.guardTriggered } : {}),
    }));
}

type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows?: Record<string, unknown>[] }>;
};

function parseSixHourRows(rows: Record<string, unknown>[] | undefined): SixHourRow[] {
  const out: SixHourRow[] = [];
  for (const row of rows ?? []) {
    if (row.opening_score == null) continue;
    out.push({
      personId: String(row.person_id),
      openingScore: Number(row.opening_score),
      snapshotAt: new Date(row.snapshot_at as string).toISOString(),
      sampleCount: Number(row.sample_count ?? SIX_HOUR_MIN_SAMPLES),
      maxNews: Number(row.max_news ?? 0),
      maxWiki: Number(row.max_wiki ?? 0),
    });
  }
  return out;
}

function parseSevenDayRows(rows: Record<string, unknown>[] | undefined): SevenDayRow[] {
  const out: SevenDayRow[] = [];
  for (const row of rows ?? []) {
    if (row.opening_score == null) continue;
    out.push({
      personId: String(row.person_id),
      openingScore: Number(row.opening_score),
      snapshotAt: new Date(row.snapshot_at as string).toISOString(),
      sampleCount: Number(row.sample_count ?? SEVEN_DAY_MIN_SAMPLES),
    });
  }
  return out;
}

function snapshotFrom7d(row: SevenDayRow, guardTriggered?: boolean): SnapshotScore {
  return {
    score: row.openingScore,
    snapshotAt: row.snapshotAt,
    sampleCount: row.sampleCount,
    windowMethod: "7d_median",
    windowDays: 7,
    ...(guardTriggered ? { guardTriggered: true } : {}),
  };
}

function snapshotFrom6h(row: SixHourRow): SnapshotScore {
  return {
    score: row.openingScore,
    snapshotAt: row.snapshotAt,
    sampleCount: row.sampleCount,
    windowMethod: "6h_median",
  };
}

async function loadLatestTickMap(
  personIds: string[],
  executor: SqlExecutor,
  asOfIso: string,
): Promise<Map<string, SnapshotScore>> {
  const map = new Map<string, SnapshotScore>();
  if (personIds.length === 0) return map;

  const missingList = sql.join(personIds.map((id) => sql`${id}`), sql`, `);
  const fallbackRows = await executor.execute(sql`
    SELECT DISTINCT ON (person_id) person_id, fame_index, timestamp
    FROM trend_snapshots
    WHERE person_id IN (${missingList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp > ${asOfIso}::timestamptz - INTERVAL '14 days'
    ORDER BY person_id, timestamp DESC
  `);

  for (const row of fallbackRows.rows ?? []) {
    if (row.fame_index == null) continue;
    map.set(String(row.person_id), {
      score: Number(row.fame_index),
      snapshotAt: new Date(row.timestamp as string).toISOString(),
      sampleCount: 1,
      windowMethod: "latest_tick",
    });
  }
  return map;
}

async function querySixHourMedians(
  personIds: string[],
  executor: SqlExecutor,
  asOfIso: string,
  includeProviderStats: boolean,
): Promise<SixHourRow[]> {
  if (personIds.length === 0) return [];

  const idList = sql.join(personIds.map((id) => sql`${id}`), sql`, `);
  const providerCols = includeProviderStats
    ? sql`, MAX(news_count)::float AS max_news, MAX(wiki_pageviews)::float AS max_wiki`
    : sql``;

  const sixHourRows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fame_index)::int AS opening_score,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
           ${providerCols}
    FROM trend_snapshots
    WHERE person_id IN (${idList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - INTERVAL '6 hours'
    GROUP BY person_id
    HAVING COUNT(*) >= ${SIX_HOUR_MIN_SAMPLES}
  `);

  return parseSixHourRows(sixHourRows.rows);
}

async function querySevenDayMedians(
  personIds: string[],
  executor: SqlExecutor,
  asOfIso: string,
): Promise<SevenDayRow[]> {
  if (personIds.length === 0) return [];

  const idList = sql.join(personIds.map((id) => sql`${id}`), sql`, `);
  const sevenDayRows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fame_index)::int AS opening_score,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${idList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - INTERVAL '7 days'
    GROUP BY person_id
    HAVING COUNT(*) >= ${SEVEN_DAY_MIN_SAMPLES}
  `);

  return parseSevenDayRows(sevenDayRows.rows);
}

function buildGuardInputs(
  sixHour: SixHourRow[],
  sevenDay: SevenDayRow[],
): BaselineGuardPersonInput[] {
  const sevenById = new Map(sevenDay.map((r) => [r.personId, r]));
  const sixById = new Map(sixHour.map((r) => [r.personId, r]));
  const ids = new Set([...sixById.keys(), ...sevenById.keys()]);

  const people: BaselineGuardPersonInput[] = [];
  for (const personId of ids) {
    const s6 = sixById.get(personId);
    const s7 = sevenById.get(personId);
    const input: BaselineGuardPersonInput = { personId };
    if (s6 && s7 && s7.openingScore > 0) {
      input.ratio6hTo7d = s6.openingScore / s7.openingScore;
    }
    if (s6) {
      input.newsDark = s6.maxNews <= 0;
      input.wikiDark = s6.maxWiki <= 0;
    }
    people.push(input);
  }
  return people;
}

function logGuardEvaluation(
  asOfIso: string,
  result: ReturnType<typeof evaluateBaselineCohortGuard>,
): void {
  const ratio =
    result.cohortMedianRatio != null ? result.cohortMedianRatio.toFixed(3) : "n/a";
  const news =
    result.newsDarkShare != null
      ? `${(result.newsDarkShare * 100).toFixed(1)}%`
      : "n/a";
  const wiki =
    result.wikiDarkShare != null
      ? `${(result.wikiDarkShare * 100).toFixed(1)}%`
      : "n/a";
  const level = result.triggered ? "WARN" : "INFO";
  log(
    `[OpeningScores:BaselineGuard] ${level} asOf=${asOfIso} ` +
      `triggered=${result.triggered} reason=${result.reason} ` +
      `cohortMedianRatio=${ratio} newsDark=${news} wikiDark=${wiki} ` +
      `evaluated=${result.evaluatedCount}`,
  );
}

/**
 * Opening score per person. Priority (changed Jul 2026 — see note below):
 *   1. 6-hour trailing median of fame_index (>= 3 samples) ending at `asOf`
 *      — primary path. With `asOf = monday` (00:00 UTC) this is the median
 *      of Sunday 18:00 → Monday 00:00, i.e. "where they were Sunday evening"
 *      rather than the trailing-week median. The previous 7d-median primary
 *      captured intra-week peaks and made almost every runner appear "down"
 *      vs baseline on naturally-declining weeks.
 *   2. 7-day trailing median when >= 24 samples — fallback for people whose
 *      recent 6h window is too sparse (e.g. a new inductee or someone with
 *      an ingest gap right at the week boundary). Keeps a real central
 *      tendency instead of dropping to a single tick.
 *   3. Latest single tick within 14 days — last resort.
 *
 * When `cohortGuard` is true (weekly generator), a cohort-level anomaly
 * check runs first: if the Sunday-evening window looks systemically wrong,
 * everyone with a 7d median uses that instead of 6h for this week only.
 *
 * Baseline choice only affects NEW markets created by the weekly generator.
 * Already-OPEN markets keep the `metadata.openingScore` they were created
 * with, so this change never retroactively moves the goalposts on a market
 * that has bets against it.
 */
export async function loadOpeningScoreMap(
  personIds: string[],
  executor: SqlExecutor,
  options: LoadOpeningScoreOptions = {},
): Promise<Map<string, SnapshotScore>> {
  const map = new Map<string, SnapshotScore>();
  if (personIds.length === 0) return map;

  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const useCohortGuard = options.cohortGuard === true;

  if (useCohortGuard) {
    const [sixHour, sevenDay] = await Promise.all([
      querySixHourMedians(personIds, executor, asOfIso, true),
      querySevenDayMedians(personIds, executor, asOfIso),
    ]);

    const guardInputs = buildGuardInputs(sixHour, sevenDay);
    const guardResult = evaluateBaselineCohortGuard(guardInputs);
    logGuardEvaluation(asOfIso, guardResult);

    const sevenById = new Map(sevenDay.map((r) => [r.personId, r]));
    const sixById = new Map(sixHour.map((r) => [r.personId, r]));

    if (guardResult.triggered) {
      for (const row of sevenDay) {
        map.set(row.personId, snapshotFrom7d(row, true));
      }
      const missing7d = personIds.filter((id) => !map.has(id));
      const latestMap = await loadLatestTickMap(missing7d, executor, asOfIso);
      for (const [id, snap] of latestMap) {
        map.set(id, snap);
      }
      return map;
    }

    for (const row of sixHour) {
      map.set(row.personId, snapshotFrom6h(row));
    }
    const missingAfter6h = personIds.filter((id) => !map.has(id));
    for (const id of missingAfter6h) {
      const row = sevenById.get(id);
      if (row) map.set(id, snapshotFrom7d(row));
    }
    const missing = personIds.filter((id) => !map.has(id));
    const latestMap = await loadLatestTickMap(missing, executor, asOfIso);
    for (const [id, snap] of latestMap) {
      map.set(id, snap);
    }
    return map;
  }

  const sixHour = await querySixHourMedians(personIds, executor, asOfIso, false);

  for (const row of sixHour) {
    map.set(row.personId, snapshotFrom6h(row));
  }

  const missingAfter6h = personIds.filter((id) => !map.has(id));
  if (missingAfter6h.length === 0) return map;

  const sevenDay = await querySevenDayMedians(missingAfter6h, executor, asOfIso);
  for (const row of sevenDay) {
    map.set(row.personId, snapshotFrom7d(row));
  }

  const missing = personIds.filter((id) => !map.has(id));
  if (missing.length === 0) return map;

  const latestMap = await loadLatestTickMap(missing, executor, asOfIso);
  for (const [id, snap] of latestMap) {
    map.set(id, snap);
  }

  return map;
}
