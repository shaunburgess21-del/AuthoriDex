/**
 * Post-deploy validation: calibration curve + guidance for tuning.
 *
 *   npx tsx scripts/validate-market-convergence.ts [--days 14]
 */
import "dotenv/config";
import { fetchUpDownCalibration } from "../server/agents/marketCalibration.ts";

const daysArg = process.argv.find((a) => a.startsWith("--days"));
const lookbackDays = daysArg
  ? Math.max(
      1,
      parseInt(
        daysArg.split("=")[1] ?? process.argv[process.argv.indexOf(daysArg) + 1] ?? "14",
        10,
      ),
    )
  : 14;

const cal = await fetchUpDownCalibration(lookbackDays);

console.log(`\n=== Market convergence validation (${lookbackDays}d) ===\n`);
console.log(`Resolved up/down markets: ${cal.totalResolved}`);
if (cal.avgGapOnDecided != null) {
  console.log(`Avg |actual − price| on decided buckets: ${cal.avgGapOnDecided.toFixed(3)}`);
  console.log("  Target after lock-in + arb: < 0.08 (warn 0.12, fail 0.20)");
} else {
  console.log("Insufficient data for gap metric.");
}

console.log("\nReliability buckets:");
for (const b of cal.buckets) {
  if (b.n < 5) continue;
  const label =
    b.bin <= 1
      ? "<10%"
      : b.bin === 10
        ? ">90%"
        : `${(b.bin - 1) * 10}-${b.bin * 10}%`;
  console.log(
    `  ${label.padEnd(8)} n=${String(b.n).padStart(4)}  price=${b.avgPriceUp.toFixed(3)}  actual=${b.actualUpWinRate.toFixed(3)}  gap=${b.gap.toFixed(3)}`,
  );
}

console.log("\nFor OPEN markets (mid-week), run: npm run amm:convergence");
console.log("\nTrack 3 defaults (Jul 2026) — already ON unless set to false:");
console.log("  LOCKIN_FAIR_ENABLED / LOCKIN_FAIR_H2H_ENABLED / LOCKIN_FAIR_GAINER_ENABLED");
console.log("  ARB_COHORT_ENABLED / MIDWEEK_CONVERGENCE_ENABLED / LATCH_REVERT_ENABLED");
console.log("Settlement close: NATIVE_CLOSE_MEDIAN_HOURS (default 6; set 1 for single-tick)");
console.log("Optional Monday: NATIVE_FRIDAY_CUTOFF_ENABLED (updown only)\n");
console.log("Friday cutoff scope: updown only (see docs/ops/convergence-rollout.md)\n");

const fail = cal.avgGapOnDecided != null && cal.avgGapOnDecided > 0.12;
process.exit(fail ? 1 : 0);
