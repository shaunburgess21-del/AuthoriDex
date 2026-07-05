import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL before importing anything that could transitively load
// server/db.ts. Same pattern as the other tests.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { parseGammaTimestamp } = await import("../server/providers/polymarket");

// ---------------------------------------------------------------------------
// parseGammaTimestamp — cutoff-critical: a wrong parse shifts when betting
// closes on scouted markets, so cover the real Gamma formats + edge cases.
// ---------------------------------------------------------------------------

test("parses market-level gameStartTime with short +00 offset", () => {
  // Gamma serializes gameStartTime like "2026-07-07 00:00:00+00".
  assert.equal(
    parseGammaTimestamp("2026-07-07 00:00:00+00"),
    "2026-07-07T00:00:00.000Z",
  );
});

test("parses event-level startTime in full ISO with Z", () => {
  assert.equal(
    parseGammaTimestamp("2026-07-07T00:00:00Z"),
    "2026-07-07T00:00:00.000Z",
  );
});

test("treats a designator-less timestamp as UTC (not server local)", () => {
  // Hardening: if Gamma ever omits the offset, we must not fall back to the
  // server's local zone (which would shift the betting cutoff by hours).
  assert.equal(
    parseGammaTimestamp("2026-07-07 12:30:00"),
    "2026-07-07T12:30:00.000Z",
  );
});

test("preserves a non-UTC short offset", () => {
  // "+05" means 05:00 ahead of UTC, so the instant is 5h earlier in UTC.
  assert.equal(
    parseGammaTimestamp("2026-07-07 05:00:00+05"),
    "2026-07-07T00:00:00.000Z",
  );
});

test("preserves a full +HH:MM offset unchanged", () => {
  assert.equal(
    parseGammaTimestamp("2026-07-07T05:30:00+05:30"),
    "2026-07-07T00:00:00.000Z",
  );
});

test("returns null for empty / non-string / unparseable input", () => {
  assert.equal(parseGammaTimestamp(""), null);
  assert.equal(parseGammaTimestamp("   "), null);
  assert.equal(parseGammaTimestamp(null), null);
  assert.equal(parseGammaTimestamp(undefined), null);
  assert.equal(parseGammaTimestamp(1234567890), null);
  assert.equal(parseGammaTimestamp("not a date"), null);
});
