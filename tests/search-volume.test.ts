import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeKeyword,
  sanitizeKeyword,
  toApiKeyword,
  isInvalidKeywordTaskError,
  parseSearchVolumeResponse,
  shouldFetchSearchVolume,
  SEARCH_VOLUME_FETCH_INTERVAL_MS,
} from "../server/providers/search-volume-window";
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
  assert.equal(out.get("p1"), 2200000);
  assert.equal(out.get("p2"), 1500000);
  assert.equal(out.get("p3"), 90);
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
  assert.equal(out.get("p1"), 0);
  assert.equal(out.get("p2"), 0);
  assert.equal(out.has("unknown"), false);
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
