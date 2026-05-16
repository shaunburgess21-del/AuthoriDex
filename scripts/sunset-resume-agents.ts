/**
 * Parimutuel sunset, Phase 1.6: lift the kill switch and resume every
 * agent worker.
 *
 * Mirror of scripts/sunset-pause-agents.ts. Workers see the new state
 * within ~10s of the next tick (runtime-state cache TTL).
 *
 * Run with:
 *   npx tsx scripts/sunset-resume-agents.ts
 *
 * Run AFTER:
 *   1. sunset-pause-agents.ts
 *   2. sunset-void-inflight.ts
 *   3. sunset-wipe-parimutuel.ts
 *   4. sunset-reset-credits.ts
 *   5. Phase 1.5 deploy is live (creation gates active)
 */

import { setAgentsPaused, getAgentRuntimeState } from "../server/agents/runtime-state";

async function main(): Promise<void> {
  console.log(`\n[sunset:resume] Lifting agent kill switch...`);

  await setAgentsPaused({
    paused: false,
    reason: null,
    actorId: "sunset-script",
  });

  const state = await getAgentRuntimeState();
  console.log(`\n[sunset:resume] Done. Current state:`);
  console.log(`  paused      ${state.paused}`);
  console.log(`  reason      ${state.reason ?? "(none)"}`);
  console.log(`  pausedAt    ${state.pausedAt?.toISOString() ?? "(none)"}`);
  console.log(`  pausedBy    ${state.pausedBy ?? "(none)"}`);
  console.log(`  updatedAt   ${state.updatedAt.toISOString()}`);
  console.log(`\nWorkers will pick up new agent_runtime_state within ~10s.\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("\n[sunset:resume] FAILED:", err);
  process.exit(1);
});
