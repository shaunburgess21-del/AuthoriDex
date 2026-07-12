import test from "node:test";
import assert from "node:assert/strict";

import {
  computeLockCloseAt,
  computeResyncedTimes,
  shouldApplyResync,
  DEFAULT_RESYNC_THRESHOLD_MS,
} from "../server/jobs/market-time-sync-utils";

const COOLDOWN_MS = 5 * 60 * 1000;
const NOW = new Date("2026-07-12T12:00:00.000Z");

test("computeLockCloseAt locks when closeAt is null", () => {
  const locked = computeLockCloseAt(null, NOW);
  assert.ok(locked);
  assert.equal(locked!.toISOString(), NOW.toISOString());
});

test("computeLockCloseAt locks when closeAt is still in the future", () => {
  const future = new Date("2026-07-12T18:00:00.000Z");
  const locked = computeLockCloseAt(future, NOW);
  assert.ok(locked);
  assert.equal(locked!.toISOString(), NOW.toISOString());
});

test("computeLockCloseAt is idempotent when already past cutoff", () => {
  const past = new Date("2026-07-12T11:00:00.000Z");
  assert.equal(computeLockCloseAt(past, NOW), null);
});

test("computeResyncedTimes: closeAt = endAt − cooldown when no kickoff", () => {
  const end = "2026-07-13T00:00:00.000Z";
  const out = computeResyncedTimes({
    sourceEndDate: end,
    sourceGameStartTime: null,
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out!.endAt.toISOString(), end);
  assert.equal(
    out!.closeAt.toISOString(),
    new Date(Date.parse(end) - COOLDOWN_MS).toISOString(),
  );
});

test("computeResyncedTimes: kickoff wins when earlier than default cutoff", () => {
  const end = "2026-07-13T00:00:00.000Z";
  const kickoff = "2026-07-12T20:00:00.000Z";
  const out = computeResyncedTimes({
    sourceEndDate: end,
    sourceGameStartTime: kickoff,
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out!.closeAt.toISOString(), kickoff);
});

test("computeResyncedTimes: ignores kickoff already in the past", () => {
  const end = "2026-07-13T00:00:00.000Z";
  const pastKickoff = "2026-07-12T10:00:00.000Z";
  const out = computeResyncedTimes({
    sourceEndDate: end,
    sourceGameStartTime: pastKickoff,
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(
    out!.closeAt.toISOString(),
    new Date(Date.parse(end) - COOLDOWN_MS).toISOString(),
  );
});

test("computeResyncedTimes: returns null when source end is in the past", () => {
  const out = computeResyncedTimes({
    sourceEndDate: "2026-07-12T11:00:00.000Z",
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.equal(out, null);
});

test("computeResyncedTimes: returns null on invalid end date", () => {
  const out = computeResyncedTimes({
    sourceEndDate: "not-a-date",
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.equal(out, null);
});

test("shouldApplyResync: applies when source moved past threshold and we own times", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const source = "2026-07-14T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: ignores tiny drift under threshold", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const source = new Date(
    Date.parse(synced) + DEFAULT_RESYNC_THRESHOLD_MS / 2,
  ).toISOString();
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: backs off when admin manually edited endAt", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const adminEdited = "2026-07-15T12:00:00.000Z";
  const source = "2026-07-14T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(adminEdited),
    syncedEndDate: synced,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: legacy baseline adopt when current matches source", () => {
  const source = "2026-07-13T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(source),
    syncedEndDate: null,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: true });
});

test("shouldApplyResync: legacy skip when current diverges from source (manual edit unknown)", () => {
  const out = shouldApplyResync({
    currentEndAt: new Date("2026-07-15T12:00:00.000Z"),
    syncedEndDate: null,
    sourceEndDate: "2026-07-13T00:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: applies when kickoff moves even if endDate unchanged", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: synced,
    syncedGameStartTime: "2026-07-12T18:00:00.000Z",
    sourceGameStartTime: "2026-07-12T21:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: ignores tiny kickoff drift under threshold", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const kick = "2026-07-12T18:00:00.000Z";
  const slight = new Date(
    Date.parse(kick) + DEFAULT_RESYNC_THRESHOLD_MS / 2,
  ).toISOString();
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: synced,
    syncedGameStartTime: kick,
    sourceGameStartTime: slight,
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: kickoff appearing for the first time counts as a move", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: synced,
    syncedGameStartTime: null,
    sourceGameStartTime: "2026-07-12T18:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: rejects past source end", () => {
  const out = shouldApplyResync({
    currentEndAt: new Date("2026-07-12T10:00:00.000Z"),
    syncedEndDate: "2026-07-12T10:00:00.000Z",
    sourceEndDate: "2026-07-12T11:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});
