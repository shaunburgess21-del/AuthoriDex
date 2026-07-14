/**
 * Unit tests for up/down median-close outcome helper + flip detection
 * + settlement-notes close-method extraction for calibration audit.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { upDownOutcomeFromScores } = await import("../server/jobs/market-resolver");
const { extractSettlementCloseMethod } = await import(
  "../server/services/native-markets-calibration"
);

test("upDownOutcomeFromScores: Up / Down / void_tie", () => {
  assert.equal(upDownOutcomeFromScores(100, 110), "Up");
  assert.equal(upDownOutcomeFromScores(100, 90), "Down");
  assert.equal(upDownOutcomeFromScores(100, 100), "void_tie");
});

test("winnerWouldFlip detection: median vs single disagree", () => {
  const open = 500_000;
  const singleClose = 499_000; // Down vs open
  const medianClose = 510_000; // Up vs open
  const single = upDownOutcomeFromScores(open, singleClose);
  const median = upDownOutcomeFromScores(open, medianClose);
  assert.equal(single, "Down");
  assert.equal(median, "Up");
  assert.equal(single !== median, true);
});

test("winnerWouldFlip detection: median vs single agree", () => {
  const open = 500_000;
  const single = upDownOutcomeFromScores(open, 480_000);
  const median = upDownOutcomeFromScores(open, 470_000);
  assert.equal(single, "Down");
  assert.equal(median, "Down");
  assert.equal(single !== median, false);
});

test("extractSettlementCloseMethod: top-level updown notes", () => {
  assert.equal(extractSettlementCloseMethod({ closeMethod: "median" }), "median");
  assert.equal(extractSettlementCloseMethod({ closeMethod: "single" }), "single");
  assert.equal(extractSettlementCloseMethod({}), null);
});

test("extractSettlementCloseMethod: nested H2H entry notes", () => {
  assert.equal(
    extractSettlementCloseMethod({
      entryA: { closeMethod: "median" },
      entryB: { closeMethod: "median" },
    }),
    "median",
  );
  assert.equal(
    extractSettlementCloseMethod({
      entryA: { closeMethod: "median" },
      entryB: { closeMethod: "single" },
    }),
    "single",
  );
});

test("extractSettlementCloseMethod: gainer rankings notes", () => {
  assert.equal(
    extractSettlementCloseMethod({
      rankings: [
        { closeMethod: "median" },
        { closeMethod: "median" },
      ],
    }),
    "median",
  );
});
