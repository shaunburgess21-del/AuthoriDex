import test from "node:test";
import assert from "node:assert/strict";
import type { ScoutSelection } from "../server/jobs/market-scout";

// Dummy DATABASE_URL before importing anything that could transitively load
// server/db.ts. Same pattern as the other tests.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  normalizeSeriesKey,
  filterSelectionsBySeries,
  readSeriesKey,
  stripSeriesDeadlineNoise,
} = await import("../server/jobs/market-scout");

function makeSelection(
  overrides: Partial<ScoutSelection> & Pick<ScoutSelection, "eventId" | "title" | "seriesKey">,
): ScoutSelection {
  return {
    eventId: overrides.eventId,
    title: overrides.title,
    slug: overrides.slug ?? `slug-${overrides.eventId}`,
    teaser: overrides.teaser ?? "Teaser",
    summary: overrides.summary ?? "Summary",
    category: overrides.category ?? "politics",
    secondaryCategories: overrides.secondaryCategories ?? [],
    resolutionCriteria: overrides.resolutionCriteria ?? ["Official source"],
    scoutWatch: overrides.scoutWatch ?? "Watch the news",
    linkedPerson: overrides.linkedPerson ?? null,
    relatedPeople: overrides.relatedPeople ?? [],
    fitScore: overrides.fitScore ?? 70,
    entryLabels: overrides.entryLabels ?? ["Yes", "No"],
    seriesKey: overrides.seriesKey,
  };
}

// ---------------------------------------------------------------------------
// stripSeriesDeadlineNoise
// ---------------------------------------------------------------------------

test("stripSeriesDeadlineNoise removes 'by Month Day' deadlines", () => {
  assert.equal(
    stripSeriesDeadlineNoise(
      "Will Strait of Hormuz ship traffic return to normal by July 15?",
    ),
    "Will Strait of Hormuz ship traffic return to normal?",
  );
  assert.equal(
    stripSeriesDeadlineNoise(
      "Will Strait of Hormuz ship traffic return to normal by Jul. 31, 2026?",
    ),
    "Will Strait of Hormuz ship traffic return to normal?",
  );
});

test("stripSeriesDeadlineNoise removes ISO and year-only deadlines", () => {
  assert.equal(
    stripSeriesDeadlineNoise("Will traffic recover by 2026-12-31?"),
    "Will traffic recover?",
  );
  assert.equal(
    stripSeriesDeadlineNoise("Will traffic recover by end of 2026?"),
    "Will traffic recover?",
  );
});

// ---------------------------------------------------------------------------
// normalizeSeriesKey
// ---------------------------------------------------------------------------

test("normalizeSeriesKey lowercases and kebab-cases a clean key", () => {
  assert.equal(
    normalizeSeriesKey("Strait Of Hormuz Traffic Normal", "ignored"),
    "strait-of-hormuz-traffic-normal",
  );
});

test("normalizeSeriesKey strips punctuation and collapses separators", () => {
  assert.equal(
    normalizeSeriesKey("  Hormuz!! traffic__normal  ", "ignored"),
    "hormuz-traffic-normal",
  );
});

test("normalizeSeriesKey falls back to deadline-stripped title when raw is empty", () => {
  assert.equal(
    normalizeSeriesKey("", "Will Strait of Hormuz traffic return to normal by July 15?"),
    "will-strait-of-hormuz-traffic-return-to-normal",
  );
});

test("normalizeSeriesKey title fallback collapses date siblings to the same key", () => {
  const jul15 = normalizeSeriesKey(
    null,
    "Will Strait of Hormuz ship traffic return to normal by July 15?",
  );
  const jul31 = normalizeSeriesKey(
    null,
    "Will Strait of Hormuz ship traffic return to normal by July 31?",
  );
  assert.equal(jul15, jul31);
  assert.equal(jul15, "will-strait-of-hormuz-ship-traffic-return-to-normal");
});

test("normalizeSeriesKey falls back when raw is null/undefined/garbled whitespace", () => {
  assert.equal(
    normalizeSeriesKey(null, "Who will win MSI 2026?"),
    "who-will-win-msi-2026",
  );
  assert.equal(
    normalizeSeriesKey(undefined, "Who will win MSI 2026?"),
    "who-will-win-msi-2026",
  );
  assert.equal(
    normalizeSeriesKey("   !!!   ", "Fallback Title Here"),
    "fallback-title-here",
  );
});

test("normalizeSeriesKey returns 'series' when both raw and title are empty", () => {
  assert.equal(normalizeSeriesKey("", ""), "series");
  assert.equal(normalizeSeriesKey(null, "!!!"), "series");
});

// ---------------------------------------------------------------------------
// readSeriesKey
// ---------------------------------------------------------------------------

test("readSeriesKey returns trimmed string from metadata", () => {
  assert.equal(
    readSeriesKey({ seriesKey: "  hormuz-traffic-normal  " }),
    "hormuz-traffic-normal",
  );
});

test("readSeriesKey returns null for missing/blank/non-object metadata", () => {
  assert.equal(readSeriesKey(null), null);
  assert.equal(readSeriesKey(undefined), null);
  assert.equal(readSeriesKey({}), null);
  assert.equal(readSeriesKey({ seriesKey: "   " }), null);
  assert.equal(readSeriesKey({ seriesKey: 42 }), null);
});

