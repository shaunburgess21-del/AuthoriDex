/**
 * Preview today's World Markets daily digest without sending it.
 *
 * Forces EMAIL_DRY_RUN so sendEmail logs instead of dispatching, which makes
 * this safe to run repeatedly while tuning digest copy.
 *
 * Run: npx tsx --env-file=.env ops/preview-market-ops-digest.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// Must be set before the email modules read it.
process.env.EMAIL_DRY_RUN = "true";
// The digest runs the resolution scout inline; keep it off so a preview
// never spends LLM budget.
process.env.RESOLUTION_SCOUT_LLM_ENABLED = "false";

async function main(): Promise<void> {
  const { pool } = await import("../server/db");
  const { runMarketOpsDigest } = await import("../server/jobs/market-ops-digest");

  const result = await runMarketOpsDigest();

  console.log("\n[preview-market-ops-digest] counts:");
  console.log(`  needsResolution      ${result.needsResolution}`);
  console.log(`  stuck                ${result.stuck}`);
  console.log(`  closingSoon          ${result.closingSoon}`);
  console.log(`  scoutFindings        ${result.scoutFindings}`);
  console.log(`  draftsAwaitingReview ${result.draftsAwaitingReview}`);
  console.log(`  draftsReady          ${result.draftsReady}`);
  console.log(`  draftsExpiringSoon   ${result.draftsExpiringSoon}`);
  console.log(
    `  alert delivered=${result.alert.delivered} skipped=${result.alert.skipped} failed=${result.alert.failed}`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("[preview-market-ops-digest] failed:", err);
  process.exit(1);
});
