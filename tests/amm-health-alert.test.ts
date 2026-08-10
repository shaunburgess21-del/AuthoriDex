/**
 * Unit tests for AMM health-check FAIL ops-alert idempotency.
 *
 * Guarantees a persistent FAIL does not mint a new email key every
 * 15 minutes — one key per UTC day per failing-set fingerprint.
 */
import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { buildAmmHealthFailIdempotencyKey } = await import(
  "../server/jobs/amm-health"
);

test("buildAmmHealthFailIdempotencyKey: stable within the same UTC day for the same failing set", () => {
  const now = new Date("2026-08-10T13:32:00.000Z");
  const a = buildAmmHealthFailIdempotencyKey(
    ["AMM seed-return drift (last 30d)"],
    now,
  );
  const b = buildAmmHealthFailIdempotencyKey(
    ["AMM seed-return drift (last 30d)"],
    new Date("2026-08-10T23:59:00.000Z"),
  );
  assert.equal(a, b);
  assert.match(a, /^amm_health_fail:2026-08-10:[0-9a-f]{8}$/);
});

test("buildAmmHealthFailIdempotencyKey: order of failing names does not matter", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const a = buildAmmHealthFailIdempotencyKey(["B", "A"], now);
  const b = buildAmmHealthFailIdempotencyKey(["A", "B"], now);
  assert.equal(a, b);
});

test("buildAmmHealthFailIdempotencyKey: new failing check mints a new key (fresh alert)", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const a = buildAmmHealthFailIdempotencyKey(["drift"], now);
  const b = buildAmmHealthFailIdempotencyKey(["drift", "orphan"], now);
  assert.notEqual(a, b);
});

test("buildAmmHealthFailIdempotencyKey: next UTC day mints a new key (daily re-ping)", () => {
  const a = buildAmmHealthFailIdempotencyKey(
    ["drift"],
    new Date("2026-08-10T12:00:00.000Z"),
  );
  const b = buildAmmHealthFailIdempotencyKey(
    ["drift"],
    new Date("2026-08-11T00:00:00.000Z"),
  );
  assert.notEqual(a, b);
  assert.ok(b.includes("2026-08-11"));
});

test("buildAmmHealthFailIdempotencyKey: long similar prefixes do not collide", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const prefix = "x".repeat(200);
  const a = buildAmmHealthFailIdempotencyKey([`${prefix}-a`], now);
  const b = buildAmmHealthFailIdempotencyKey([`${prefix}-b`], now);
  assert.notEqual(a, b);
});
