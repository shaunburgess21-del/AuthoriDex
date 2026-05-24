/**
 * Unit tests for per-provider ingest coverage drop alerts.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_HEALTHY_THRESHOLD,
  COVERAGE_LOW_THRESHOLD,
  evaluateProviderCoverageFromRunHistory,
  extractProviderCoverageFromHealthSummary,
  formatIngestAlertLogLine,
  resetIngestAlertDedupState,
  type ProviderCoverageSnapshot,
} from "../server/services/ingest-provider-alert";

function healthSummaryForProvider(
  provider: "mediastack" | "serper" | "gdelt",
  peopleWithArticles: number,
  peopleWithData: number,
): Record<string, unknown> {
  return {
    coverage: {
      newsAggregator: {
        providers: {
          [provider]: { peopleWithArticles, peopleWithData, succeeded: true, elapsedMs: 1 },
        },
      },
    },
  };
}

function snap(
  provider: "mediastack",
  articles: number,
  data: number,
): ProviderCoverageSnapshot {
  return {
    provider,
    peopleWithArticles: articles,
    peopleWithData: data,
    coverageRatio: data > 0 ? articles / data : 0,
  };
}

test("extractProviderCoverageFromHealthSummary computes ratio", () => {
  const rows = extractProviderCoverageFromHealthSummary(
    healthSummaryForProvider("mediastack", 10, 161),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "mediastack");
  assert.ok(Math.abs(rows[0].coverageRatio - 10 / 161) < 0.001);
});

test("alerts when last 3 runs are below low threshold and 24h had healthy coverage", () => {
  resetIngestAlertDedupState();
  const t0 = new Date("2026-05-24T04:00:00Z");
  const t1 = new Date("2026-05-24T03:00:00Z");
  const t2 = new Date("2026-05-24T02:00:00Z");
  const tHealthy = new Date("2026-05-24T01:00:00Z");

  const runs = [
    { startedAt: t0, coverageRatio: 0.06 },
    { startedAt: t1, coverageRatio: 0.08 },
    { startedAt: t2, coverageRatio: 0.10 },
    { startedAt: tHealthy, coverageRatio: 0.72 },
  ];
  const current = snap("mediastack", 10, 161);

  const alert = evaluateProviderCoverageFromRunHistory("mediastack", runs, current);
  assert.ok(alert);
  assert.equal(alert.provider, "mediastack");
  assert.equal(alert.lastHealthyRunAt, tHealthy.toISOString());
  assert.match(formatIngestAlertLogLine(alert), /^\[IngestAlert\] provider=mediastack/);
});

test("no alert when fewer than 3 consecutive low runs", () => {
  resetIngestAlertDedupState();
  const runs = [
    { startedAt: new Date("2026-05-24T04:00:00Z"), coverageRatio: 0.06 },
    { startedAt: new Date("2026-05-24T03:00:00Z"), coverageRatio: 0.08 },
    { startedAt: new Date("2026-05-24T02:00:00Z"), coverageRatio: 0.55 },
  ];
  const current = snap("mediastack", 10, 161);
  assert.equal(evaluateProviderCoverageFromRunHistory("mediastack", runs, current), null);
});

test("no alert when provider never reached healthy threshold in 24h window", () => {
  resetIngestAlertDedupState();
  const runs = [
    { startedAt: new Date("2026-05-24T04:00:00Z"), coverageRatio: 0.06 },
    { startedAt: new Date("2026-05-24T03:00:00Z"), coverageRatio: 0.08 },
    { startedAt: new Date("2026-05-24T02:00:00Z"), coverageRatio: 0.10 },
    { startedAt: new Date("2026-05-24T01:00:00Z"), coverageRatio: 0.20 },
  ];
  const current = snap("mediastack", 10, 161);
  assert.equal(evaluateProviderCoverageFromRunHistory("mediastack", runs, current), null);
});

test("de-dup: second evaluation does not fire while outage persists", () => {
  resetIngestAlertDedupState();
  const runs = [
    { startedAt: new Date("2026-05-24T04:00:00Z"), coverageRatio: 0.06 },
    { startedAt: new Date("2026-05-24T03:00:00Z"), coverageRatio: 0.08 },
    { startedAt: new Date("2026-05-24T02:00:00Z"), coverageRatio: 0.10 },
    { startedAt: new Date("2026-05-24T01:00:00Z"), coverageRatio: 0.72 },
  ];
  const current = snap("mediastack", 10, 161);
  assert.ok(evaluateProviderCoverageFromRunHistory("mediastack", runs, current));
  assert.equal(evaluateProviderCoverageFromRunHistory("mediastack", runs, current), null);
});

test("de-dup clears when coverage recovers to healthy threshold", () => {
  resetIngestAlertDedupState();
  const lowRuns = [
    { startedAt: new Date("2026-05-24T04:00:00Z"), coverageRatio: 0.06 },
    { startedAt: new Date("2026-05-24T03:00:00Z"), coverageRatio: 0.08 },
    { startedAt: new Date("2026-05-24T02:00:00Z"), coverageRatio: 0.10 },
    { startedAt: new Date("2026-05-24T01:00:00Z"), coverageRatio: 0.72 },
  ];
  const currentLow = snap("mediastack", 10, 161);
  assert.ok(evaluateProviderCoverageFromRunHistory("mediastack", lowRuns, currentLow));

  const recovered = snap("mediastack", 90, 161);
  assert.equal(
    evaluateProviderCoverageFromRunHistory("mediastack", lowRuns, recovered),
    null,
  );
  assert.ok(recovered.coverageRatio >= COVERAGE_HEALTHY_THRESHOLD);

  assert.ok(
    evaluateProviderCoverageFromRunHistory("mediastack", lowRuns, currentLow),
    "can alert again after recovery then re-outage",
  );
});

test("threshold constants match plan", () => {
  assert.equal(COVERAGE_LOW_THRESHOLD, 0.25);
  assert.equal(COVERAGE_HEALTHY_THRESHOLD, 0.5);
});
