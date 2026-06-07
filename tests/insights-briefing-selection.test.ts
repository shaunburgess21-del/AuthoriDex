import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TrendingPerson } from "@shared/schema";
import {
  selectBriefingAnchorCandidates,
  selectBriefingMovers,
} from "../server/services/insights/story-briefing";

function person(
  id: string,
  name: string,
  rank: number,
  change24h: number,
): TrendingPerson {
  return {
    id,
    name,
    rank,
    change24h,
  } as TrendingPerson;
}

describe("selectBriefingMovers", () => {
  it("returns hot-mover top 3 by 24h gain within rank cap", () => {
    const people = [
      person("a", "Alice", 48, 47),
      person("b", "Bob", 67, 31),
      person("c", "Carol", 64, 25),
      person("d", "Dana", 150, 99),
      person("e", "Eve", 10, 5),
    ];

    const movers = selectBriefingMovers(people);
    assert.deepEqual(
      movers.map((p) => p.id),
      ["a", "b", "c"],
    );
  });

  it("excludes zero and negative change24h", () => {
    const people = [
      person("a", "Alice", 5, -2),
      person("b", "Bob", 8, 0),
      person("c", "Carol", 12, 3),
    ];

    const movers = selectBriefingMovers(people);
    assert.deepEqual(movers.map((p) => p.id), ["c"]);
  });
});

describe("selectBriefingAnchorCandidates", () => {
  it("excludes people already chosen as movers", () => {
    const people = [
      person("t1", "Top1", 1, 1),
      person("t2", "Top2", 2, 2),
      person("m1", "Mover1", 48, 50),
    ];
    const moverIds = new Set(["m1"]);
    const hot6 = new Set(["m1"]);
    const news = new Map([
      ["t1", 10],
      ["t2", 5],
      ["m1", 100],
    ]);

    const candidates = selectBriefingAnchorCandidates(people, moverIds, hot6, news);
    assert.deepEqual(
      candidates.map((p) => p.id),
      ["t1", "t2"],
    );
  });

  it("prefers top-10 candidates outside hot-mover top 6, sorted by newsCount", () => {
    const people = [
      person("t1", "AnchorA", 1, 1),
      person("t2", "AnchorB", 2, 2),
      person("t3", "AnchorC", 3, 3),
      person("h1", "Hot1", 48, 50),
      person("h2", "Hot2", 49, 40),
      person("h3", "Hot3", 50, 30),
      person("h4", "Hot4", 51, 20),
      person("h5", "Hot5", 52, 15),
      person("h6", "Hot6", 53, 10),
    ];
    const moverIds = new Set<string>();
    const hot6 = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
    const news = new Map([
      ["t1", 5],
      ["t2", 20],
      ["t3", 10],
      ["h1", 100],
      ["h6", 50],
    ]);

    const candidates = selectBriefingAnchorCandidates(people, moverIds, hot6, news);
    // Preferred (outside hot6): t2 (20 news), t3 (10), t1 (5)
    assert.deepEqual(
      candidates.slice(0, 3).map((p) => p.id),
      ["t2", "t3", "t1"],
    );
    // Backfill (inside hot6) follows, sorted by newsCount
    assert.equal(candidates[3]?.id, "h1");
  });

  it("backfills from hot-6 when preferred pool is thin", () => {
    const people = [
      person("h1", "Hot1", 48, 50),
      person("h2", "Hot2", 49, 40),
      person("h3", "Hot3", 50, 30),
    ];
    const moverIds = new Set<string>();
    const hot6 = new Set(["h1", "h2", "h3"]);
    const news = new Map([
      ["h1", 30],
      ["h2", 20],
      ["h3", 10],
    ]);

    const candidates = selectBriefingAnchorCandidates(people, moverIds, hot6, news);
    assert.deepEqual(
      candidates.map((p) => p.id),
      ["h1", "h2", "h3"],
    );
  });
});
