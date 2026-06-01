/**
 * Up/Down AMM calibration curve — priced UP vs actual UP win rate.
 *
 *   npx tsx scripts/market-calibration.ts [--days 30]
 */
/** Run: npx tsx --env-file=.env scripts/market-calibration.ts */
import {
  fetchUpDownCalibration,
  fetchH2HCalibration,
  fetchGainerCalibration,
} from "../server/agents/marketCalibration.ts";

const daysArg = process.argv.find((a) => a.startsWith("--days"));
const lookbackDays = daysArg
  ? Math.max(1, parseInt(daysArg.split("=")[1] ?? process.argv[process.argv.indexOf(daysArg) + 1] ?? "30", 10))
  : 30;

const result = await fetchUpDownCalibration(lookbackDays);
const h2h = await fetchH2HCalibration(lookbackDays);
const gainer = await fetchGainerCalibration(lookbackDays);

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

console.log(`\nH2H winner final price (last ${lookbackDays}d, ${h2h.winnersTotal} winners)\n`);
if (h2h.avgWinnerFinalPrice != null) {
  console.log(`Avg winner final AMM price: ${h2h.avgWinnerFinalPrice.toFixed(3)}`);
  console.log(
    `Winners priced ≤ 0.55 at close: ${h2h.winnersPricedAtOrBelow55}/${h2h.winnersTotal} (pre-fix baseline ~53%)`,
  );
  console.log("(Target after LOCKIN_FAIR_H2H: avg winner price > 0.70 on clear favorites)\n");
}

console.log(`\nGainer winner final price (last ${lookbackDays}d, ${gainer.winnersTotal} winners)\n`);
if (gainer.avgWinnerFinalPrice != null) {
  console.log(`Avg winner final AMM price: ${gainer.avgWinnerFinalPrice.toFixed(3)}`);
  console.log(
    `Winners priced ≤ 0.15 at close: ${gainer.winnersPricedAtOrBelow15}/${gainer.winnersTotal} (pre-fix baseline ~0.124)`,
  );
  console.log("(Target after LOCKIN_FAIR_GAINER: avg winner price well above 1/N baseline)\n");
}

const badUpdown =
  result.avgGapOnDecided != null && result.avgGapOnDecided > 0.15;
const badH2h =
  h2h.avgWinnerFinalPrice != null && h2h.avgWinnerFinalPrice < 0.55;
const badGainer =
  gainer.avgWinnerFinalPrice != null && gainer.avgWinnerFinalPrice < 0.15;

process.exit(badUpdown || badH2h || badGainer ? 1 : 0);
