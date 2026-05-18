import test from "node:test";
import assert from "node:assert/strict";

import {
  DELETION_WINDOW_MS,
  isOverdue,
} from "../server/services/account-deletion-utils";

// Pure-helper tests for the account-deletion sweeper predicate.
// The live DB-reading shell mirrors this predicate in its WHERE
// clause (`scheduled_for <= NOW() AND deleted_at IS NULL`); pinning
// the decision logic here keeps the live SQL honest without needing
// test DB scaffolding.

test("DELETION_WINDOW_MS equals 7 days", () => {
  assert.equal(DELETION_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
});

test("isOverdue: null scheduledFor → false (no deletion pending)", () => {
  const result = isOverdue({
    now: new Date("2026-05-18T12:00:00Z"),
    scheduledFor: null,
    deletedAt: null,
  });
  assert.equal(result, false);
});

test("isOverdue: future scheduledFor → false (still in the window)", () => {
  const result = isOverdue({
    now: new Date("2026-05-18T12:00:00Z"),
    scheduledFor: new Date("2026-05-25T12:00:00Z"),
    deletedAt: null,
  });
  assert.equal(result, false);
});

test("isOverdue: past scheduledFor → true (window elapsed)", () => {
  const result = isOverdue({
    now: new Date("2026-05-25T12:00:01Z"),
    scheduledFor: new Date("2026-05-25T12:00:00Z"),
    deletedAt: null,
  });
  assert.equal(result, true);
});

test("isOverdue: exactly-at scheduledFor → true (>= is inclusive)", () => {
  const t = new Date("2026-05-25T12:00:00Z");
  const result = isOverdue({
    now: t,
    scheduledFor: t,
    deletedAt: null,
  });
  assert.equal(result, true);
});

test("isOverdue: deletedAt already set → false (skip already-finalised rows)", () => {
  const result = isOverdue({
    now: new Date("2026-05-25T12:00:00Z"),
    scheduledFor: new Date("2026-05-25T12:00:00Z"),
    deletedAt: new Date("2026-05-25T12:00:00Z"),
  });
  assert.equal(result, false);
});

test("isOverdue: scheduledFor in the future + deletedAt set → false (defensive: never finalise twice)", () => {
  const result = isOverdue({
    now: new Date("2026-05-25T12:00:00Z"),
    scheduledFor: new Date("2026-06-25T12:00:00Z"),
    deletedAt: new Date("2026-05-25T12:00:00Z"),
  });
  assert.equal(result, false);
});

test("isOverdue: a typical 7-day request matures correctly", () => {
  const requestedAt = new Date("2026-05-18T12:00:00Z");
  const scheduledFor = new Date(requestedAt.getTime() + DELETION_WINDOW_MS);
  // One minute before the window closes → not overdue.
  const notYet = isOverdue({
    now: new Date(scheduledFor.getTime() - 60_000),
    scheduledFor,
    deletedAt: null,
  });
  assert.equal(notYet, false);
  // One minute after the window closes → overdue.
  const now = isOverdue({
    now: new Date(scheduledFor.getTime() + 60_000),
    scheduledFor,
    deletedAt: null,
  });
  assert.equal(now, true);
});
