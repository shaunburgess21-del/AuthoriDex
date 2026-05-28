import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeKeyword,
  sanitizeKeyword,
  toApiKeyword,
  isInvalidKeywordTaskError,
  parseSearchVolumeResponse,
  computeMoMDeltaPct,
  buildSearchVolumeHistory,
  shouldFetchSearchVolume,
  SEARCH_VOLUME_FETCH_INTERVAL_MS,
} from "../server/providers/search-volume-window";
import { searchSurgeLevel } from "../server/services/insights/signal-utils";
import {
  normalizeSearchVolumeMass,
  getSearchVolumeMassWeight,
  SEARCH_VOLUME_MASS_WEIGHT_DEFAULT,
} from "../server/scoring/normalize";
import { computeTrendScore } from "../server/scoring/trendScore";

// ── normalizeKeyword ────────────────────────────────────────────────────────

test("normalizeKeyword: lowercases, trims, collapses whitespace", () => {
  assert.equal(normalizeKeyword("  Taylor   Swift "), "taylor swift");
  assert.equal(normalizeKeyword("Elon Musk"), "elon musk");
});

// ── sanitizeKeyword / toApiKeyword ──────────────────────────────────────────

test("sanitizeKeyword: strips parentheses (the 40501 batch-killer) but keeps inner text", () => {
  assert.equal(sanitizeKeyword("Lisa (Blackpink)"), "Lisa Blackpink");
});

test("sanitizeKeyword: keeps accents, apostrophes, periods, hyphens, ampersands", () => {
  assert.equal(sanitizeKeyword("Timothée Chalamet"), "Timothée Chalamet");
  assert.equal(sanitizeKeyword("Charli D'Amelio"), "Charli D'Amelio");
  assert.equal(sanitizeKeyword("Robert F. Kennedy Jr."), "Robert F. Kennedy Jr.");
  assert.equal(sanitizeKeyword("Alexandria Ocasio-Cortez"), "Alexandria Ocasio-Cortez");
});

test("sanitizeKeyword: removes brackets/symbols and collapses whitespace", () => {
  assert.equal(sanitizeKeyword("Foo [bar] {baz}!"), "Foo bar baz");
});

test("toApiKeyword: sanitises then lowercases/normalises", () => {
  assert.equal(toApiKeyword("Lisa (Blackpink)"), "lisa blackpink");
});

test("isInvalidKeywordTaskError: detects 40501", () => {
  assert.equal(isInvalidKeywordTaskError({ status_code: 40501 }), true);
  assert.equal(isInvalidKeywordTaskError({ status_code: 20000 }), false);
  assert.equal(isInvalidKeywordTaskError(null), false);
});

// ── parseSearchVolumeResponse ───────────────────────────────────────────────

const k2p = new Map<string, string>([
  ["taylor swift", "p1"],
  ["elon musk", "p2"],
  ["jane doe", "p3"],
]);

test("parseSearchVolumeResponse: maps keywords back to personId (case-insensitive)", () => {
  const json = {
    tasks: [
      {
        result: [
          { keyword: "Taylor Swift", search_volume: 2200000 },
          { keyword: "elon musk", search_volume: 1500000 },
          { keyword: "jane doe", search_volume: 90 },
        ],
      },
    ],
  };
  const out = parseSearchVolumeResponse(json, k2p);
  assert.equal(out.get("p1")?.volume, 2200000);
  assert.equal(out.get("p2")?.volume, 1500000);
  assert.equal(out.get("p3")?.volume, 90);
});

test("parseSearchVolumeResponse: extracts month-over-month delta from monthly_searches", () => {
  const json = {
    tasks: [
      {
        result: [
          {
            keyword: "elon musk",
            search_volume: 1500000,
            monthly_searches: [
              { year: 2026, month: 3, search_volume: 1000000 },
              { year: 2026, month: 4, search_volume: 823000 }, // latest (out of order on purpose)
              { year: 2026, month: 2, search_volume: 1000000 },
            ],
          },
        ],
      },
    ],
  };
  const out = parseSearchVolumeResponse(json, k2p);
  // latest = April 823k, prev = March 1M -> -17.7%
  assert.equal(out.get("p2")?.volume, 1500000);
  assert.ok(Math.abs((out.get("p2")?.momDeltaPct ?? 0) - -17.7) < 0.1);
});

test("parseSearchVolumeResponse: null/missing volume -> 0, unknown keyword ignored", () => {
  const json = {
    tasks: [
      {
        result: [
          { keyword: "taylor swift", search_volume: null },
          { keyword: "unknown person", search_volume: 500 },
          { keyword: "elon musk" },
        ],
      },
    ],
  };
  const out = parseSearchVolumeResponse(json, k2p);
  assert.equal(out.get("p1")?.volume, 0);
  assert.equal(out.get("p2")?.volume, 0);
  assert.equal(out.has("unknown"), false);
});

