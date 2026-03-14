import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentActionStakeIdempotencyKey,
  buildAgentBetMetadata,
} from "../server/agents/actionWorker-utils";

test("buildAgentActionStakeIdempotencyKey is deterministic per action id", () => {
  assert.equal(buildAgentActionStakeIdempotencyKey("abc123"), "agent_stake_action_abc123");
});

test("buildAgentBetMetadata always includes actionId and optional rationale", () => {
  assert.deepEqual(buildAgentBetMetadata("action-1"), { actionId: "action-1" });
  assert.deepEqual(buildAgentBetMetadata("action-2", "momentum spike"), {
    actionId: "action-2",
    rationale: "momentum spike",
  });
});
