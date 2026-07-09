/**
 * Unit tests for per-provider ingest coverage drop alerts.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_HEALTHY_THRESHOLD,
  COVERAGE_LOW_THRESHOLD,
  buildIngestProviderOpsAlertPayload,
  evaluateProviderCoverageFromRunHistory,
  extractProviderCoverageFromHealthSummary,
  formatIngestAlertLogLine,
  resetIngestAlertDedupState,
  type ProviderCoverageSnapshot,
} from "../server/services/ingest-provider-alert";

function healthSummaryForProvider(
  provider: "currents" | "mediastack" | "serper" | "gdelt",
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

test("extractProviderCoverageFromHealthSummary includes currents", () => {
  const rows = extractProviderCoverageFromHealthSummary(
    healthSummaryForProvider("currents", 80, 161),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "currents");
  assert.ok(Math.abs(rows[0].coverageRatio - 80 / 161) < 0.001);
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

test("not-attempted provider (e.g. GDELT excluded from union) never alarms", () => {
  resetIngestAlertDedupState();
  const runs = [
    { startedAt: new Date("2026-05-24T04:00:00Z"), coverageRatio: 0.0 },
    { startedAt: new Date("2026-05-24T03:00:00Z"), coverageRatio: 0.0 },
    { startedAt: new Date("2026-05-24T02:00:00Z"), coverageRatio: 0.0 },
    { startedAt: new Date("2026-05-24T01:00:00Z"), coverageRatio: 0.72 },
  ];
  const current: ProviderCoverageSnapshot = {
    provider: "gdelt",
    peopleWithArticles: 0,
    peopleWithData: 0,
    coverageRatio: 0,
    attempted: false,
  };
  assert.equal(evaluateProviderCoverageFromRunHistory("gdelt", runs, current), null);
});

test("extractor defaults attempted=true and reads it when present", () => {
  const rowsDefault = extractProviderCoverageFromHealthSummary(
    healthSummaryForProvider("serper", 0, 161),
  );
  assert.equal(rowsDefault[0].attempted, true);

  const notAttempted = extractProviderCoverageFromHealthSummary({
    coverage: {
      newsAggregator: {
        providers: {
          gdelt: { peopleWithArticles: 0, peopleWithData: 0, succeeded: false, attempted: false },
        },
      },
    },
  });
  assert.equal(notAttempted[0].attempted, false);
});

test("confirmed outage re-alerts on a new UTC day but only once per day", () => {
  resetIngestAlertDedupState();
  const runs = [
    { startedAt: new Date("2026-06-17T04:00:00Z"), coverageRatio: 0.02 },
    { startedAt: new Date("2026-06-17T03:00:00Z"), coverageRatio: 0.02 },
    { startedAt: new Date("2026-06-17T02:00:00Z"), coverageRatio: 0.03 },
    { startedAt: new Date("2026-06-16T23:00:00Z"), coverageRatio: 0.72 },
  ];
  const current = { provider: "serper" as const, peopleWithArticles: 3, peopleWithData: 161, coverageRatio: 3 / 161 };

  // Day 1: onset → alert.
  assert.ok(evaluateProviderCoverageFromRunHistory("serper", runs, current, new Date("2026-06-17T10:00:00Z")));
  // Same day, later ingest: no re-alert.
  assert.equal(evaluateProviderCoverageFromRunHistory("serper", runs, current, new Date("2026-06-17T11:00:00Z")), null);
  // Next UTC day, still dark: re-alert (the silence-bug fix).
  assert.ok(evaluateProviderCoverageFromRunHistory("serper", runs, current, new Date("2026-06-18T10:00:00Z")));
  // Still day 2: no second alert.
  assert.equal(evaluateProviderCoverageFromRunHistory("serper", runs, current, new Date("2026-06-18T12:00:00Z")), null);
});

test("buildIngestProviderOpsAlertPayload shapes ops email fields", () => {
  resetIngestAlertDedupState();
  const serperAlert = evaluateProviderCoverageFromRunHistory(
    "serper",
    [
      { startedAt: new Date("2026-06-30T09:00:00Z"), coverageRatio: 0.05 },
      { startedAt: new Date("2026-06-30T08:00:00Z"), coverageRatio: 0.06 },
      { startedAt: new Date("2026-06-30T07:00:00Z"), coverageRatio: 0.08 },
      { startedAt: new Date("2026-06-30T06:00:00Z"), coverageRatio: 0.72 },
    ],
    { provider: "serper", peopleWithArticles: 8, peopleWithData: 161, coverageRatio: 8 / 161 },
  );
  assert.ok(serperAlert);
  const payload = buildIngestProviderOpsAlertPayload(serperAlert!, new Date("2026-06-30T10:00:00Z"));
  assert.equal(payload.kind, "ingest_provider_outage");
  assert.equal(payload.provider, "serper");
  assert.match(payload.title, /Serper/);
  assert.match(payload.summary, /8\/161/);
  assert.equal(payload.idempotencyKeyBase, "ingest_provider_outage:serper:2026-06-30");
  assert.match(payload.checkHint, /Serper/i);
});
