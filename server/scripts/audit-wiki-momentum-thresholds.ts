// Diagnostic / calibration script for the (forthcoming) Wiki Momentum signal.
//
// The existing News Momentum signal flags Low/Medium/High using:
//   ratio = count24h / avg7d  →  Low <1.0, Medium 1.0–2.0, High ≥2.0
//
// Before reusing those thresholds for Wikipedia pageviews, we want to look at
// the actual ratio distribution across all tracked people and confirm whether
// (a) a single ratio threshold makes sense, (b) absolute volume needs to gate
// it, or (c) per-tier thresholds are required.
//
// Read-only. Hits the Wikipedia REST API directly for 37 days of daily
// per-article pageviews per person (30 sample days + 7-day warm-up window so
// every sampled day has a full trailing-7d denominator). Joins lightly to
// `trend_snapshots` to grab per-day news context where available.
//
// Usage: npm run -s audit:wiki-momentum-thresholds

import { db } from "../db";
import { sql } from "drizzle-orm";
import { trackedPeople } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";

const SAMPLE_DAYS = 30;
const TRAILING_WINDOW = 7;
const FETCH_DAYS = SAMPLE_DAYS + TRAILING_WINDOW; // 37
const REQUEST_DELAY_MS = 120;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [400, 1200];
const USER_AGENT = "VoxDex/1.0 audit-wiki-momentum (https://voxdex.com; contact@voxdex.com)";
const WIKI_API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";

// News-momentum reference thresholds (the ones we're testing against).
const REF_LOW = 1.0;
const REF_HIGH = 2.0;

// ---------------------------------------------------------------------------
// Fetch helpers (light copy of providers/wiki.ts — no redirect resolution to
// keep the audit fast; small under-count for redirected slugs is acceptable
// for a distribution study).
// ---------------------------------------------------------------------------

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (retryable && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 1500));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt >= MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 1500));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error("fetch failed");
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface DailyPoint {
  day: string; // YYYY-MM-DD
  views: number;
}

