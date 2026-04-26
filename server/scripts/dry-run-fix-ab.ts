// Dry-run scoring with the cumulative Apr 2026 trend-engine fixes applied:
//   Fix A — search weight zeroed (PR1, already on main)
//   Fix B — upper-tail spread in computePercentileRank (PR1, already on main)
//   Fix X — news-momentum velocity slot (PR2)
//   Fix Z — cross-snapshot EMA on final fameIndex (PR2; requires a previous
//           tick to take effect; this dry-run runs without one to isolate the
//           rank-change impact of A+B+X on a single tick — Z's contribution
//           is exclusively about damping ±150K oscillation across ticks,
//           which a single-snapshot diff can't surface)
//
// Reads the Phase 1 audit snapshot in audit-trend-engine-output.json (top 50
// with raw signals captured at 2026-04-26T20:00Z) and recomputes fameIndex
// using the current scoring engine. Diff against the persisted live
// fameIndex reveals leaderboard rank changes attributable to PR1+X.
//
// Fix C (deterministic moderate-drop news hold) is *not* applied here — it
// only kicks in during ingestion and changes how raw newsCount itself is
// produced for future snapshots, not how a captured snapshot is scored.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeTrendScore } from "../scoring/trendScore";
import { type SourceStats } from "../scoring/normalize";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

interface AuditPerson {
  rank: number;
  personId: string;
  name: string;
  category: string;
  fameIndex: number;
  raw: {
    wikiPageviews24h: number;
    wikiPageviews7dAvg: number;
    newsCount: number;
    /** Fix X (Apr 2026) — denominator for news-momentum slot. */
    newsAverageDaily7d?: number;
    searchVolume: number;
  };
}

interface AuditFile {
  generatedAt: string;
  percentiles: {
    wiki: SourceStats & { mean: number; count: number; p99Estimate: number; effectiveMax: number };
    news: SourceStats & { mean: number; count: number; p99Estimate: number; effectiveMax: number };
    search: SourceStats & { mean: number; count: number; p99Estimate: number; effectiveMax: number };
  };
  topPeople: AuditPerson[];
}

const auditPath = path.resolve(PROJECT_ROOT, "audit-trend-engine-output.json");
const audit: AuditFile = JSON.parse(fs.readFileSync(auditPath, "utf8"));

const sourceStats = {
  wiki: audit.percentiles.wiki,
  news: audit.percentiles.news,
  search: audit.percentiles.search,
};

interface DryRow {
  oldRank: number;
  newRank: number;
  rankDelta: number;
  name: string;
  category: string;
  oldFame: number;
  newFame: number;
  fameDelta: number;
  fameDeltaPct: number;
  wikiVel: number;
  newsVel: number;
  searchVel: number;
  momentumVel: number;
  newsCount24h: number;
  newsAvg7d: number;
  momentumRatio: number;
}

const computed = audit.topPeople.map((p) => {
  const newsAvg7d = p.raw.newsAverageDaily7d ?? 0;
  const result = computeTrendScore(
    {
      wikiPageviews: p.raw.wikiPageviews24h ?? 0,
      wikiPageviews7dAvg: p.raw.wikiPageviews7dAvg ?? 0,
      wikiDelta: 0,
      newsDelta: 0,
      searchDelta: 0,
      newsCount: p.raw.newsCount ?? 0,
      searchVolume: p.raw.searchVolume ?? 0,
      newsAverageDaily7d: newsAvg7d,
      activePlatforms: { wiki: true, instagram: false, youtube: false },
    },
    undefined,
    undefined,
    undefined,
    sourceStats,
  );
  const ratio = newsAvg7d > 0 ? (p.raw.newsCount ?? 0) / Math.max(newsAvg7d, 1) : 0;
  return { person: p, result, ratio };
});

computed.sort((a, b) => b.result.fameIndex - a.result.fameIndex);

