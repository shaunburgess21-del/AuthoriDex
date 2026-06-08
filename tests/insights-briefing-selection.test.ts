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
    const news = new Map([
      ["t1", 10],
      ["t2", 5],
      ["m1", 100],
    ]);

    const candidates = selectBriefingAnchorCandidates(people, moverIds, news);
    assert.deepEqual(
      candidates.map((p) => p.id),
      ["t1", "t2"],
    );
  });

  it("forces board #1 then top 2 news when board leader is not top news", () => {
    const people = [
      person("board", "BoardLeader", 1, 1),
      person("news1", "NewsTop", 2, 2),
      person("news2", "NewsSecond", 3, 3),
      person("other", "Other", 4, 4),
    ];
    const moverIds = new Set<string>();
    const news = new Map([
      ["board", 5],
      ["news1", 50],
      ["news2", 30],
      ["other", 10],
    ]);

    const candidates = selectBriefingAnchorCandidates(people, moverIds, news);
    assert.deepEqual(
      candidates.map((p) => p.id),
      ["board", "news1", "news2"],
    );
  });

  it("falls back to top 3 by news when board #1 is also top news", () => {
    const people = [
      person("board", "BoardLeader", 1, 1),
      person("news2", "NewsSecond", 2, 2),
      person("news3", "NewsThird", 3, 3),
    ];
    const moverIds = new Set<string>();
    const news = new Map([
      ["board", 100],
      ["news2", 50],
      ["news3", 25],
    ]);

    const candidates = selectBriefingAnchorCandidates(people, moverIds, news);
    assert.deepEqual(
      candidates.map((p) => p.id),
      ["board", "news2", "news3"],
    );
  });

  it("uses top 3 by news when board #1 is a mover", () => {
    const people = [
      person("board", "BoardLeader", 1, 50),
      person("news1", "NewsTop", 2, 2),
      person("news2", "NewsSecond", 3, 3),
      person("news3", "NewsThird", 4, 1),
    ];
    const moverIds = new Set(["board"]);
    const news = new Map([
      ["board", 10],
      ["news1", 80],
      ["news2", 60],
      ["news3", 40],
    ]);

    const candidates = selectBriefingAnchorCandidates(people, moverIds, news);
    assert.deepEqual(
      candidates.map((p) => p.id),
      ["news1", "news2", "news3"],
    );
  });
});
