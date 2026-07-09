import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBaselineCohortGuard,
  BASELINE_GUARD_MIN_RATIO,
  BASELINE_GUARD_MAX_RATIO,
  BASELINE_GUARD_DARK_SHARE,
  BASELINE_GUARD_MIN_COHORT,
} from "../server/native-markets/baseline-guard";

function cohort(
  count: number,
  opts: {
    ratio?: number;
    newsDark?: boolean;
    wikiDark?: boolean;
  } = {},
): { personId: string; ratio6hTo7d?: number; newsDark?: boolean; wikiDark?: boolean }[] {
  return Array.from({ length: count }, (_, i) => ({
    personId: `p${i}`,
    ...(opts.ratio != null ? { ratio6hTo7d: opts.ratio } : {}),
    ...(opts.newsDark != null ? { newsDark: opts.newsDark } : {}),
    ...(opts.wikiDark != null ? { wikiDark: opts.wikiDark } : {}),
  }));
}

test("evaluateBaselineCohortGuard passes when ratio within band", () => {
  const result = evaluateBaselineCohortGuard(cohort(25, { ratio: 0.98, newsDark: false, wikiDark: false }), {
    enabled: true,
    minCohort: 20,
  });
  assert.equal(result.triggered, false);
  assert.equal(result.reason, "pass");
  assert.ok(result.cohortMedianRatio != null && result.cohortMedianRatio > 0.9);
});

test("evaluateBaselineCohortGuard trips when ratio below min (outage week pattern)", () => {
  const result = evaluateBaselineCohortGuard(cohort(25, { ratio: 0.74, newsDark: false, wikiDark: false }), {
    enabled: true,
    minRatio: 0.85,
    minCohort: 20,
  });
  assert.equal(result.triggered, true);
  assert.equal(result.reason, "ratio_below_min");
});

test("evaluateBaselineCohortGuard trips when ratio above max", () => {
  const result = evaluateBaselineCohortGuard(cohort(25, { ratio: 1.25, newsDark: false, wikiDark: false }), {
    enabled: true,
    maxRatio: 1.15,
    minCohort: 20,
  });
  assert.equal(result.triggered, true);
  assert.equal(result.reason, "ratio_above_max");
});

test("evaluateBaselineCohortGuard trips on news dark share with normal ratio", () => {
  const people = cohort(25, { ratio: 0.98 });
  for (let i = 0; i < 14; i++) {
    people[i]!.newsDark = true;
    people[i]!.wikiDark = false;
  }
  for (let i = 14; i < 25; i++) {
    people[i]!.newsDark = false;
    people[i]!.wikiDark = false;
  }
  const result = evaluateBaselineCohortGuard(people, {
    enabled: true,
    darkShare: 0.5,
    minCohort: 20,
  });
  assert.equal(result.triggered, true);
  assert.equal(result.reason, "news_dark_share");
  assert.ok(result.newsDarkShare != null && result.newsDarkShare > 0.5);
});

test("evaluateBaselineCohortGuard trips on wiki dark share", () => {
  const result = evaluateBaselineCohortGuard(
    cohort(25, { ratio: 0.98, newsDark: false, wikiDark: true }),
    { enabled: true, darkShare: 0.5, minCohort: 20 },
  );
  assert.equal(result.triggered, true);
  assert.equal(result.reason, "wiki_dark_share");
});

test("evaluateBaselineCohortGuard skips when cohort too small", () => {
  const result = evaluateBaselineCohortGuard(cohort(5, { ratio: 0.5 }), {
    enabled: true,
    minCohort: 20,
  });
  assert.equal(result.triggered, false);
  assert.equal(result.reason, "cohort_too_small");
});

test("evaluateBaselineCohortGuard disabled returns not triggered", () => {
  const result = evaluateBaselineCohortGuard(cohort(25, { ratio: 0.5 }), {
    enabled: false,
    minCohort: 20,
  });
  assert.equal(result.triggered, false);
  assert.equal(result.reason, "disabled");
});

test("default thresholds match calibrated production band", () => {
  assert.equal(BASELINE_GUARD_MIN_RATIO, 0.85);
  assert.equal(BASELINE_GUARD_MAX_RATIO, 1.15);
  assert.equal(BASELINE_GUARD_DARK_SHARE, 0.5);
  assert.equal(BASELINE_GUARD_MIN_COHORT, 20);
});
