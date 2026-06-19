import test from "node:test";
import assert from "node:assert/strict";
import {
  getMostRecentInductionClose,
  selectInductionWinner,
  voteTotalAtClose,
} from "../server/utils/induction-cycle";

test("getMostRecentInductionClose returns the previous Sunday before this week's close", () => {
  const close = getMostRecentInductionClose(new Date("2026-04-27T16:00:00.000Z"));
  assert.equal(close.toISOString(), "2026-04-26T23:59:59.999Z");
});

test("getMostRecentInductionClose returns the current Sunday after close", () => {
  const close = getMostRecentInductionClose(new Date("2026-05-03T23:59:59.999Z"));
  assert.equal(close.toISOString(), "2026-04-26T23:59:59.999Z");

  const afterClose = getMostRecentInductionClose(new Date("2026-05-04T00:00:00.000Z"));
  assert.equal(afterClose.toISOString(), "2026-05-03T23:59:59.999Z");
});

test("voteTotalAtClose subtracts the weighted total of votes made after the weekly close", () => {
  assert.equal(voteTotalAtClose({ id: "a", displayName: "Alice", weightedScore: 12, postCloseWeight: 3 }), 9);
  assert.equal(voteTotalAtClose({ id: "b", displayName: "Bob", weightedScore: 2, postCloseWeight: 4 }), 0);
  // Fractional weights from higher-tier casters carry through.
  assert.equal(voteTotalAtClose({ id: "c", displayName: "Cara", weightedScore: 5.5, postCloseWeight: 1.0 }), 4.5);
});

test("selectInductionWinner ranks by weighted vote total at close", () => {
  const winner = selectInductionWinner([
    { id: "a", displayName: "Adam Alpha", weightedScore: 10, postCloseWeight: 4 },
    { id: "b", displayName: "Zack Beta", weightedScore: 8, postCloseWeight: 0 },
  ]);

  assert.equal(winner?.id, "b");
  assert.equal(winner?.voteTotalAtClose, 8);
});

test("selectInductionWinner can flip on weight: fewer high-weight votes beat more flat votes", () => {
  // Candidate A: raw display would tie, but B's weighted score is higher.
  const winner = selectInductionWinner([
    { id: "a", displayName: "Adam Alpha", weightedScore: 5, postCloseWeight: 0 },
    { id: "b", displayName: "Zack Beta", weightedScore: 6.4, postCloseWeight: 0 },
  ]);

  assert.equal(winner?.id, "b");
  assert.equal(winner?.voteTotalAtClose, 6.4);
});

test("selectInductionWinner tie-breaks by first name alphabetically", () => {
  const winner = selectInductionWinner([
    { id: "z", displayName: "Zack Famous", weightedScore: 10, postCloseWeight: 0 },
    { id: "a", displayName: "Adam Famous", weightedScore: 10, postCloseWeight: 0 },
  ]);

  assert.equal(winner?.id, "a");
});
