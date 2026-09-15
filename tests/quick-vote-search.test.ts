import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchupSearchLabel,
  searchQuickVoteCards,
  type QuickVoteSearchRecord,
} from "../client/src/lib/quickVoteSearch";

function record(
  partial: Partial<QuickVoteSearchRecord> & Pick<QuickVoteSearchRecord, "id" | "index" | "type" | "label">,
): QuickVoteSearchRecord {
  return {
    titleHaystack: "",
    optionHaystack: "",
    ...partial,
  };
}

const goat = record({
  id: "goat",
  index: 4,
  type: "matchup",
  label: "Ronaldo vs Messi",
  titleHaystack: "Who is the GOAT?",
  optionHaystack: "Ronaldo Messi",
});

const dogs = record({
  id: "pets",
  index: 0,
  type: "matchup",
  label: "Dogs vs Cats",
  titleHaystack: "Paws or claws?",
  optionHaystack: "Dogs Cats",
});

const sentiment = record({
  id: "sent",
  index: 1,
  type: "sentiment",
  label: "Messi deserved the Ballon d'Or",
  titleHaystack: "Messi deserved the Ballon d'Or",
});

describe("searchQuickVoteCards", () => {
  it("returns nothing for an empty or one-character query", () => {
    assert.deepEqual(searchQuickVoteCards("", [goat]), []);
    assert.deepEqual(searchQuickVoteCards(" ", [goat]), []);
    assert.deepEqual(searchQuickVoteCards("m", [goat]), []);
  });

  it("AND-matches both names so 'ronaldo messi' hits the GOAT matchup", () => {
    const hits = searchQuickVoteCards("ronaldo messi", [dogs, goat, sentiment]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, "goat");
  });

  it("matches a single option name", () => {
    const hits = searchQuickVoteCards("messi", [dogs, goat, sentiment]);
    assert.ok(hits.some((h) => h.id === "goat"));
    assert.ok(hits.some((h) => h.id === "sent"));
    assert.ok(!hits.some((h) => h.id === "pets"));
  });

  it("ranks option-name hits above title-only hits", () => {
    const hits = searchQuickVoteCards("messi", [sentiment, goat]);
    assert.ok(hits.length >= 2);
    assert.equal(hits[0].id, "goat");
    assert.ok(hits[0].score > hits[1].score);
  });

  it("matches title-only queries", () => {
    assert.equal(searchQuickVoteCards("paws", [dogs, goat]).length, 1);
    assert.equal(searchQuickVoteCards("paws", [dogs, goat])[0].id, "pets");
  });

  it("matches an overall-rating card by person name", () => {
    const rating = record({
      id: "takaichi",
      index: 8,
      type: "rating",
      label: "Sanae Takaichi",
      titleHaystack: "Sanae Takaichi",
      extraHaystack: "politics",
    });
    const hits = searchQuickVoteCards("takaichi", [dogs, goat, sentiment, rating]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, "takaichi");
    assert.equal(hits[0].type, "rating");
  });
});

describe("matchupSearchLabel", () => {
  it("uses A vs B when both names exist", () => {
    assert.equal(matchupSearchLabel("Ronaldo", "Messi", "GOAT"), "Ronaldo vs Messi");
  });

  it("falls back to the prompt when names are missing", () => {
    assert.equal(matchupSearchLabel("", "", "Who is the GOAT?"), "Who is the GOAT?");
  });
});
