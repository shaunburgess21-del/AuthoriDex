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

test("voteTotalAtClose subtracts votes made after the weekly close", () => {
  assert.equal(voteTotalAtClose({ id: "a", displayName: "Alice", seedVotes: 12, postCloseVotes: 3 }), 9);
  assert.equal(voteTotalAtClose({ id: "b", displayName: "Bob", seedVotes: 2, postCloseVotes: 4 }), 0);
});

test("selectInductionWinner ranks by vote total at close", () => {
  const winner = selectInductionWinner([
    { id: "a", displayName: "Adam Alpha", seedVotes: 10, postCloseVotes: 4 },
    { id: "b", displayName: "Zack Beta", seedVotes: 8, postCloseVotes: 0 },
  ]);

  assert.equal(winner?.id, "b");
  assert.equal(winner?.voteTotalAtClose, 8);
});

test("selectInductionWinner tie-breaks by first name alphabetically", () => {
  const winner = selectInductionWinner([
    { id: "z", displayName: "Zack Famous", seedVotes: 10, postCloseVotes: 0 },
    { id: "a", displayName: "Adam Famous", seedVotes: 10, postCloseVotes: 0 },
  ]);

  assert.equal(winner?.id, "a");
});