// ── computeMoMDeltaPct ──────────────────────────────────────────────────────

test("computeMoMDeltaPct: latest vs prior completed month", () => {
  const series = [
    { year: 2026, month: 2, search_volume: 100000 },
    { year: 2026, month: 4, search_volume: 120000 },
    { year: 2026, month: 3, search_volume: 100000 },
  ];
  // sorted desc -> Apr 120k vs Mar 100k = +20%
  assert.equal(computeMoMDeltaPct(series), 20);
});

test("computeMoMDeltaPct: insufficient/zero data -> 0", () => {
  assert.equal(computeMoMDeltaPct(null), 0);
  assert.equal(computeMoMDeltaPct([{ year: 2026, month: 4, search_volume: 100 }]), 0);
  assert.equal(computeMoMDeltaPct([
    { year: 2026, month: 4, search_volume: 100 },
    { year: 2026, month: 3, search_volume: 0 },
  ]), 0);
});

// ── buildSearchVolumeHistory ────────────────────────────────────────────────

test("buildSearchVolumeHistory: sorts ascending and formats YYYY-MM", () => {
  const series = [
    { year: 2026, month: 2, search_volume: 200000 },
    { year: 2026, month: 4, search_volume: 120000 },
    { year: 2025, month: 12, search_volume: 90000 },
  ];
  const hist = buildSearchVolumeHistory(series);
  assert.deepEqual(hist, [
    { ym: "2025-12", v: 90000 },
    { ym: "2026-02", v: 200000 },
    { ym: "2026-04", v: 120000 },
  ]);
});

test("buildSearchVolumeHistory: drops malformed entries, clamps negatives, null -> []", () => {
  assert.deepEqual(buildSearchVolumeHistory(null), []);
  const hist = buildSearchVolumeHistory([
    { year: 2026, month: 3, search_volume: 100 },
    { year: 2026, month: 4, search_volume: null },
    { year: 2026, search_volume: 50 } as any,
    { year: 2026, month: 5, search_volume: -10 },
  ]);
  assert.deepEqual(hist, [
    { ym: "2026-03", v: 100 },
    { ym: "2026-05", v: 0 },
  ]);
});

test("parseSearchVolumeResponse: includes history series", () => {
  const json = {
    tasks: [
      {
        result: [
          {
            keyword: "taylor swift",
            search_volume: 4090000,
            monthly_searches: [
              { year: 2026, month: 3, search_volume: 2240000 },
              { year: 2026, month: 4, search_volume: 2240000 },
            ],
          },
        ],
      },
    ],
  };
  const out = parseSearchVolumeResponse(json, k2p);
  assert.equal(out.get("p1")?.history.length, 2);
  assert.deepEqual(out.get("p1")?.history[0], { ym: "2026-03", v: 2240000 });
});

// ── searchSurgeLevel ────────────────────────────────────────────────────────

test("searchSurgeLevel: dead zone, tiers, and negatives", () => {
  assert.equal(searchSurgeLevel(0), "none");
  assert.equal(searchSurgeLevel(8), "none"); // boundary: not > 8
  assert.equal(searchSurgeLevel(-40), "none"); // declining is not a surge
  assert.equal(searchSurgeLevel(15), "low");
  assert.equal(searchSurgeLevel(20), "medium");
  assert.equal(searchSurgeLevel(49), "medium");
  assert.equal(searchSurgeLevel(50), "high");
  assert.equal(searchSurgeLevel(235), "high");
});

test("parseSearchVolumeResponse: tolerant of malformed payloads", () => {
  assert.equal(parseSearchVolumeResponse(null, k2p).size, 0);
  assert.equal(parseSearchVolumeResponse({}, k2p).size, 0);
  assert.equal(parseSearchVolumeResponse({ tasks: [{}] }, k2p).size, 0);
  assert.equal(parseSearchVolumeResponse({ tasks: [{ result: null }] }, k2p).size, 0);
});

// ── shouldFetchSearchVolume ─────────────────────────────────────────────────

test("shouldFetchSearchVolume: never fetched -> true", () => {
  assert.equal(shouldFetchSearchVolume(null), true);
});

test("shouldFetchSearchVolume: under 24h -> false, over -> true", () => {
  const now = Date.now();
  const recent = new Date(now - 12 * 60 * 60 * 1000);
  const stale = new Date(now - SEARCH_VOLUME_FETCH_INTERVAL_MS - 1000);
  assert.equal(shouldFetchSearchVolume(recent, now), false);
  assert.equal(shouldFetchSearchVolume(stale, now), true);
});

