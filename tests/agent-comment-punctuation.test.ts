import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripTrailingFullStop } from "../server/agents/llmCommentGenerator";

describe("stripTrailingFullStop", () => {
  it("drops a single trailing full stop", () => {
    assert.equal(stripTrailingFullStop("Spain by a mile."), "Spain by a mile");
    assert.equal(stripTrailingFullStop("Burger wins. Hits harder.  "), "Burger wins. Hits harder");
  });

  it("drops the full stop before a closing emoji", () => {
    assert.equal(stripTrailingFullStop("Ali is the greatest. 🐐"), "Ali is the greatest 🐐");
    assert.equal(stripTrailingFullStop("Coffee all day.☕️"), "Coffee all day☕️");
  });

  it("leaves ellipses, ! and ? alone", () => {
    assert.equal(stripTrailingFullStop("Not sure about this..."), "Not sure about this...");
    assert.equal(stripTrailingFullStop("Definitely not!"), "Definitely not!");
    assert.equal(stripTrailingFullStop("Who even asked?"), "Who even asked?");
    assert.equal(stripTrailingFullStop("Clipped mid-thought…"), "Clipped mid-thought…");
  });

  it("leaves dotted abbreviations alone", () => {
    assert.equal(stripTrailingFullStop("Big win for the U.S."), "Big win for the U.S.");
    assert.equal(stripTrailingFullStop("Kickoff is at 8 p.m."), "Kickoff is at 8 p.m.");
  });
});
