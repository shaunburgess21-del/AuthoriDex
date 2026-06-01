/**
 * Live native convergence — up/down + H2H fair vs price (open markets).
 *
 *   npm run amm:convergence
 *   npm run amm:convergence -- --top 25
 *   npm run amm:convergence -- --json
 */
import {
  fetchLiveUpDownConvergence,
  fetchLiveH2HConvergence,
} from "../server/agents/liveConvergence.ts";
import { fetchDrainBreakerSnapshot } from "../server/agents/drainBreaker.ts";

const topArg = process.argv.find((a) => a.startsWith("--top"));
const topN = topArg
  ? Math.max(
      1,
      parseInt(
        topArg.includes("=")
          ? topArg.split("=")[1]
          : process.argv[process.argv.indexOf(topArg) + 1] ?? "20",
        10,
      ),
    )
  : 20;
const jsonOut = process.argv.includes("--json");
const skipDrain = process.argv.includes("--no-drain");

const updown = await fetchLiveUpDownConvergence();
const h2h = await fetchLiveH2HConvergence();

if (jsonOut) {
  const drain = skipDrain ? null : await fetchDrainBreakerSnapshot();
  console.log(JSON.stringify({ updown, h2h, drainBreaker: drain }, null, 2));
  process.exit(0);
}

function printSummary(
  label: string,
  summary: typeof updown.summary,
  sampledAt: string,
  targetFlag: string,
) {
  console.log(`\n=== ${label} (${sampledAt}) ===\n`);
  console.log(`Open markets: ${summary.openMarkets}`);
  console.log(`With fair: ${summary.withFair}`);
  console.log(
    `Decided: ${summary.decidedCount} — mispriced (|fair−price| > 10pp): ${summary.decidedMispricedCount}` +
      (summary.decidedMispricedPct != null
        ? ` (${(summary.decidedMispricedPct * 100).toFixed(0)}%)`
        : ""),
  );
  if (summary.avgAbsGapOnDecided != null) {
    console.log(
      `Avg |gap| on decided: ${summary.avgAbsGapOnDecided.toFixed(3)}` +
        (summary.avgGapOnDecided != null
          ? ` (signed ${summary.avgGapOnDecided >= 0 ? "+" : ""}${summary.avgGapOnDecided.toFixed(3)})`
          : ""),
    );
  }
  console.log(
    `Arb-eligible (gap > 4pp): ${summary.arbEligibleCount} | rough gap×volume: ${Math.round(summary.roughUnderpricingExposure)}`,
  );
  console.log(`\nTarget after ${targetFlag}: mispriced % down; avg |gap| < 0.08 on decided.`);
}

printSummary(
  "Live Up/Down convergence",
  updown.summary,
  updown.sampledAt,
  "LOCKIN_FAIR_ENABLED",
);
printSummary(
  "Live H2H convergence",
  h2h.summary,
  h2h.sampledAt,
  "LOCKIN_FAIR_H2H_ENABLED",
);

console.log(`\nTop ${topN} Up/Down by |fair − price|:\n`);
console.log("Market\tSide\tPrice\tFair\tGap\tpctOpen\tHrs\tVol");
for (const m of updown.markets.slice(0, topN)) {
  const id = m.marketId.slice(0, 8);
  const title = (m.title ?? "?").slice(0, 28).replace(/\t/g, " ");
  const pct =
    m.pctChangeVsOpen != null
      ? `${(m.pctChangeVsOpen * 100).toFixed(1)}%`
      : "n/a";
  console.log(
    `${title} (${id})\t${m.favoredSide ?? "?"}\t${(m.favoredPrice ?? 0).toFixed(3)}\t${(m.favoredFair ?? 0).toFixed(3)}\t${(m.gap ?? 0) >= 0 ? "+" : ""}${(m.gap ?? 0).toFixed(3)}\t${pct}\t${m.hoursRemaining.toFixed(0)}\t${Math.round(m.volume)}`,
  );
}

console.log(`\nTop ${topN} H2H by |fair − price|:\n`);
console.log("Market\tFavored\tPrice\tFair\tGap\tScoreRatio\tHrs\tVol");
for (const m of h2h.markets.slice(0, topN)) {
  const id = m.marketId.slice(0, 8);
  const title = (m.title ?? "?").slice(0, 24).replace(/\t/g, " ");
  const ratio =
    m.scoreRatio != null ? m.scoreRatio.toFixed(3) : "n/a";
  console.log(
    `${title} (${id})\t${(m.favoredLabel ?? "?").slice(0, 16)}\t${(m.favoredPrice ?? 0).toFixed(3)}\t${(m.favoredFair ?? 0).toFixed(3)}\t${(m.gap ?? 0) >= 0 ? "+" : ""}${(m.gap ?? 0).toFixed(3)}\t${ratio}\t${m.hoursRemaining.toFixed(0)}\t${Math.round(m.volume)}`,
  );
}

if (!skipDrain) {
  const drain = await fetchDrainBreakerSnapshot();
  console.log("\n--- Drain breaker headroom (24h) ---\n");
  console.log(`House balance: ${Math.round(drain.houseBalance).toLocaleString()} credits`);
  console.log(
    `24h house P&L: ${drain.houseDelta24h >= 0 ? "+" : ""}${Math.round(drain.houseDelta24h).toLocaleString()} credits`,
  );
  console.log(
    `Trip threshold: ${Math.round(drain.thresholdApplied).toLocaleString()} (min of abs ${drain.thresholds.absoluteLossCapCredits.toLocaleString()} and ${(drain.thresholds.pctLossCap * 100).toFixed(0)}% of balance)`,
  );
  if (drain.houseDelta24h < 0) {
    const headroom = drain.lossHeadroom;
    console.log(
      `Loss headroom before trip: ${Math.round(headroom).toLocaleString()} credits (${headroom > 0 ? "OK" : "WOULD TRIP"})`,
    );
  } else {
    console.log("No 24h loss — breaker would not trip on P&L alone.");
  }
  if (drain.agentsPaused) {
    console.log(`WARNING: agents currently PAUSED (${drain.pauseReason ?? "unknown"})`);
  }
}

const badUpdown =
  updown.summary.decidedMispricedPct != null &&
  updown.summary.decidedMispricedPct > 0.5 &&
  (updown.summary.avgAbsGapOnDecided ?? 0) > 0.15;
const badH2h =
  h2h.summary.decidedMispricedPct != null &&
  h2h.summary.decidedMispricedPct > 0.5 &&
  (h2h.summary.avgAbsGapOnDecided ?? 0) > 0.15;

console.log("");
process.exit(badUpdown || badH2h ? 1 : 0);
