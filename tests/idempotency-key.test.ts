import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidIdempotencyKey,
  parseIdempotencyKey,
} from "../server/services/idempotency-key";

// Pure helpers — no DB. Pins the validation rules so a route-layer
// edit can't accidentally widen what we accept (security) or narrow
// it (breaks naive retry clients).

test("isValidIdempotencyKey: standard crypto.randomUUID() v4 string is accepted", () => {
  // Sample taken from a real crypto.randomUUID() call.
  assert.equal(
    isValidIdempotencyKey("8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b"),
    true,
  );
});

test("isValidIdempotencyKey: 16-char alphanumeric token accepted (minimum length)", () => {
  assert.equal(isValidIdempotencyKey("aBcD1234_-EfGh56"), true);
});

test("isValidIdempotencyKey: 64-char alphanumeric token accepted (maximum length)", () => {
  const k = "a".repeat(64);
  assert.equal(isValidIdempotencyKey(k), true);
});

test("isValidIdempotencyKey: 15-char token rejected (one short of min)", () => {
  assert.equal(isValidIdempotencyKey("aBcD1234_-EfGh5"), false);
});

test("isValidIdempotencyKey: 65-char token rejected (one over max)", () => {
  assert.equal(isValidIdempotencyKey("a".repeat(65)), false);
});

test("isValidIdempotencyKey: a non-v4 UUID still passes via SAFE_TOKEN fallback (36 chars, valid charset)", () => {
  // Position 14 is the version digit. v4 requires '4'; this is '3' (v3).
  // We *intentionally* let it through via the alphanumeric+dash fallback
  // because we don't want to reject otherwise-reasonable client keys
  // (e.g. a custom UUID variant from a non-browser caller). The UUID_V4
  // regex is a positive recogniser, not an exclusionary gate.
  assert.equal(
    isValidIdempotencyKey("8e7b3f1a-5d2c-3f9e-b1a8-3c6d7e8f9a0b"),
    true,
  );
});

test("isValidIdempotencyKey: leading/trailing whitespace tolerated", () => {
  assert.equal(
    isValidIdempotencyKey("  8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b\n"),
    true,
  );
});

test("isValidIdempotencyKey: empty string rejected", () => {
  assert.equal(isValidIdempotencyKey(""), false);
  assert.equal(isValidIdempotencyKey("   "), false);
});

test("isValidIdempotencyKey: special characters rejected", () => {
  assert.equal(isValidIdempotencyKey("contains spaces here ok!"), false);
  assert.equal(isValidIdempotencyKey("includes/slash/path16ch"), false);
  assert.equal(isValidIdempotencyKey("includes.dot.token16"), false);
});

test("isValidIdempotencyKey: non-string inputs rejected", () => {
  assert.equal(isValidIdempotencyKey(null), false);
  assert.equal(isValidIdempotencyKey(undefined), false);
  assert.equal(isValidIdempotencyKey(123456789012345), false);
  assert.equal(isValidIdempotencyKey({ key: "value" }), false);
  assert.equal(isValidIdempotencyKey(["a", "b"]), false);
});

test("parseIdempotencyKey: header preferred over body when both valid", () => {
  const result = parseIdempotencyKey({
    header: "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b",
    body: "different_valid_token_16",
  });
  assert.equal(result, "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b");
});

test("parseIdempotencyKey: body used when header missing", () => {
  const result = parseIdempotencyKey({
    body: "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b",
  });
  assert.equal(result, "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b");
});

test("parseIdempotencyKey: invalid header falls through to body", () => {
  const result = parseIdempotencyKey({
    header: "too-short",
    body: "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b",
  });
  assert.equal(result, "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b");
});

test("parseIdempotencyKey: returns null when both missing", () => {
  assert.equal(parseIdempotencyKey({}), null);
  assert.equal(parseIdempotencyKey({ header: undefined, body: null }), null);
});

test("parseIdempotencyKey: returns null when both invalid", () => {
  assert.equal(
    parseIdempotencyKey({ header: "short", body: "also bad chars!" }),
    null,
  );
});

test("parseIdempotencyKey: header array form (Node's req.headers shape) uses first element", () => {
  const result = parseIdempotencyKey({
    header: ["8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b", "ignored"],
  });
  assert.equal(result, "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b");
});

test("parseIdempotencyKey: trims whitespace on the returned value", () => {
  const result = parseIdempotencyKey({
    header: "  8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b  ",
  });
  assert.equal(result, "8e7b3f1a-5d2c-4f9e-b1a8-3c6d7e8f9a0b");
});
