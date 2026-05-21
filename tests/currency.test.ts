import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENCY,
  formatVox,
  formatVoxCompact,
  formatVoxDelta,
  formatVoxPrice,
  voxWord,
} from "../shared/currency";

// Pin the symbol literal so an accidental glyph swap (e.g. someone
// running a find/replace) blows up the build. The Ꝟ glyph is the
// brand mark — it must not silently change.
test("CURRENCY: symbol literal is U+A75E (Ꝟ) and name is 'Vox'", () => {
  assert.equal(CURRENCY.symbol, "\u{A75E}");
  assert.equal(CURRENCY.symbol.codePointAt(0), 0xa75e);
  assert.equal(CURRENCY.name, "Vox");
});

// --- formatVox -------------------------------------------------------------

test("formatVox: whole number gets symbol prefix and thousands separator", () => {
  assert.equal(formatVox(9510), "Ꝟ9,510");
  assert.equal(formatVox(0), "Ꝟ0");
  assert.equal(formatVox(1_234_567), "Ꝟ1,234,567");
});

test("formatVox: negative number uses Unicode minus, not ASCII hyphen", () => {
  assert.equal(formatVox(-500), "\u2212Ꝟ500");
});

test("formatVox: non-finite input falls back to Ꝟ0", () => {
  assert.equal(formatVox(Number.NaN), "Ꝟ0");
  assert.equal(formatVox(Number.POSITIVE_INFINITY), "Ꝟ0");
});

// --- formatVoxCompact ------------------------------------------------------

test("formatVoxCompact: under 1K renders the raw rounded value", () => {
  assert.equal(formatVoxCompact(850), "Ꝟ850");
  assert.equal(formatVoxCompact(1), "Ꝟ1");
});

test("formatVoxCompact: 1K–999K uses K suffix with stripped trailing .0", () => {
  assert.equal(formatVoxCompact(1_200), "Ꝟ1.2K");
  assert.equal(formatVoxCompact(12_000), "Ꝟ12K");
  assert.equal(formatVoxCompact(45_049), "Ꝟ45K");
});

test("formatVoxCompact: 1M+ uses M suffix", () => {
  assert.equal(formatVoxCompact(1_500_000), "Ꝟ1.5M");
  assert.equal(formatVoxCompact(10_000_000), "Ꝟ10M");
});

test("formatVoxCompact: returns null for null, NaN, zero, negatives", () => {
  // Volume chips should be skipped entirely for these — fresh AMM
  // markets with no trades show no chip rather than 'Ꝟ0'.
  assert.equal(formatVoxCompact(null), null);
  assert.equal(formatVoxCompact(undefined), null);
  assert.equal(formatVoxCompact(0), null);
  assert.equal(formatVoxCompact(-100), null);
  assert.equal(formatVoxCompact(Number.NaN), null);
});

// --- formatVoxDelta --------------------------------------------------------

test("formatVoxDelta: positive gets +Ꝟ prefix, two decimal places", () => {
  assert.equal(formatVoxDelta(5), "+Ꝟ5.00");
  assert.equal(formatVoxDelta(13.41), "+Ꝟ13.41");
});

test("formatVoxDelta: negative uses Unicode minus", () => {
  assert.equal(formatVoxDelta(-1.234), "\u2212Ꝟ1.23");
  assert.equal(formatVoxDelta(-500), "\u2212Ꝟ500.00");
});

test("formatVoxDelta: sub-half-cent values clamp to Ꝟ0.00 (no signed zero)", () => {
  // Floating-point AMM math otherwise emits '−Ꝟ0.00' which reads
  // as a bug. The clamp window matches the existing HeadToHeadCard
  // PnL display logic that this helper replaces.
  assert.equal(formatVoxDelta(-0.0001), "Ꝟ0.00");
  assert.equal(formatVoxDelta(0.0001), "Ꝟ0.00");
  assert.equal(formatVoxDelta(0), "Ꝟ0.00");
});

test("formatVoxDelta: non-finite input falls back to Ꝟ0.00", () => {
  assert.equal(formatVoxDelta(null), "Ꝟ0.00");
  assert.equal(formatVoxDelta(undefined), "Ꝟ0.00");
  assert.equal(formatVoxDelta(Number.NaN), "Ꝟ0.00");
});

// --- formatVoxPrice --------------------------------------------------------

test("formatVoxPrice: default 2dp, no sign for positive values", () => {
  assert.equal(formatVoxPrice(0.517), "Ꝟ0.52");
  assert.equal(formatVoxPrice(0.5), "Ꝟ0.50");
});

test("formatVoxPrice: custom decimal-place arg", () => {
  assert.equal(formatVoxPrice(0.517, 3), "Ꝟ0.517");
  assert.equal(formatVoxPrice(0.5, 0), "Ꝟ1");
});

test("formatVoxPrice: negative input renders with minus for safety", () => {
  // LMSR prices should never be negative, but if one leaks through we
  // shouldn't render `Ꝟ-0.52` (which is ambiguous against `−Ꝟ0.52`).
  assert.equal(formatVoxPrice(-0.5), "\u2212Ꝟ0.50");
});

// --- voxWord ---------------------------------------------------------------

test("voxWord: number followed by 'Vox' noun — never pluralised", () => {
  // Vox is a mass noun (treat like 'cash'). Verify singular AND
  // plural-feeling values both use the same suffix.
  assert.equal(voxWord(1), "1 Vox");
  assert.equal(voxWord(0), "0 Vox");
  assert.equal(voxWord(9_510), "9,510 Vox");
  assert.equal(voxWord(10_000), "10,000 Vox");
});
