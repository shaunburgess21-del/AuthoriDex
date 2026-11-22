import test from "node:test";
import assert from "node:assert/strict";

import {
  FIRST_TO_PREDICT,
  OPENING_ODDS_NOTE,
  formatOutcomeChance,
  formatVolumeWithUnit,
  openingOddsNote,
  traderCountLabel,
} from "../client/src/lib/market-trust-copy";

test("trader count stays exact once anyone has predicted", () => {
  assert.equal(traderCountLabel(1), "1 trader");
  assert.equal(traderCountLabel(2), "2 traders");
  assert.equal(traderCountLabel(1, "participant"), "1 participant");
  assert.equal(traderCountLabel(2, "participant"), "2 participants");
});

test("zero traders is the only case that invites the first prediction", () => {
  assert.equal(traderCountLabel(0), FIRST_TO_PREDICT);
  assert.equal(traderCountLabel(-1), FIRST_TO_PREDICT);
  assert.equal(traderCountLabel(Number.NaN), FIRST_TO_PREDICT);
  assert.equal(openingOddsNote(0), OPENING_ODDS_NOTE);
  assert.equal(openingOddsNote(1), null);
  assert.equal(openingOddsNote(2), null);
});

test("multi-option chances omit Yes, binary sides keep their name", () => {
  assert.equal(formatOutcomeChance(33), "33%");
  assert.equal(formatOutcomeChance(10.4), "10%");
  assert.equal(formatOutcomeChance(33, "Yes"), "Yes 33%");
  assert.equal(formatOutcomeChance(67, "No"), "No 67%");
});

test("volume chip keeps a space before vol", () => {
  assert.equal(formatVolumeWithUnit(1_500), "\u{A75E}1.5K vol");
  assert.equal(formatVolumeWithUnit(850), "\u{A75E}850 vol");
  assert.equal(formatVolumeWithUnit(1_500_000), "\u{A75E}1.5M vol");
  assert.equal(formatVolumeWithUnit(0), null);
  assert.equal(formatVolumeWithUnit(null), null);
  assert.doesNotMatch(formatVolumeWithUnit(1_500) ?? "", /Kvol|Mvol/);
});