const rows: DryRow[] = computed.map((entry, idx) => ({
  oldRank: entry.person.rank,
  newRank: idx + 1,
  rankDelta: entry.person.rank - (idx + 1),
  name: entry.person.name,
  category: entry.person.category,
  oldFame: entry.person.fameIndex,
  newFame: entry.result.fameIndex,
  fameDelta: entry.result.fameIndex - entry.person.fameIndex,
  fameDeltaPct:
    entry.person.fameIndex > 0
      ? Math.round(
          ((entry.result.fameIndex - entry.person.fameIndex) / entry.person.fameIndex) * 1000,
        ) / 10
      : 0,
  wikiVel: entry.result.velocityComponents.wiki,
  newsVel: entry.result.velocityComponents.news,
  searchVel: entry.result.velocityComponents.search,
  momentumVel: entry.result.velocityComponents.momentum,
  newsCount24h: entry.person.raw.newsCount ?? 0,
  newsAvg7d: entry.person.raw.newsAverageDaily7d ?? 0,
  momentumRatio: Math.round(entry.ratio * 100) / 100,
}));

const pad = (s: string | number, w: number, align: "L" | "R" = "L") => {
  const str = String(s);
  if (str.length >= w) return str.slice(0, w);
  return align === "L" ? str.padEnd(w) : str.padStart(w);
};

console.log(`Dry-run: Fix A + B + X applied to snapshot ${audit.generatedAt}`);
console.log(`Source stats: news.p99=${audit.percentiles.news.p99Estimate}, news.max=${audit.percentiles.news.max}`);
console.log("");
console.log(
  pad("OldRk", 6, "R") +
    pad("NewRk", 6, "R") +
    pad("Δ", 5, "R") +
    "  " +
    pad("Name", 24) +
    pad("Cat", 10) +
    pad("OldFame", 10, "R") +
    pad("NewFame", 10, "R") +
    pad("ΔFame", 10, "R") +
    pad("Δ%", 7, "R") +
    pad("wikV", 6, "R") +
    pad("newV", 6, "R") +
    pad("momV", 6, "R") +
    pad("ratio", 7, "R"),
);
console.log("─".repeat(118));
for (const r of rows.slice(0, 30)) {
  const arrow = r.rankDelta > 0 ? "↑" + r.rankDelta : r.rankDelta < 0 ? "↓" + -r.rankDelta : "—";
  console.log(
    pad(r.oldRank, 6, "R") +
      pad(r.newRank, 6, "R") +
      pad(arrow, 5, "R") +
      "  " +
      pad(r.name, 24) +
      pad(r.category, 10) +
      pad(r.oldFame.toLocaleString(), 10, "R") +
      pad(r.newFame.toLocaleString(), 10, "R") +
      pad((r.fameDelta >= 0 ? "+" : "") + r.fameDelta.toLocaleString(), 10, "R") +
      pad((r.fameDeltaPct >= 0 ? "+" : "") + r.fameDeltaPct.toFixed(1) + "%", 7, "R") +
      pad(r.wikiVel.toFixed(1), 6, "R") +
      pad(r.newsVel.toFixed(1), 6, "R") +
      pad(r.momentumVel.toFixed(1), 6, "R") +
      pad(r.momentumRatio.toFixed(2) + "×", 7, "R"),
  );
}

const moversUp = rows.filter((r) => r.rankDelta > 0).sort((a, b) => b.rankDelta - a.rankDelta);
const moversDown = rows.filter((r) => r.rankDelta < 0).sort((a, b) => a.rankDelta - b.rankDelta);

console.log("");
console.log(`Top 5 risers:`);
for (const r of moversUp.slice(0, 5)) {
  console.log(`  ${r.name.padEnd(24)} #${r.oldRank} → #${r.newRank} (↑${r.rankDelta})  ΔFame ${r.fameDeltaPct >= 0 ? "+" : ""}${r.fameDeltaPct.toFixed(1)}%`);
}
console.log(`Top 5 fallers:`);
for (const r of moversDown.slice(0, 5)) {
  console.log(`  ${r.name.padEnd(24)} #${r.oldRank} → #${r.newRank} (↓${-r.rankDelta})  ΔFame ${r.fameDeltaPct >= 0 ? "+" : ""}${r.fameDeltaPct.toFixed(1)}%`);
}

const out = path.resolve(PROJECT_ROOT, "dry-run-fix-ab-output.json");
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
console.log(`\nWrote ${out}`);
