/**
 * 24h house P&L vs drain-breaker trip threshold (read-only).
 *
 *   npm run amm:drain-headroom
 */
import { fetchDrainBreakerSnapshot } from "../server/agents/drainBreaker.ts";

const d = await fetchDrainBreakerSnapshot();

console.log("\n=== Drain breaker headroom ===\n");
console.log(`House balance:     ${Math.round(d.houseBalance).toLocaleString()} credits`);
console.log(
  `24h house P&L:     ${d.houseDelta24h >= 0 ? "+" : ""}${Math.round(d.houseDelta24h).toLocaleString()} credits`,
);
console.log(
  `Absolute cap:      ${Math.round(d.thresholds.absoluteLossCapCredits).toLocaleString()} credits`,
);
console.log(
  `Pct cap:           ${(d.thresholds.pctLossCap * 100).toFixed(0)}% of balance → ${Math.round(Math.max(0, d.houseBalance * d.thresholds.pctLossCap)).toLocaleString()} credits`,
);
console.log(
  `Effective threshold: ${Math.round(d.thresholdApplied).toLocaleString()} credits (24h loss before trip)`,
);
if (d.houseDelta24h < 0) {
  console.log(
    `Loss headroom:     ${Math.round(d.lossHeadroom).toLocaleString()} credits ${d.lossHeadroom <= 0 ? "(AT/ OVER TRIP)" : "(remaining)"}`,
  );
} else {
  console.log("Loss headroom:     n/a (house gained credits in 24h)");
}
console.log(`Agents paused:     ${d.agentsPaused ? `YES — ${d.pauseReason ?? ""}` : "no"}`);
console.log(`Would trip now:    ${d.wouldTrip ? "yes" : "no"}`);
console.log(
  "\nTune via DRAIN_BREAKER_LOSS_CAP_CREDITS and DRAIN_BREAKER_LOSS_CAP_PCT on Railway.",
);
console.log("");

process.exit(d.wouldTrip ? 1 : 0);
