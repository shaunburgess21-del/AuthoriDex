// Read-only pre-enable audit for the News Share-of-Voice supply correction.
//
// Replays the last ~90 days of persisted `trend_snapshots.news_count` and, for
// each UTC day, computes the cohort supply correction factor exactly as the
// live path would (server/scoring/news-supply.ts) and compares the daily
// "up-share" of the news signal WITH vs WITHOUT the correction.
//
// "Up-share" = fraction of people whose daily news level rose vs the previous
// day. The investigation showed this swinging cohort-wide (e.g. 7% up one day,
// 96% the next) whenever global article supply shifted — the exact
// synchronization we want to remove. The news signal is ~39% of the fameIndex
// and is the dominant driver of that co-movement, so flattening the news
// up-share toward a balanced band is the success signal.
//
// Success criteria (printed as a verdict):
//   - The supply-shock windows (Serper lapse Jun 16–29, recovery Jun 30–Jul 1)
//     move from extreme up-share toward the balanced 35–65% band.
//   - The current week's factor is ~1.0, confirming a safe, low-impact enable.
//
// This is a distribution study only — it does NOT recompute fameIndex and does
// NOT write anything. Uniform per-day factors preserve within-day ordering; the
// day-over-day DIRECTION per person is what the correction changes.
//
// Usage: npm run -s audit:news-sov

import { db } from "../db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import {
  NEWS_SOV_MIN_FACTOR,
  NEWS_SOV_MAX_FACTOR,
  NEWS_SOV_MIN_COHORT,
  cohortMean,
  computeNewsSupplyFactors,
} from "../scoring/news-supply";

const SAMPLE_DAYS = 90;
const REFERENCE_WINDOW_DAYS = 7; // trailing window for S_ref, mirrors news stats
const BALANCED_LOW = 0.35;
const BALANCED_HIGH = 0.65;

type PersonDay = { personId: string; day: string; news: number };

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Fraction of people whose value strictly rose vs their previous day. */
function upShare(
  today: Map<string, number>,
  yesterday: Map<string, number>,
): { upPct: number; compared: number } {
  let up = 0;
  let compared = 0;
  for (const [personId, val] of today) {
    const prev = yesterday.get(personId);
    if (prev === undefined) continue;
    compared += 1;
    if (val > prev) up += 1;
  }
  return { upPct: compared > 0 ? up / compared : 0, compared };
}

