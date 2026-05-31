import test from "node:test";
import assert from "node:assert/strict";

import { pickCascadeWinningSource } from "../server/providers/cascade-news";

test("pickCascadeWinningSource: Currents wins when > 0", () => {
  assert.equal(
    pickCascadeWinningSource({ currents: 5, dataforseo: 10, serper: 20, gdelt: 100 }),
    "currents",
  );
});

test("pickCascadeWinningSource: DataForSEO when Currents=0", () => {
  assert.equal(
    pickCascadeWinningSource({ currents: 0, dataforseo: 3, serper: 0, gdelt: 0 }),
    "dataforseo_news",
  );
});

test("pickCascadeWinningSource: Serper before GDELT", () => {
  assert.equal(
    pickCascadeWinningSource({ currents: 0, dataforseo: 0, serper: 7, gdelt: 50 }),
    "serper_news",
  );
});

test("pickCascadeWinningSource: GDELT last resort", () => {
  assert.equal(
    pickCascadeWinningSource({ currents: 0, dataforseo: 0, serper: 0, gdelt: 2 }),
    "gdelt",
  );
});

test("pickCascadeWinningSource: all zero returns null", () => {
  assert.equal(
    pickCascadeWinningSource({ currents: 0, dataforseo: 0, serper: 0, gdelt: 0 }),
    null,
  );
});