async function fetchDailyPageviews(slug: string, days: number): Promise<DailyPoint[] | null> {
  // Wikipedia API: latest available data is yesterday (UTC).
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const url = `${WIKI_API_BASE}/en.wikipedia/all-access/all-agents/${encodeURIComponent(slug)}/daily/${ymd(start)}/${ymd(end)}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Wikipedia API ${res.status} for ${slug}`);
  }
  const data: any = await res.json();
  const items: Array<{ timestamp: string; views: number }> = data.items ?? [];
  return items.map(it => ({
    // timestamp like "2026040800"
    day: `${it.timestamp.slice(0, 4)}-${it.timestamp.slice(4, 6)}-${it.timestamp.slice(6, 8)}`,
    views: Number(it.views) || 0,
  }));
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function describePercentiles(values: number[]) {
  if (values.length === 0) {
    return { count: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, mean: 0, max: 0, min: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    p90: round(percentile(sorted, 0.9)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    mean: round(sum / sorted.length),
    max: round(sorted[sorted.length - 1]),
    min: round(sorted[0]),
  };
}

function round(n: number, dp = 3): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface PersonDay {
  personId: string;
  name: string;
  category: string | null;
  day: string;            // YYYY-MM-DD
  pageviews24h: number;
  avg7d: number;          // trailing 7d, excluding day
  ratio: number;          // pageviews24h / max(avg7d, 1)
  absoluteVolume: number; // == pageviews24h, kept for clarity in output
}

async function main() {
  const startedAt = new Date();
  const out: any = { generatedAt: startedAt.toISOString(), config: { SAMPLE_DAYS, TRAILING_WINDOW, FETCH_DAYS } };

  // ---- 1. Resolve people to sample ----
  const people = await db
    .select({
      id: trackedPeople.id,
      name: trackedPeople.name,
      category: trackedPeople.category,
      wikiSlug: trackedPeople.wikiSlug,
      status: trackedPeople.status,
    })
    .from(trackedPeople)
    .where(sql`${trackedPeople.wikiSlug} IS NOT NULL AND ${trackedPeople.wikiSlug} <> ''`);

  const trackedWithSlug = people.filter(p => p.status === "main_leaderboard");
  console.error(`[audit-wiki] tracked people on main_leaderboard with wikiSlug: ${trackedWithSlug.length}`);
  out.peopleSampled = trackedWithSlug.length;

  // ---- 2. Fetch Wikipedia daily pageviews per person ----
  const perPersonDaily = new Map<string, DailyPoint[]>(); // personId -> daily series
  const fetchFailures: Array<{ personId: string; name: string; slug: string; reason: string }> = [];
  let i = 0;
  for (const p of trackedWithSlug) {
    i++;
    try {
      const series = await fetchDailyPageviews(p.wikiSlug!, FETCH_DAYS);
      if (!series || series.length === 0) {
        fetchFailures.push({ personId: p.id, name: p.name, slug: p.wikiSlug!, reason: "404 or empty" });
      } else {
        perPersonDaily.set(p.id, series);
      }
    } catch (err: any) {
      fetchFailures.push({ personId: p.id, name: p.name, slug: p.wikiSlug!, reason: err?.message ?? String(err) });
    }
    if (i % 25 === 0) {
      console.error(`[audit-wiki] fetched ${i}/${trackedWithSlug.length}`);
    }
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }
  out.fetchSummary = {
    fetched: perPersonDaily.size,
    failures: fetchFailures.length,
    failureSamples: fetchFailures.slice(0, 10),
  };
  console.error(`[audit-wiki] fetched=${perPersonDaily.size} failures=${fetchFailures.length}`);

  // ---- 3. Build (person, day) sample with avg7d trailing ----
  // Wikipedia returns daily series in chronological order; verify just in case.
  const personById = new Map(trackedWithSlug.map(p => [p.id, p]));
  const sample: PersonDay[] = [];
  const personMedians = new Map<string, number>(); // personId -> 30d median pageviews24h

  for (const [personId, series] of perPersonDaily.entries()) {
    const sorted = [...series].sort((a, b) => a.day.localeCompare(b.day));
    if (sorted.length < TRAILING_WINDOW + 1) continue;

    // Use only the last SAMPLE_DAYS days as sampled days; days before that
    // are warm-up for the trailing window.
    const startSampleIdx = Math.max(TRAILING_WINDOW, sorted.length - SAMPLE_DAYS);
    const personSampledViews: number[] = [];
    const person = personById.get(personId)!;

    for (let dIdx = startSampleIdx; dIdx < sorted.length; dIdx++) {
      const today = sorted[dIdx];
      const trailing = sorted.slice(dIdx - TRAILING_WINDOW, dIdx);
      if (trailing.length < TRAILING_WINDOW) continue;
      const avg7d = trailing.reduce((s, x) => s + x.views, 0) / trailing.length;
      const ratio = today.views / Math.max(avg7d, 1);
      sample.push({
        personId,
        name: person.name,
        category: person.category,
        day: today.day,
        pageviews24h: today.views,
        avg7d: round(avg7d, 2),
        ratio: round(ratio, 4),
        absoluteVolume: today.views,
      });
      personSampledViews.push(today.views);
    }
    personMedians.set(personId, median(personSampledViews));
  }
  out.sample = { rows: sample.length, peopleWithUsableSeries: personMedians.size };
  console.error(`[audit-wiki] sample rows=${sample.length} usable people=${personMedians.size}`);

  // ---- 4. Overall ratio distribution ----
  out.ratioPercentiles_overall = describePercentiles(sample.map(s => s.ratio));
  out.absoluteVolumePercentiles_overall = describePercentiles(sample.map(s => s.pageviews24h));

  // Threshold hit-rate at the News Momentum cutoffs, applied to Wiki.
  const overallHits = {
    medium_ratio_gte_1: sample.filter(s => s.ratio >= REF_LOW).length,
    high_ratio_gte_2: sample.filter(s => s.ratio >= REF_HIGH).length,
    total: sample.length,
  };
  out.refThresholdHitRate_overall = {
    ...overallHits,
    pct_ratio_gte_1: round(overallHits.medium_ratio_gte_1 / Math.max(overallHits.total, 1) * 100, 2),
    pct_ratio_gte_2: round(overallHits.high_ratio_gte_2 / Math.max(overallHits.total, 1) * 100, 2),
  };

  // ---- 5. Tier by 30-day median pageviews ----
  const personIds = Array.from(personMedians.keys());
  const sortedByMedian = personIds
    .map(pid => ({ pid, median: personMedians.get(pid)! }))
    .sort((a, b) => b.median - a.median);
  const n = sortedByMedian.length;
  const topCutoff = Math.floor(n * 0.25);
  const longTailCutoff = Math.floor(n * 0.75);
  const tierByPerson = new Map<string, "top" | "mid" | "longTail">();
  sortedByMedian.forEach((row, idx) => {
    if (idx < topCutoff) tierByPerson.set(row.pid, "top");
    else if (idx < longTailCutoff) tierByPerson.set(row.pid, "mid");
    else tierByPerson.set(row.pid, "longTail");
  });

  const tierSamples: Record<string, PersonDay[]> = { top: [], mid: [], longTail: [] };
  for (const s of sample) {
    const t = tierByPerson.get(s.personId);
    if (t) tierSamples[t].push(s);
  }
  out.tiers = {
    top: {
      peopleCount: sortedByMedian.slice(0, topCutoff).length,
      medianPageviewsRange: {
        max: round(sortedByMedian[0]?.median ?? 0),
        min: round(sortedByMedian[Math.max(0, topCutoff - 1)]?.median ?? 0),
      },
      ratioPercentiles: describePercentiles(tierSamples.top.map(s => s.ratio)),
      pageviewPercentiles: describePercentiles(tierSamples.top.map(s => s.pageviews24h)),
      pct_ratio_gte_1: round(tierSamples.top.filter(s => s.ratio >= REF_LOW).length / Math.max(tierSamples.top.length, 1) * 100, 2),
      pct_ratio_gte_2: round(tierSamples.top.filter(s => s.ratio >= REF_HIGH).length / Math.max(tierSamples.top.length, 1) * 100, 2),
      examplePeople: sortedByMedian.slice(0, Math.min(10, topCutoff)).map(r => ({
        name: personById.get(r.pid)?.name,
        median30d: round(r.median),
      })),
    },
    mid: {
      peopleCount: sortedByMedian.slice(topCutoff, longTailCutoff).length,
      medianPageviewsRange: {
        max: round(sortedByMedian[topCutoff]?.median ?? 0),
        min: round(sortedByMedian[Math.max(topCutoff, longTailCutoff - 1)]?.median ?? 0),
      },
      ratioPercentiles: describePercentiles(tierSamples.mid.map(s => s.ratio)),
      pageviewPercentiles: describePercentiles(tierSamples.mid.map(s => s.pageviews24h)),
      pct_ratio_gte_1: round(tierSamples.mid.filter(s => s.ratio >= REF_LOW).length / Math.max(tierSamples.mid.length, 1) * 100, 2),
      pct_ratio_gte_2: round(tierSamples.mid.filter(s => s.ratio >= REF_HIGH).length / Math.max(tierSamples.mid.length, 1) * 100, 2),
    },
    longTail: {
      peopleCount: sortedByMedian.slice(longTailCutoff).length,
      medianPageviewsRange: {
        max: round(sortedByMedian[longTailCutoff]?.median ?? 0),
        min: round(sortedByMedian[n - 1]?.median ?? 0),
      },
      ratioPercentiles: describePercentiles(tierSamples.longTail.map(s => s.ratio)),
      pageviewPercentiles: describePercentiles(tierSamples.longTail.map(s => s.pageviews24h)),
      pct_ratio_gte_1: round(tierSamples.longTail.filter(s => s.ratio >= REF_LOW).length / Math.max(tierSamples.longTail.length, 1) * 100, 2),
      pct_ratio_gte_2: round(tierSamples.longTail.filter(s => s.ratio >= REF_HIGH).length / Math.max(tierSamples.longTail.length, 1) * 100, 2),
      examplePeople: sortedByMedian.slice(longTailCutoff, longTailCutoff + Math.min(10, n - longTailCutoff)).map(r => ({
        name: personById.get(r.pid)?.name,
        median30d: round(r.median),
      })),
    },
  };

  // ---- 6. News context per (person, day) for top-of-list rows ----
  // Pull max news_count per (person, day) over the sampled window.
  const oldestSampleDay = sample.reduce<string | null>((acc, s) => (acc && acc < s.day ? acc : s.day), null);
  const newsCtxByKey = new Map<string, number>();
  if (oldestSampleDay) {
    const newsRows = await db.execute(sql`
      SELECT
        person_id,
        to_char(date_trunc('day', timestamp AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        MAX(news_count)::float AS max_news
      FROM trend_snapshots
      WHERE timestamp >= ${oldestSampleDay}::date
        AND snapshot_origin = 'ingest'
      GROUP BY person_id, day
    `);
    for (const row of newsRows.rows as Array<{ person_id: string; day: string; max_news: number }>) {
      newsCtxByKey.set(`${row.person_id}|${row.day}`, Number(row.max_news) || 0);
    }
  }
  function newsCtx(personId: string, day: string): number | null {
    const v = newsCtxByKey.get(`${personId}|${day}`);
    return v === undefined ? null : v;
  }

  // ---- 7. Top-20 highest-ratio person-days ----
  const top20Ratio = [...sample].sort((a, b) => b.ratio - a.ratio).slice(0, 20).map(s => ({
    name: s.name,
    category: s.category,
    day: s.day,
    pageviews24h: s.pageviews24h,
    avg7d: s.avg7d,
    ratio: s.ratio,
    tier: tierByPerson.get(s.personId) ?? "unknown",
    newsCountSameDay: newsCtx(s.personId, s.day),
  }));
  out.top20HighestRatio = top20Ratio;

  // ---- 8. Top-20 by absolute pageview count + High-threshold check ----
  const top20Volume = [...sample].sort((a, b) => b.pageviews24h - a.pageviews24h).slice(0, 20).map(s => ({
    name: s.name,
    category: s.category,
    day: s.day,
    pageviews24h: s.pageviews24h,
    avg7d: s.avg7d,
    ratio: s.ratio,
    meetsHighThreshold: s.ratio >= REF_HIGH,
    tier: tierByPerson.get(s.personId) ?? "unknown",
    newsCountSameDay: newsCtx(s.personId, s.day),
  }));
  out.top20HighestAbsolute = top20Volume;

  // ---- 9. Recommendation heuristics ----
  // Pick a "High" cutoff that fires on roughly 5% of person-days, the natural
  // top-tail rate. Also report how the same cutoff plays out per-tier so we
  // can see whether a single threshold is fair.
  const overallSortedRatios = sample.map(s => s.ratio).sort((a, b) => a - b);
  const targetHighRate = 0.05;
  const targetMedRate = 0.20;
  const cutoffHigh = round(percentile(overallSortedRatios, 1 - targetHighRate), 2);
  const cutoffMed = round(percentile(overallSortedRatios, 1 - targetMedRate), 2);

  // Per-tier 5%/20% cutoffs.
  function tierCutoffs(rows: PersonDay[]) {
    const sorted = rows.map(r => r.ratio).sort((a, b) => a - b);
    return {
      high_top5pct: round(percentile(sorted, 0.95), 2),
      med_top20pct: round(percentile(sorted, 0.8), 2),
    };
  }

  // Absolute-volume floor candidate: median of top tier's pageviews — i.e.
  // "this person saw real Wiki traffic today" gate. Useful for the hybrid
  // rule.
  const topTierVolumes = tierSamples.top.map(s => s.pageviews24h).sort((a, b) => a - b);
  const absoluteFloor_topTierP50 = round(percentile(topTierVolumes, 0.5));
  const absoluteFloor_overallP75 = round(percentile([...sample].map(s => s.pageviews24h).sort((a, b) => a - b), 0.75));

  const sameRefCutoffWorks =
    out.tiers.top.pct_ratio_gte_2 >= 1 &&
    out.tiers.top.pct_ratio_gte_2 <= 10 &&
    out.tiers.longTail.pct_ratio_gte_2 >= 1 &&
    out.tiers.longTail.pct_ratio_gte_2 <= 10 &&
    out.tiers.mid.pct_ratio_gte_2 >= 1 &&
    out.tiers.mid.pct_ratio_gte_2 <= 10;

  out.recommendation = {
    refThresholds: { low: REF_LOW, high: REF_HIGH },
    note: "News Momentum thresholds applied to Wiki — hit-rate breakdown above. ~3–8% High firing rate is the rule-of-thumb sweet spot.",
    overall_dataDriven: {
      med_ratio_top20pct: cutoffMed,
      high_ratio_top5pct: cutoffHigh,
    },
    perTier_dataDriven: {
      top: tierCutoffs(tierSamples.top),
      mid: tierCutoffs(tierSamples.mid),
      longTail: tierCutoffs(tierSamples.longTail),
    },
    hybridRule_candidate: {
      // Fires "High" only if both the relative spike AND a meaningful absolute
      // volume threshold are met. Mirrors the News-side hybrid sketch.
      ratioHigh: REF_HIGH,
      ratioMed: REF_LOW,
      absoluteVolumeFloor_topTierP50: absoluteFloor_topTierP50,
      absoluteVolumeFloor_overallP75: absoluteFloor_overallP75,
      formula: "High := ratio >= 2.0 AND pageviews24h >= floor; Medium := ratio >= 1.0 AND pageviews24h >= floor",
    },
    verdict_singleThresholdFairAcrossTiers: sameRefCutoffWorks,
  };

  // ---- 10. Persist + print ----
  const outPath = path.resolve(process.cwd(), "audit-wiki-momentum-thresholds-output.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.error(`\n[audit-wiki-momentum-thresholds] Wrote results to ${outPath}\n`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[audit-wiki-momentum-thresholds] fatal:", err);
  process.exit(1);
});
