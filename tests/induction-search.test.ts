import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { highlightRanges, queryTokens, searchByName } from "../client/src/lib/inductionSearch";

const names = ["Barack Obama", "Katy Perry", "Beyoncé", "David Friedberg", "Ryan Cohen", "Obadiah Davidson"];

describe("induction search", () => {
  it("matches case- and accent-insensitively", () => {
    assert.deepEqual(searchByName(names, "beyonce", (n) => n), ["Beyoncé"]);
    assert.deepEqual(searchByName(names, "BEYONCÉ", (n) => n), ["Beyoncé"]);
  });

  it("requires every word, in any order", () => {
    assert.deepEqual(searchByName(names, "perry katy", (n) => n), ["Katy Perry"]);
    assert.deepEqual(searchByName(names, "katy obama", (n) => n), []);
  });

  it("ranks name-prefix, then word-prefix, then mid-word matches", () => {
    assert.deepEqual(searchByName(names, "oba", (n) => n), ["Obadiah Davidson", "Barack Obama"]);
    assert.deepEqual(searchByName(names, "david", (n) => n), ["David Friedberg", "Obadiah Davidson"]);
  });

  it("keeps the caller's order within the same match tier", () => {
    assert.deepEqual(searchByName(["Ryan B", "Ryan A"], "ryan", (n) => n), ["Ryan B", "Ryan A"]);
  });

  it("returns nothing for a blank query", () => {
    assert.deepEqual(queryTokens("   "), []);
    assert.deepEqual(searchByName(names, "  ", (n) => n), []);
  });

  it("maps highlight ranges back onto the original (accented) name", () => {
    assert.deepEqual(highlightRanges("Beyoncé", ["once"]), [{ start: 3, end: 7 }]);
    assert.deepEqual(highlightRanges("Katy Perry", ["per", "kat"]), [
      { start: 0, end: 3 },
      { start: 5, end: 8 },
    ]);
  });
});
