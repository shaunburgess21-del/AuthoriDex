/**
 * AMM operational health-check — CLI wrapper.
 *
 * Thin pretty-printer over `runAmmHealthCheck` in server/jobs/amm-health.ts.
 * Designed to be cron-able: prints a one-line pass/fail summary plus
 * per-category details and exits non-zero on any failed check (warnings
 * do NOT trip the exit code, by design — operators should still review).
 *
 * The same audit logic is also exposed as POST /api/cron/amm-health-check
 * for Railway-cron / external schedulers (see ops/AMM_MONITORING_RUNBOOK.md).
 *
 * Run with:
 *   npm run amm:health
 *   npx tsx scripts/amm-health-check.ts [--days 30]
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Auto-load `.env` so plain `tsx scripts/amm-health-check.ts` works
// without remembering `--env-file=.env`. Must happen BEFORE the db /
// schema imports below because `../server/db` throws at import time
// if `DATABASE_URL` is missing. The dynamic-import + top-level-await
// pattern is required to defer those imports until after the loader
// has populated `process.env` — static ESM imports get hoisted above
// any code in the module body, so a plain `import { runAmmHealthCheck }`
// here would fire before this loader ran.
//
// In Railway / cron environments DATABASE_URL is already set via the
// host, so the .env file may not exist — the existsSync guard keeps
// that path silent.
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const { runAmmHealthCheck } = await import("../server/jobs/amm-health");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

const RESOLUTION_LOOKBACK_DAYS = Number(parseArg("--days") ?? "30");

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function main(): Promise<void> {
  console.log(bold("\nAMM operational health check"));
  console.log(dim(`lookback=${RESOLUTION_LOOKBACK_DAYS}d  startedAt=${new Date().toISOString()}\n`));
  console.log(cyan(bold("--- Read-only audits ---\n")));

  const result = await runAmmHealthCheck({ lookbackDays: RESOLUTION_LOOKBACK_DAYS });

  for (const r of result.checks) {
    const tag =
      r.status === "pass" ? green("PASS") : r.status === "warn" ? yellow("WARN") : red("FAIL");
    const head = `[${tag}] ${bold(r.name)}${r.rowCount !== undefined ? dim(` (${r.rowCount} row${r.rowCount === 1 ? "" : "s"})`) : ""}`;
    console.log(head);
    for (const line of r.details.split("\n")) {
      if (line.trim()) console.log(`    ${line}`);
    }
    if (r.sample && r.sample.length > 0) {
      for (const s of r.sample.slice(0, 3)) {
        console.log(`    ${dim(JSON.stringify(s))}`);
      }
      if (r.sample.length > 3) console.log(`    ${dim(`... ${r.sample.length - 3} more not shown`)}`);
    }
    console.log("");
  }

  console.log(bold("--- Summary ---"));
  console.log(
    `Total checks: ${result.total}  ${green(`PASS=${result.passed}`)}  ${yellow(`WARN=${result.warned}`)}  ${red(`FAIL=${result.failed}`)}  ${dim(`(${result.durationMs}ms)`)}`,
  );

  if (result.failed > 0) {
    console.log(red(bold("\n✗ Health check FAILED. Investigate failed checks above.")));
    process.exit(1);
  }
  if (result.warned > 0) {
    console.log(yellow(bold("\n! Health check passed with warnings. Review above before next deploy.")));
    return;
  }
  console.log(green(bold("\n✓ Health check passed cleanly. AMM stack is healthy.")));
}

// Explicitly exit after main resolves. server/db's pg.Pool holds the
// event loop open for `idleTimeoutMillis` (30s) after the last query,
// so a cron-able script would otherwise hang for ~30s on every run.
// We preserve any exitCode that was set during the run (e.g. via the
// warning path returning early without an exit code).
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(red(`\n[amm-health-check] FAILED: ${err?.message ?? err}`));
    if (err?.stack) console.error(dim(err.stack));
    process.exit(1);
  });
