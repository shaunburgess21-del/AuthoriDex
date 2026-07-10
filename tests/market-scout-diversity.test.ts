import test from "node:test";
import assert from "node:assert/strict";
import type { ScoutCandidate, ScoutSelection } from "../server/jobs/market-scout";

// Dummy DATABASE_URL before importing anything that could transitively load
// server/db.ts. Same pattern as the other tests.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { buildTrendingEventsPath } = await import("../server/providers/polymarket");
const {
  buildDiversifiedShortlist,
  isInvasiveGossipCandidate,
  applySelectionDiversityGuards,
} = await import("../server/jobs/market-scout");
const { normalizeMarketCategory } = await import("../shared/constants");

function makeCandidate(
  overrides: Partial<ScoutCandidate> & Pick<ScoutCandidate, "eventId" | "sourceBucket">,
): ScoutCandidate {
  return {
    eventId: overrides.eventId,
    eventSlug: overrides.eventSlug ?? `slug-${overrides.eventId}`,
    title: overrides.title ?? `Market ${overrides.eventId}?`,
    description: overrides.description ?? null,
    url: overrides.url ?? `https://polymarket.com/event/${overrides.eventId}`,
    image: null,
    endDate: overrides.endDate ?? "2026-12-31T00:00:00Z",
    gameStartTime: null,
    volume24hr: overrides.volume24hr ?? 1000,
    tags: overrides.tags ?? [],
    structure: overrides.structure ?? "binary",
    outcomes: overrides.outcomes ?? [
      { label: "Yes", price: 0.5, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
      { label: "No", price: 0.5, sourceMarketId: "m1", sourceOutcomeIndex: 1 },
    ],
    sourceBucket: overrides.sourceBucket,
  };
}

function makeSelection(
  overrides: Partial<ScoutSelection> & Pick<ScoutSelection, "eventId" | "category">,
): ScoutSelection {
  return {
    eventId: overrides.eventId,
    title: overrides.title ?? `Will ${overrides.eventId} happen?`,
    slug: overrides.slug ?? `will-${overrides.eventId}-happen`,
    teaser: overrides.teaser ?? "Teaser",
    summary: overrides.summary ?? "Summary",
    category: overrides.category,
    secondaryCategories: overrides.secondaryCategories ?? [],
    resolutionCriteria: overrides.resolutionCriteria ?? ["Official announcement"],
    scoutWatch: overrides.scoutWatch ?? "Watch the news",
    linkedPerson: overrides.linkedPerson ?? null,
    relatedPeople: overrides.relatedPeople ?? [],
    fitScore: overrides.fitScore ?? 70,
    entryLabels: overrides.entryLabels ?? ["Yes", "No"],
  };
}

// ---------------------------------------------------------------------------
// Provider: tagged Gamma path
// ---------------------------------------------------------------------------

test("buildTrendingEventsPath omits tag_id for global feed", () => {
  assert.equal(
    buildTrendingEventsPath({ limit: 80 }),
    "/events?active=true&closed=false&order=volume24hr&ascending=false&limit=80",
  );
});

test("buildTrendingEventsPath appends tag_id for stratified feeds", () => {
  assert.equal(
    buildTrendingEventsPath({ limit: 40, tagId: "53" }),
    "/events?active=true&closed=false&order=volume24hr&ascending=false&limit=40&tag_id=53",
  );
});

test("buildTrendingEventsPath clamps limit and ignores blank tagId", () => {
  assert.match(buildTrendingEventsPath({ limit: 9999 }), /limit=500$/);
  assert.equal(
    buildTrendingEventsPath({ limit: 10, tagId: "  " }),
    "/events?active=true&closed=false&order=volume24hr&ascending=false&limit=10",
  );
});

// ---------------------------------------------------------------------------
// Category alias
// ---------------------------------------------------------------------------

test("normalizeMarketCategory maps entertainment to film-tv", () => {
  assert.equal(normalizeMarketCategory("entertainment"), "film-tv");
  assert.equal(normalizeMarketCategory("Entertainment"), "film-tv");
});

// ---------------------------------------------------------------------------
// Gossip safety filter
// ---------------------------------------------------------------------------

test("isInvasiveGossipCandidate rejects pregnancy / death / relationship gossip", () => {
  assert.equal(isInvasiveGossipCandidate({ title: "Rihanna confirmed pregnant in 2026?" }), true);
  assert.equal(isInvasiveGossipCandidate({ title: "Who will die in Spider-Man: Brand New Day?" }), true);
  assert.equal(
    isInvasiveGossipCandidate({ title: "Katy Perry and Justin Trudeau engaged by end of 2026?" }),
    true,
  );
  assert.equal(
    isInvasiveGossipCandidate({ title: "Will Kanye West and Bianca Censori separate in 2026?" }),
    true,
  );
});

test("isInvasiveGossipCandidate allows awards, box office, charts", () => {
  assert.equal(
    isInvasiveGossipCandidate({ title: '"The Odyssey" Opening Weekend Box Office' }),
    false,
  );
  assert.equal(
    isInvasiveGossipCandidate({ title: "Emmys 2026: Outstanding lead actress in a drama series" }),
    false,
  );
  assert.equal(isInvasiveGossipCandidate({ title: "Billboard 200 #1 Album Week of July 18" }), false);
  assert.equal(isInvasiveGossipCandidate({ title: "Will China invade Taiwan by the end of 2026?" }), false);
});

// ---------------------------------------------------------------------------
// Diversified shortlist
// ---------------------------------------------------------------------------

test("buildDiversifiedShortlist reserves slots per bucket and drops gossip", () => {
  const candidates: ScoutCandidate[] = [
    ...Array.from({ length: 12 }, (_, i) =>
      makeCandidate({
        eventId: `g${i}`,
        sourceBucket: "global",
        volume24hr: 100_000 - i,
        title: `Global market ${i}?`,
      }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      makeCandidate({
        eventId: `m${i}`,
        sourceBucket: "movies",
        volume24hr: 50_000 - i,
        title: `Movie market ${i}?`,
      }),
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      makeCandidate({
        eventId: `u${i}`,
        sourceBucket: "music",
        volume24hr: 40_000 - i,
        title: `Music market ${i}?`,
      }),
    ),
    makeCandidate({
      eventId: "gossip1",
      sourceBucket: "celebrities",
      volume24hr: 99_999,
      title: "Taylor Swift pregnant by...?",
    }),
    ...Array.from({ length: 6 }, (_, i) =>
      makeCandidate({
        eventId: `c${i}`,
        sourceBucket: "celebrities",
        volume24hr: 30_000 - i,
        title: `Celebrity award ${i}?`,
      }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      makeCandidate({
        eventId: `t${i}`,
        sourceBucket: "tv",
        volume24hr: 20_000 - i,
        title: `TV market ${i}?`,
      }),
    ),
  ];

  const shortlist = buildDiversifiedShortlist(candidates, 30);
  assert.ok(shortlist.length <= 30);
  assert.ok(!shortlist.some((c) => c.eventId === "gossip1"));

  const counts = Object.fromEntries(
    ["global", "movies", "music", "celebrities", "tv"].map((id) => [
      id,
      shortlist.filter((c) => c.sourceBucket === id).length,
    ]),
  ) as Record<string, number>;

  assert.ok(counts.global >= 10, `expected >=10 global, got ${counts.global}`);
  assert.ok(counts.movies >= 6, `expected >=6 movies, got ${counts.movies}`);
  assert.ok(counts.music >= 5, `expected >=5 music, got ${counts.music}`);
  assert.ok(counts.celebrities >= 5, `expected >=5 celebrities, got ${counts.celebrities}`);
  assert.ok(counts.tv >= 4, `expected >=4 tv, got ${counts.tv}`);
});

test("buildDiversifiedShortlist backfills when a bucket is thin", () => {
  const candidates: ScoutCandidate[] = [
    ...Array.from({ length: 20 }, (_, i) =>
      makeCandidate({
        eventId: `g${i}`,
        sourceBucket: "global",
        volume24hr: 10_000 - i,
      }),
    ),
    makeCandidate({ eventId: "m0", sourceBucket: "movies", volume24hr: 500 }),
  ];
  const shortlist = buildDiversifiedShortlist(candidates, 15);
  assert.equal(shortlist.length, 15);
  assert.equal(shortlist.filter((c) => c.sourceBucket === "movies").length, 1);
  assert.ok(shortlist.filter((c) => c.sourceBucket === "global").length >= 14);
});

// ---------------------------------------------------------------------------
// Post-GPT diversity guards
// ---------------------------------------------------------------------------

test("applySelectionDiversityGuards drops low fitScore and caps politics/sports", () => {
  const candidates = new Map<string, ScoutCandidate>([
    ["p1", makeCandidate({ eventId: "p1", sourceBucket: "global", volume24hr: 100 })],
    ["p2", makeCandidate({ eventId: "p2", sourceBucket: "global", volume24hr: 90 })],
    ["p3", makeCandidate({ eventId: "p3", sourceBucket: "global", volume24hr: 80 })],
    ["s1", makeCandidate({ eventId: "s1", sourceBucket: "global", volume24hr: 70 })],
    ["s2", makeCandidate({ eventId: "s2", sourceBucket: "global", volume24hr: 60 })],
    ["s3", makeCandidate({ eventId: "s3", sourceBucket: "global", volume24hr: 50 })],
    ["f1", makeCandidate({ eventId: "f1", sourceBucket: "movies", volume24hr: 40 })],
    ["low", makeCandidate({ eventId: "low", sourceBucket: "music", volume24hr: 30 })],
  ]);

  const selections: ScoutSelection[] = [
    makeSelection({ eventId: "p1", category: "politics", fitScore: 90 }),
    makeSelection({ eventId: "p2", category: "politics", fitScore: 85 }),
    makeSelection({ eventId: "p3", category: "politics", fitScore: 80 }),
    makeSelection({ eventId: "s1", category: "sports", fitScore: 88 }),
    makeSelection({ eventId: "s2", category: "sports", fitScore: 84 }),
    makeSelection({ eventId: "s3", category: "sports", fitScore: 82 }),
    makeSelection({ eventId: "f1", category: "film-tv", fitScore: 75 }),
    makeSelection({ eventId: "low", category: "music", fitScore: 40 }),
  ];

  const kept = applySelectionDiversityGuards(selections, candidates, 5);
  assert.ok(!kept.some((s) => s.eventId === "low"));
  assert.ok(kept.some((s) => s.eventId === "f1"));
  assert.ok(kept.filter((s) => s.category === "politics").length <= 2);
  assert.ok(kept.filter((s) => s.category === "sports").length <= 2);
  assert.equal(kept.length, 5);
});

test("applySelectionDiversityGuards backfills when only politics/sports remain", () => {
  const candidates = new Map<string, ScoutCandidate>([
    ["p1", makeCandidate({ eventId: "p1", sourceBucket: "global", volume24hr: 100 })],
    ["p2", makeCandidate({ eventId: "p2", sourceBucket: "global", volume24hr: 90 })],
    ["p3", makeCandidate({ eventId: "p3", sourceBucket: "global", volume24hr: 80 })],
    ["p4", makeCandidate({ eventId: "p4", sourceBucket: "global", volume24hr: 70 })],
    ["p5", makeCandidate({ eventId: "p5", sourceBucket: "global", volume24hr: 60 })],
  ]);
  const selections = ["p1", "p2", "p3", "p4", "p5"].map((id, i) =>
    makeSelection({ eventId: id, category: "politics", fitScore: 90 - i }),
  );
  const kept = applySelectionDiversityGuards(selections, candidates, 5);
  assert.equal(kept.length, 5);
});

test("applySelectionDiversityGuards does not overflow politics when film-tv remains", () => {
  const candidates = new Map<string, ScoutCandidate>([
    ["p1", makeCandidate({ eventId: "p1", sourceBucket: "global", volume24hr: 100 })],
    ["p2", makeCandidate({ eventId: "p2", sourceBucket: "global", volume24hr: 90 })],
    ["s1", makeCandidate({ eventId: "s1", sourceBucket: "global", volume24hr: 88 })],
    ["s2", makeCandidate({ eventId: "s2", sourceBucket: "global", volume24hr: 84 })],
    ["p3", makeCandidate({ eventId: "p3", sourceBucket: "global", volume24hr: 80 })],
    ["f1", makeCandidate({ eventId: "f1", sourceBucket: "movies", volume24hr: 75 })],
  ]);
  const selections: ScoutSelection[] = [
    makeSelection({ eventId: "p1", category: "politics", fitScore: 90 }),
    makeSelection({ eventId: "p2", category: "politics", fitScore: 85 }),
    makeSelection({ eventId: "s1", category: "sports", fitScore: 88 }),
    makeSelection({ eventId: "s2", category: "sports", fitScore: 84 }),
    makeSelection({ eventId: "p3", category: "politics", fitScore: 80 }),
    makeSelection({ eventId: "f1", category: "film-tv", fitScore: 75 }),
  ];
  const kept = applySelectionDiversityGuards(selections, candidates, 5);
  assert.equal(kept.filter((s) => s.category === "politics").length, 2);
  assert.ok(kept.some((s) => s.eventId === "f1"));
  assert.ok(!kept.some((s) => s.eventId === "p3"));
});

test("applySelectionDiversityGuards drops missing fitScore", () => {
  const candidates = new Map<string, ScoutCandidate>([
    ["a", makeCandidate({ eventId: "a", sourceBucket: "movies", volume24hr: 100 })],
    ["b", makeCandidate({ eventId: "b", sourceBucket: "music", volume24hr: 90 })],
  ]);
  const selections = [
    makeSelection({ eventId: "a", category: "film-tv", fitScore: Number.NaN }),
    makeSelection({ eventId: "b", category: "music", fitScore: 70 }),
  ];
  const kept = applySelectionDiversityGuards(selections, candidates, 5);
  assert.deepEqual(kept.map((s) => s.eventId), ["b"]);
});
