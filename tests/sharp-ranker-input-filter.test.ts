/**
 * Unit tests for `filterRankableMarketsForRanker`.
 *
 * Pins the contract between the world-market kill switch and the sharp
 * ranker's input pool: when WORLD_MARKETS_LLM_ENABLED is false, the
 * ranker must not waste its top-N slots on community markets the
 * action worker will refuse to act on anyway.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { filterRankableMarketsForRanker } from "../server/agents/sharpRanker-input";

function m(id: string, marketType: string) {
  return { id, marketType };
}

test("ranker input: world flag ON keeps every market (no-op pass-through)", () => {
  const input = [
    m("a", "updown"),
    m("b", "community"),
    m("c", "h2h"),
    m("d", "community"),
  ];
  const result = filterRankableMarketsForRanker(input, { worldMarketsLlmEnabled: true });
  assert.equal(result.kept.length, 4);
  assert.equal(result.dropped.length, 0);
  assert.deepEqual(result.kept, input);
});

test("ranker input: world flag OFF drops community markets only", () => {
  const input = [
    m("a", "updown"),
    m("b", "community"),
    m("c", "h2h"),
    m("d", "community"),
    m("e", "gainer"),
    m("f", "jackpot"),
  ];
  const result = filterRankableMarketsForRanker(input, { worldMarketsLlmEnabled: false });
  assert.deepEqual(
    result.kept.map((x) => x.id),
    ["a", "c", "e", "f"],
  );
  assert.deepEqual(
    result.dropped.map((x) => x.id),
    ["b", "d"],
  );
});

test("ranker input: world flag OFF preserves order of kept markets", () => {
  // Ranker downstream expects stable order so the cache key
  // (computeInputKey, sorted internally) is reproducible across sweeps
  // with identical inputs. Even though the cache itself sorts, drift
  // here would be a surprise — pin it.
  const input = [m("z", "updown"), m("y", "community"), m("x", "h2h"), m("w", "community")];
  const result = filterRankableMarketsForRanker(input, { worldMarketsLlmEnabled: false });
  assert.deepEqual(result.kept.map((x) => x.id), ["z", "x"]);
});

test("ranker input: empty input → empty kept + dropped (no throw)", () => {
  const result = filterRankableMarketsForRanker([], { worldMarketsLlmEnabled: false });
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.dropped, []);
});

test("ranker input: all-community input + world OFF drops everything", () => {
  const input = [m("a", "community"), m("b", "community"), m("c", "community")];
  const result = filterRankableMarketsForRanker(input, { worldMarketsLlmEnabled: false });
  assert.deepEqual(result.kept, []);
  assert.deepEqual(
    result.dropped.map((x) => x.id),
    ["a", "b", "c"],
  );
});
