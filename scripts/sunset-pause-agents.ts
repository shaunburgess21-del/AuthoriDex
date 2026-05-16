/**
 * Parimutuel sunset, Phase 1.1: pause every agent worker.
 *
 * Flips the agent_runtime_state singleton so every worker (`agentRunner`,
 * `actionWorker`, `voteWorker`, `commentWorker`, `commentVoteWorker`)
 * exits early at the top of its next tick. Propagation TTL is ~10 seconds
 * per the `runtime-state` cache.
 *
 * Use BEFORE running the void / wipe / reset scripts so agent activity
 * doesn't race the data ops.
 *
 * Run with:
 *   npx tsx scripts/sunset-pause-agents.ts [reason]
 *
 * Example:
 *   npx tsx scripts/sunset-pause-agents.ts "Parimutuel sunset Phase 1"
 */

import { setAgentsPaused, getAgentRuntimeState } from "../server/agents/runtime-state";

async function main(): Promise<void> {
  const reason = process.argv.slice(2).join(" ").trim() || "Parimutuel sunset Phase 1";

  console.log(`\n[sunset:pause] Pausing all agent workers...`);
  console.log(`  reason: ${reason}`);

  await setAgentsPaused({
    paused: true,
    reason,
    actorId: "sunset-script",
  });

  const state = await getAgentRuntimeState();
  console.log(`\n[sunset:pause] Done. Current state:`);
  console.log(`  paused      ${state.paused}`);
  console.log(`  reason      ${state.reason}`);
  console.log(`  pausedAt    ${state.pausedAt?.toISOString() ?? "(none)"}`);
  console.log(`  pausedBy    ${state.pausedBy ?? "(none)"}`);
  console.log(`  updatedAt   ${state.updatedAt.toISOString()}`);
  console.log(`\nWorkers will halt within ~10s (runtime-state cache TTL).`);
  console.log(`Resume with: npx tsx scripts/sunset-resume-agents.ts\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("\n[sunset:pause] FAILED:", err);
  process.exit(1);
});
