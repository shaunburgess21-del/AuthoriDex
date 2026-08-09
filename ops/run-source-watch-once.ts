/**
 * Trigger one source-resolution watch pass on demand.
 *
 * Same entry point the daily scheduler uses, so running it here exercises the
 * production path rather than a copy of it. Useful after changing watcher
 * behaviour, and to flush a backlog without waiting for the next tick.
 *
 * Run: npx tsx --env-file=.env ops/run-source-watch-once.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function main(): Promise<void> {
  const { pool } = await import("../server/db");
  const { runSourceResolutionWatch } = await import("../server/jobs/market-scout");

  console.log("\n[run-source-watch-once] starting…\n");
  const result = await runSourceResolutionWatch();

  console.log("\n[run-source-watch-once] result:");
  console.log(`  checked            ${result.checked}`);
  console.log(`  resolvedUpstream   ${result.resolvedUpstream}`);
  console.log(`  draftsRetired      ${result.draftsRetired}`);
  console.log(`  unmappable         ${result.unmappable}`);
  console.log(`  livePricesRefreshed ${result.livePricesRefreshed}`);
  console.log(`  timesResynced      ${result.timesResynced}`);
  console.log(`  autoLocked         ${result.autoLocked}`);
  console.log(`  errors             ${result.errors}`);
  if (result.findings.length) {
    console.log(`\n  findings (${result.findings.length}):`);
    for (const f of result.findings) {
      console.log(`    ${f.title} → ${f.proposedWinnerLabel}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[run-source-watch-once] failed:", err);
  process.exit(1);
});