// ── normalizeSearchVolumeMass ───────────────────────────────────────────────

test("normalizeSearchVolumeMass: zero/negative/non-finite -> 0", () => {
  assert.equal(normalizeSearchVolumeMass(0), 0);
  assert.equal(normalizeSearchVolumeMass(-5), 0);
  assert.equal(normalizeSearchVolumeMass(NaN), 0);
});

test("normalizeSearchVolumeMass: below ~833/mo floor -> 0 (annualised < 10k)", () => {
  // 800/mo * 12 = 9,600 < 10,000 floor in normalizeMass
  assert.equal(normalizeSearchVolumeMass(800), 0);
});

test("normalizeSearchVolumeMass: monotonic increasing and bounded 0..100", () => {
  const low = normalizeSearchVolumeMass(50_000);
  const mid = normalizeSearchVolumeMass(500_000);
  const high = normalizeSearchVolumeMass(5_000_000);
  assert.ok(low > 0 && low < mid && mid < high);
  assert.ok(high <= 100);
});

// ── getSearchVolumeMassWeight ───────────────────────────────────────────────

test("getSearchVolumeMassWeight: default when env unset/invalid", () => {
  delete process.env.SEARCH_VOLUME_MASS_WEIGHT;
  assert.equal(getSearchVolumeMassWeight(), SEARCH_VOLUME_MASS_WEIGHT_DEFAULT);
  process.env.SEARCH_VOLUME_MASS_WEIGHT = "abc";
  assert.equal(getSearchVolumeMassWeight(), SEARCH_VOLUME_MASS_WEIGHT_DEFAULT);
  process.env.SEARCH_VOLUME_MASS_WEIGHT = "1.5"; // out of range
  assert.equal(getSearchVolumeMassWeight(), SEARCH_VOLUME_MASS_WEIGHT_DEFAULT);
  delete process.env.SEARCH_VOLUME_MASS_WEIGHT;
});

test("getSearchVolumeMassWeight: honours valid env override", () => {
  process.env.SEARCH_VOLUME_MASS_WEIGHT = "0";
  assert.equal(getSearchVolumeMassWeight(), 0);
  process.env.SEARCH_VOLUME_MASS_WEIGHT = "0.5";
  assert.equal(getSearchVolumeMassWeight(), 0.5);
  delete process.env.SEARCH_VOLUME_MASS_WEIGHT;
});

// ── mass blend in computeTrendScore ─────────────────────────────────────────

function baseInputs(over: Record<string, unknown> = {}) {
  return {
    wikiPageviews: 50_000,
    wikiPageviews7dAvg: 50_000,
    wikiDelta: 0,
    newsDelta: 0,
    searchDelta: 0,
    newsCount: 0,
    searchVolume: 0,
    activePlatforms: { wiki: true, instagram: false, youtube: false },
    ...over,
  } as Parameters<typeof computeTrendScore>[0];
}

test("computeTrendScore: no search volume -> attentionMass equals wiki mass (no penalty)", () => {
  const out = computeTrendScore(baseInputs({ searchVolumeMonthly: 0 }));
  assert.equal(out.searchVolumeMassScore, 0);
  assert.equal(out.attentionMassScore, out.massScore); // wiki-only person, no followers
});

test("computeTrendScore: high search volume lifts attention mass above wiki-only", () => {
  process.env.SEARCH_VOLUME_MASS_WEIGHT = "0.3";
  const withSearch = computeTrendScore(baseInputs({ searchVolumeMonthly: 5_000_000 }));
  const without = computeTrendScore(baseInputs({ searchVolumeMonthly: 0 }));
  assert.ok(withSearch.searchVolumeMassScore > 0);
  assert.ok(
    withSearch.attentionMassScore > without.attentionMassScore,
    "strong search volume should raise the blended attention mass",
  );
  delete process.env.SEARCH_VOLUME_MASS_WEIGHT;
});

test("computeTrendScore: weight 0 disables the blend entirely", () => {
  process.env.SEARCH_VOLUME_MASS_WEIGHT = "0";
  const out = computeTrendScore(baseInputs({ searchVolumeMonthly: 5_000_000 }));
  // searchVolumeMassScore is still reported, but the blend uses weight 0.
  assert.ok(out.searchVolumeMassScore > 0);
  assert.equal(out.attentionMassScore, computeTrendScore(baseInputs({ searchVolumeMonthly: 0 })).attentionMassScore);
  delete process.env.SEARCH_VOLUME_MASS_WEIGHT;
});