async function main() {
  const windowStart = new Date(Date.now() - (SAMPLE_DAYS + REFERENCE_WINDOW_DAYS) * 24 * 60 * 60 * 1000);

  // Per-person per-day mean news_count over hourly ingest snapshots.
  const rows = (
    await db.execute(sql`
      SELECT
        person_id AS "personId",
        to_char(date_trunc('day', timestamp), 'YYYY-MM-DD') AS day,
        AVG(news_count)::float AS news
      FROM trend_snapshots
      WHERE snapshot_origin = 'ingest'
        AND timestamp = date_trunc('hour', timestamp)
        AND news_count IS NOT NULL
        AND timestamp >= ${windowStart}
      GROUP BY person_id, date_trunc('day', timestamp)
      ORDER BY day ASC
    `)
  ).rows as unknown as PersonDay[];

  if (rows.length === 0) {
    console.error("[audit-news-sov] No snapshot rows in window — nothing to audit.");
    process.exit(1);
  }

  // Group into day -> (personId -> news).
  const byDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = byDay.get(r.day);
    if (!m) {
      m = new Map();
      byDay.set(r.day, m);
    }
    m.set(r.personId, Number(r.news) || 0);
  }
  const days = Array.from(byDay.keys()).sort();

  // Per-day cohort supply level S_now(d).
  const supplyByDay = new Map<string, number>();
  for (const d of days) {
    supplyByDay.set(d, cohortMean(Array.from(byDay.get(d)!.values())));
  }

  // For each day: S_ref = mean cohort supply over the trailing 7 days (strictly
  // prior), then the supply factor, then raw vs corrected up-share.
  type DayResult = {
    day: string;
    cohort: number;
    supplyNow: number;
    supplyRef: number;
    factorVolume: number;
    applied: boolean;
    upPctRaw: number;
    upPctCorrected: number;
    compared: number;
  };
  const results: DayResult[] = [];

  for (let i = 1; i < days.length; i++) {
    const d = days[i];
    const prevD = days[i - 1];
    const todayMap = byDay.get(d)!;
    const yestMap = byDay.get(prevD)!;

    // Trailing reference window (strictly prior days).
    const refStart = Math.max(0, i - REFERENCE_WINDOW_DAYS);
    const refVals: number[] = [];
    for (let j = refStart; j < i; j++) {
      const s = supplyByDay.get(days[j]);
      if (s !== undefined) refVals.push(s);
    }
    const supplyRef = cohortMean(refVals);
    const supplyNow = supplyByDay.get(d)!;
    const supplyRefPrev = (() => {
      const start = Math.max(0, i - 1 - REFERENCE_WINDOW_DAYS);
      const vals: number[] = [];
      for (let j = start; j < i - 1; j++) {
        const s = supplyByDay.get(days[j]);
        if (s !== undefined) vals.push(s);
      }
      return cohortMean(vals);
    })();

    const factorToday = computeNewsSupplyFactors(
      { supplyNow, supply7d: supplyNow, supplyRef, cohortSize: todayMap.size },
      { enabled: true, minFactor: NEWS_SOV_MIN_FACTOR, maxFactor: NEWS_SOV_MAX_FACTOR, minCohort: NEWS_SOV_MIN_COHORT },
    );
    const factorYest = computeNewsSupplyFactors(
      { supplyNow: supplyByDay.get(prevD)!, supply7d: supplyByDay.get(prevD)!, supplyRef: supplyRefPrev, cohortSize: yestMap.size },
      { enabled: true, minFactor: NEWS_SOV_MIN_FACTOR, maxFactor: NEWS_SOV_MAX_FACTOR, minCohort: NEWS_SOV_MIN_COHORT },
    );

    const rawUp = upShare(todayMap, yestMap);

    // Corrected: scale each day's per-person values by that day's factor.
    const correctedToday = new Map<string, number>();
    for (const [pid, v] of todayMap) correctedToday.set(pid, v * factorToday.factorVolume);
    const correctedYest = new Map<string, number>();
    for (const [pid, v] of yestMap) correctedYest.set(pid, v * factorYest.factorVolume);
    const corrUp = upShare(correctedToday, correctedYest);

    results.push({
      day: d,
      cohort: todayMap.size,
      supplyNow: Math.round(supplyNow * 100) / 100,
      supplyRef: Math.round(supplyRef * 100) / 100,
      factorVolume: Math.round(factorToday.factorVolume * 1000) / 1000,
      applied: factorToday.applied,
      upPctRaw: rawUp.upPct,
      upPctCorrected: corrUp.upPct,
      compared: rawUp.compared,
    });
  }

  const inBand = (x: number) => x >= BALANCED_LOW && x <= BALANCED_HIGH;
  const rawBalancedDays = results.filter((r) => inBand(r.upPctRaw)).length;
  const corrBalancedDays = results.filter((r) => inBand(r.upPctCorrected)).length;

  const meanAbsDev = (key: "upPctRaw" | "upPctCorrected") =>
    results.reduce((s, r) => s + Math.abs(r[key] - 0.5), 0) / (results.length || 1);

  // Extreme-day analysis — the real objective. The whole-cohort tides show up
  // as days where the raw up-share is far from balanced (a supply shock pushed
  // almost everyone the same way). Of those, how many did the correction pull
  // toward centre? (Balanced days being nudged a few points is expected and
  // harmless, so they are excluded from this success metric.)
  const extremeRaw = results.filter((r) => !inBand(r.upPctRaw));
  const extremeMovedToCentre = extremeRaw.filter(
    (r) => Math.abs(r.upPctCorrected - 0.5) < Math.abs(r.upPctRaw - 0.5) - 0.02,
  );
  const extremeStillExtremeAfter = extremeRaw.filter((r) => !inBand(r.upPctCorrected)).length;

  // Current-week factor: mean of the most recent 7 days' factor.
  const recent = results.slice(-7);
  const currentWeekFactor =
    recent.reduce((s, r) => s + r.factorVolume, 0) / (recent.length || 1);

  const out = {
    generatedAt: new Date().toISOString(),
    config: {
      sampleDays: SAMPLE_DAYS,
      referenceWindowDays: REFERENCE_WINDOW_DAYS,
      minFactor: NEWS_SOV_MIN_FACTOR,
      maxFactor: NEWS_SOV_MAX_FACTOR,
      minCohort: NEWS_SOV_MIN_COHORT,
      balancedBand: [BALANCED_LOW, BALANCED_HIGH],
    },
    summary: {
      daysAnalyzed: results.length,
      rawBalancedDays,
      correctedBalancedDays: corrBalancedDays,
      rawBalancedPct: pct(rawBalancedDays / (results.length || 1)),
      correctedBalancedPct: pct(corrBalancedDays / (results.length || 1)),
      rawMeanAbsDevFrom50: pct(meanAbsDev("upPctRaw")),
      correctedMeanAbsDevFrom50: pct(meanAbsDev("upPctCorrected")),
      extremeTideDaysRaw: extremeRaw.length,
      extremeTideDaysPulledToCentre: extremeMovedToCentre.length,
      extremeTideDaysStillExtreme: extremeStillExtremeAfter,
      extremePulledToCentrePct: pct(
        extremeMovedToCentre.length / (extremeRaw.length || 1),
      ),
      currentWeekFactor: Math.round(currentWeekFactor * 1000) / 1000,
      currentWeekFactorNearOne: Math.abs(currentWeekFactor - 1) <= 0.15,
    },
    verdict: {
      // Success = the correction pulls the majority of extreme tide days toward
      // balance (the co-movement it targets), without needing every balanced
      // day to stay perfectly centred.
      correctionFlattensTides:
        extremeMovedToCentre.length > extremeRaw.length / 2,
      safeToEnableNow: Math.abs(currentWeekFactor - 1) <= 0.15,
    },
    days: results.map((r) => ({
      ...r,
      upPctRaw: pct(r.upPctRaw),
      upPctCorrected: pct(r.upPctCorrected),
    })),
  };

  const outPath = path.resolve(process.cwd(), "audit-news-sov-output.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.error(`\n[audit-news-sov] Wrote results to ${outPath}`);
  console.error(
    `[audit-news-sov] extreme tide days: ${out.summary.extremeTideDaysRaw} raw → ` +
      `${out.summary.extremeTideDaysPulledToCentre} pulled toward centre (${out.summary.extremePulledToCentrePct}); ` +
      `balanced days raw=${out.summary.rawBalancedPct} → corrected=${out.summary.correctedBalancedPct}; ` +
      `currentWeekFactor=${out.summary.currentWeekFactor} (flattensTides=${out.verdict.correctionFlattensTides}, safeToEnable=${out.verdict.safeToEnableNow})\n`,
  );
  console.log(JSON.stringify(out.summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[audit-news-sov] fatal:", err);
  process.exit(1);
});
