/**
 * Up/Down AMM calibration curve — priced UP vs actual UP win rate.
 *
 *   npx tsx scripts/market-calibration.ts [--days 30]
 */
/** Run: npx tsx --env-file=.env scripts/market-calibration.ts */
import { fetchUpDownCalibration } from "../server/agents/marketCalibration.ts";

const daysArg = process.argv.find((a) => a.startsWith("--days"));
const lookbackDays = daysArg
  ? Math.max(1, parseInt(daysArg.split("=")[1] ?? process.argv[process.argv.indexOf(daysArg) + 1] ?? "30", 10))
  : 30;

const result = await fetchUpDownCalibration(lookbackDays);

console.log(`\nUp/Down calibration (last ${lookbackDays}d, ${result.totalResolved} resolved)\n`);
console.log("Bin\tN\tAvg price UP\tActual UP win\tGap");
for (const b of result.buckets) {
  const label =
    b.bin <= 1
      ? "<10%"
      : b.bin === 10
        ? ">90%"
        : `${(b.bin - 1) * 10}-${b.bin * 10}%`;
  console.log(
    `${label}\t${b.n}\t${b.avgPriceUp.toFixed(3)}\t\t${b.actualUpWinRate.toFixed(3)}\t\t${b.gap.toFixed(3)}`,
  );
}
if (result.avgGapOnDecided != null) {
  console.log(`\nAvg |actual - price| on decided buckets (price ≤45% or ≥55%): ${result.avgGapOnDecided.toFixed(3)}`);
  console.log("(Target after lock-in fix: < 0.05; pre-fix baseline was ~0.30+)\n");
}

process.exit(result.avgGapOnDecided != null && result.avgGapOnDecided > 0.15 ? 1 : 0);