// ---------------------------------------------------------------------------
// filterSelectionsBySeries
// ---------------------------------------------------------------------------

test("filterSelectionsBySeries blocks selections whose series is occupied", () => {
  const occupied = new Set(["strait-of-hormuz-traffic-normal"]);
  const selections = [
    makeSelection({
      eventId: "e1",
      title: "Will Strait of Hormuz ship traffic return to normal by August 31?",
      seriesKey: "strait-of-hormuz-traffic-normal",
    }),
    makeSelection({
      eventId: "e2",
      title: "Who will win MSI 2026?",
      seriesKey: "msi-2026-winner",
    }),
  ];

  const { kept, blocked } = filterSelectionsBySeries(selections, occupied);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].eventId, "e2");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].eventId, "e1");
});

test("filterSelectionsBySeries de-dupes within the batch (first-wins)", () => {
  const selections = [
    makeSelection({
      eventId: "jul15",
      title: "Will Strait of Hormuz ship traffic return to normal by July 15?",
      seriesKey: "strait-of-hormuz-traffic-normal",
    }),
    makeSelection({
      eventId: "jul31",
      title: "Will Strait of Hormuz ship traffic return to normal by July 31?",
      seriesKey: "strait-of-hormuz-traffic-normal",
    }),
    makeSelection({
      eventId: "dec31",
      title: "Will Strait of Hormuz ship traffic recover by Dec. 31?",
      seriesKey: "strait-of-hormuz-traffic-normal",
    }),
  ];

  const { kept, blocked } = filterSelectionsBySeries(selections, new Set());
  assert.equal(kept.length, 1);
  assert.equal(kept[0].eventId, "jul15");
  assert.equal(blocked.length, 2);
  assert.deepEqual(
    blocked.map((s) => s.eventId),
    ["jul31", "dec31"],
  );
});

test("filterSelectionsBySeries de-dupes date siblings even when seriesKey is missing", () => {
  const selections = [
    makeSelection({
      eventId: "jul15",
      title: "Will Strait of Hormuz ship traffic return to normal by July 15?",
      seriesKey: "",
    }),
    makeSelection({
      eventId: "jul31",
      title: "Will Strait of Hormuz ship traffic return to normal by July 31?",
      seriesKey: "",
    }),
  ];

  const { kept, blocked } = filterSelectionsBySeries(selections, new Set());
  assert.equal(kept.length, 1);
  assert.equal(kept[0].eventId, "jul15");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].eventId, "jul31");
});

test("filterSelectionsBySeries blocks via legacy title stem when occupied has no LLM key", () => {
  // Simulate occupied set built from a pre-seriesKey live market (title stem only).
  const occupied = new Set([
    normalizeSeriesKey(
      null,
      "Will Strait of Hormuz ship traffic return to normal by July 15?",
    ),
  ]);
  const selections = [
    makeSelection({
      eventId: "aug31",
      title: "Will Strait of Hormuz ship traffic return to normal by August 31?",
      // LLM assigned a clean series key — title stem still matches legacy.
      seriesKey: "strait-of-hormuz-traffic-normal",
    }),
  ];

  const { kept, blocked } = filterSelectionsBySeries(selections, occupied);
  assert.equal(kept.length, 0);
  assert.equal(blocked.length, 1);
});

test("filterSelectionsBySeries passes through distinct series and preserves order", () => {
  const selections = [
    makeSelection({
      eventId: "a",
      title: "Will Bitcoin be above $100k?",
      seriesKey: "btc-above-100k",
    }),
    makeSelection({
      eventId: "b",
      title: "Who will win Wimbledon Men's?",
      seriesKey: "wimbledon-mens-2026",
    }),
    makeSelection({
      eventId: "c",
      title: "Who will win Wimbledon Women's?",
      seriesKey: "wimbledon-womens-2026",
    }),
  ];

  const { kept, blocked } = filterSelectionsBySeries(selections, new Set());
  assert.equal(blocked.length, 0);
  assert.deepEqual(
    kept.map((s) => s.eventId),
    ["a", "b", "c"],
  );
});

test("filterSelectionsBySeries normalizes occupied keys and selection keys alike", () => {
  // Occupied key stored with different casing/punctuation than the selection.
  const occupied = new Set([
    normalizeSeriesKey("Strait Of Hormuz Traffic Normal!", "x"),
  ]);
  const selections = [
    makeSelection({
      eventId: "sibling",
      title: "Will Hormuz traffic recover by Dec 31?",
      seriesKey: "STRAIT-OF-HORMUZ-TRAFFIC-NORMAL",
    }),
  ];

  const { kept, blocked } = filterSelectionsBySeries(selections, occupied);
  assert.equal(kept.length, 0);
  assert.equal(blocked.length, 1);
});

test("filterSelectionsBySeries falls back to title when seriesKey is empty", () => {
  const occupied = new Set([
    normalizeSeriesKey(null, "Will Messi play in the World Cup?"),
  ]);
  const selections = [
    makeSelection({
      eventId: "messi",
      title: "Will Messi play in the World Cup?",
      seriesKey: "",
    }),
    makeSelection({
      eventId: "other",
      title: "Will Ronaldo play in the World Cup?",
      seriesKey: "",
    }),
  ];

  const { kept, blocked } = filterSelectionsBySeries(selections, occupied);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].eventId, "messi");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].eventId, "other");
});
