import test from "node:test";
import assert from "node:assert/strict";

import { deriveJackpotPanelState } from "../client/src/lib/jackpot-panel-state";

const FRIDAY = "2026-11-20T23:59:59.999Z";
const SUNDAY = "2026-11-22T23:59:59.999Z";

test("jackpot panel stays open before the entry cutoff", () => {
  const state = deriveJackpotPanelState({
    status: "OPEN",
    lifecycleStatus: "OPEN",
    isCutoffPassed: false,
    bettingCutoff: FRIDAY,
    resolveAt: SUNDAY,
    now: new Date("2026-11-18T15:00:00.000Z"),
  });
  assert.equal(state.phase, "open");
  assert.equal(state.stripStatus, "OPEN");
  assert.equal(state.countdownTo?.toISOString(), new Date(FRIDAY).toISOString());
});

test("stale OPEN status does not keep entries open after the cutoff", () => {
  const state = deriveJackpotPanelState({
    status: "OPEN",
    lifecycleStatus: "ENTRIES_CLOSED",
    isCutoffPassed: true,
    bettingCutoff: FRIDAY,
    resolveAt: SUNDAY,
    now: new Date("2026-11-22T09:00:00.000Z"),
  });
  assert.equal(state.phase, "closed");
  assert.equal(state.stripStatus, "ENTRIES_CLOSED");
  assert.equal(state.countdownTo?.toISOString(), new Date(SUNDAY).toISOString());
});

test("cutoff date closes the panel even when lifecycle still says OPEN", () => {
  const state = deriveJackpotPanelState({
    status: "OPEN",
    lifecycleStatus: "OPEN",
    isCutoffPassed: false,
    bettingCutoff: FRIDAY,
    resolveAt: SUNDAY,
    now: new Date("2026-11-21T12:00:00.000Z"),
  });
  assert.equal(state.phase, "closed");
  assert.equal(state.stripStatus, "ENTRIES_CLOSED");
});

test("isCutoffPassed closes entries even if the cutoff timestamp is still ahead", () => {
  const state = deriveJackpotPanelState({
    status: "OPEN",
    isCutoffPassed: true,
    bettingCutoff: FRIDAY,
    resolveAt: SUNDAY,
    now: new Date("2026-11-18T15:00:00.000Z"),
  });
  assert.equal(state.phase, "closed");
});

test("resolution settles the panel even while the row status is still OPEN", () => {
  const state = deriveJackpotPanelState({
    status: "OPEN",
    lifecycleStatus: "OPEN",
    bettingCutoff: FRIDAY,
    resolveAt: SUNDAY,
    now: new Date("2026-11-23T01:00:00.000Z"),
  });
  assert.equal(state.phase, "settled");
  assert.equal(state.stripStatus, "RESOLVED");
  assert.equal(state.countdownTo, null);
});

test("RESOLVED and VOID statuses settle the panel before the clock", () => {
  const early = new Date("2026-11-18T15:00:00.000Z");
  for (const status of ["RESOLVED", "VOID"]) {
    const state = deriveJackpotPanelState({
      status,
      bettingCutoff: FRIDAY,
      resolveAt: SUNDAY,
      now: early,
    });
    assert.equal(state.phase, "settled", status);
  }
});
