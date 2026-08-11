/**
 * Read-only rehearsal of next Monday's Up/Down opening prices.
 *
 * Runs the real generation path — the same anchored field selection the
 * generator uses — against the live roster, loads each card's trailing-6h
 * median `velocityScore`, and prints what `pickUpDownOpeningPrices` would
 * seed each market at. Writes nothing.
 *
 * Two things this is for:
 *
 *   1. Seeing how concentrated the field is in the "hot" band before the
 *      prior goes live. Historically 161 of 180 cards (89%) opened at
 *      velocity >= 40, which is why the prior is one threshold rather than a
 *      graduated ladder — see `updown-opening-prices.ts`.
 *   2. Catching the failure mode that only shows up against live data:
 *      cards with too few recent snapshots to have a velocity reading, which
 *      silently and correctly fall back to 50/50.
 *
 * Usage:
 *   npm run updown:preview
 *
 * The flag is deliberately ignored — the preview always shows what the prior
 * WOULD do, so it is useful before `UPDOWN_OPENING_PRIOR_ENABLED` is set.
 */

import { db } from "../server/db";
import {
  orderPoolBySelection,
  selectAnchoredWeeklyIds,
} from "../server/jobs/market-generator";
import { loadOpeningVelocityMap } from "../server/native-markets/openingVelocity";
import {
  UPDOWN_AGENT_DRIFT_PER_DAY,
  UPDOWN_HOT_MEASURED_UP_RATE,
  UPDOWN_HOT_UP_PRICE,
  UPDOWN_HOT_VELOCITY_MIN,
  isUpDownOpeningPriorEnabled,
  pickUpDownOpeningPrices,
} from "../server/native-markets/updown-opening-prices";
import { getWeekContext } from "../server/native-markets/week-context";
import { getTargetMaxLoss } from "../server/config/amm";
import { pickSeedState } from "../server/services/amm-house";
// Pure, zero-I/O module — safe to pull into a script just to quote the
// number back at the reader rather than asserting it in a comment.
import { computeLockInFairUp } from "../server/agents/lockInFair";

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}
function padLeft(s: string | number, n: number): string {
  return String(s).padStart(n);
}

async function main() {
  const { monday: thisMonday, weekNumber } = getWeekContext();
  const nextMonday = new Date(thisMonday.getTime() + 7 * 24 * 3600 * 1000);
  const nextWeek = weekNumber + 1;

  console.log(
    `\nUp/Down opening-price preview for week ${nextWeek} ` +
      `(generation would run ${nextMonday.toISOString()})\n`,
  );
  console.log(
    `Velocity is read as of TODAY over the trailing 6h. Monday's actual ` +
      `readings will differ — treat the band split as indicative.\n`,
  );

  // Eligibility and momentum stats look at the 7 days BEFORE their anchor,
  // so anchoring to nextMonday would put most of that window in the future
  // and exclude the roster. Anchor to now; the week number still drives the
  // selection PRNG, so the field rotation is next week's.
  const { selection, pool } = await selectAnchoredWeeklyIds(
    "updown",
    nextWeek,
    new Date(),
  );
  const people = orderPoolBySelection(pool, selection.all);

  if (people.length === 0) {
    console.log("No anchored candidates. Nothing to preview.");
    return;
  }

  const slotById = new Map<string, string>();
  for (const id of selection.anchors) slotById.set(id, "anchor");
  for (const id of selection.movers) slotById.set(id, "mover");
  for (const id of selection.wildcards) slotById.set(id, "wildcard");

  const velocityMap = await loadOpeningVelocityMap(
    people.map((p) => p.id),
    db,
    { asOf: new Date() },
  );

  const uniformTml = getTargetMaxLoss("updown");
  const uniformSeed = pickSeedState(["up", "down"], "updown");

  console.log(
    pad("person", 30) +
      padLeft("slot", 10) +
      padLeft("velocity", 10) +
      padLeft("band", 8) +
      padLeft("Up", 7) +
      padLeft("b", 8) +
      padLeft("seed", 8),
  );
  console.log("-".repeat(81));

  let hot = 0;
  let cold = 0;
  let noReading = 0;
  let totalSeed = 0;
  let maxTargetMaxLoss = uniformTml;
  // Depth preservation is only exact up to integer credit rounding of
  // targetMaxLoss, so track the real deviation instead of asking the reader to
  // eyeball two rounded b values that legitimately differ by <1.
  let maxBDeviation = 0;
  const velocities: number[] = [];

  for (const person of people) {
    const reading = velocityMap.get(person.id);
    const velocity = reading?.velocity ?? null;
    if (velocity != null) velocities.push(velocity);

    const decision = pickUpDownOpeningPrices({ openingVelocity: velocity });
    const slot = slotById.get(person.id) ?? "—";
    const label = String(person.name).slice(0, 29);

    if (!decision) {
      if (velocity == null) {
        noReading++;
      } else {
        cold++;
      }
      totalSeed += uniformSeed.houseSeedAmount;
      console.log(
        pad(label, 30) +
          padLeft(slot, 10) +
          padLeft(velocity != null ? velocity.toFixed(1) : "—", 10) +
          padLeft(velocity == null ? "no-read" : "cold", 8) +
          padLeft("0.50", 7) +
          padLeft(Math.round(uniformSeed.liquidityB), 8) +
          padLeft(uniformSeed.houseSeedAmount, 8),
      );
      continue;
    }

    hot++;
    const seed = pickSeedState(
      ["up", "down"],
      "updown",
      decision.targetMaxLoss,
      decision.prices,
    );
    totalSeed += seed.houseSeedAmount;
    maxTargetMaxLoss = Math.max(maxTargetMaxLoss, decision.targetMaxLoss);
    maxBDeviation = Math.max(
      maxBDeviation,
      Math.abs(seed.liquidityB - uniformSeed.liquidityB),
    );

    console.log(
      pad(label, 30) +
        padLeft(slot, 10) +
        padLeft(decision.openingVelocity.toFixed(1), 10) +
        padLeft("hot", 8) +
        padLeft(decision.upPrice.toFixed(2), 7) +
        padLeft(Math.round(seed.liquidityB), 8) +
        padLeft(seed.houseSeedAmount, 8),
    );
  }

  console.log("-".repeat(81));

  const total = people.length;
  const hotPct = ((hot / total) * 100).toFixed(0);
  console.log(
    `\nCards: ${total} · hot (velocity >= ${UPDOWN_HOT_VELOCITY_MIN}) ${hot} (${hotPct}%) · ` +
      `cold ${cold} · no reading ${noReading}`,
  );

  if (velocities.length > 0) {
    const sorted = velocities.slice().sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    console.log(
      `Velocity spread: min ${sorted[0].toFixed(1)} · p25 ${at(0.25).toFixed(1)} · ` +
        `median ${at(0.5).toFixed(1)} · p75 ${at(0.75).toFixed(1)} · ` +
        `max ${sorted[sorted.length - 1].toFixed(1)}`,
    );
  }

  const baselineSeed = total * uniformSeed.houseSeedAmount;
  console.log(
    `\nHouse seed: ${totalSeed} credits vs ${baselineSeed} at the uniform seed ` +
      `(+${totalSeed - baselineSeed}, ${((totalSeed / baselineSeed - 1) * 100).toFixed(0)}%)`,
  );
  console.log(
    `Worst-case loss per market: ${uniformTml} before, up to ${maxTargetMaxLoss} now.`,
  );
  console.log(
    `Hot cards open Up at 0.40 against a measured mean weekly rate of ` +
      `${(UPDOWN_HOT_MEASURED_UP_RATE * 100).toFixed(1)}% — a deliberate ` +
      `${((0.4 - UPDOWN_HOT_MEASURED_UP_RATE) * 100).toFixed(1)}pp of headroom left to users.`,
  );

  if (noReading > 0) {
    console.log(
      `\nWARNING: ${noReading} card(s) had no velocity reading (fewer than 3 ` +
        `hourly snapshots in the trailing 6h) and would open 50/50. Expected ` +
        `to be rare — investigate if this is more than 1-2.`,
    );
  }

  // The b column is rounded for display, so a priced row can print 2886 next
  // to a uniform 2885 while being 0.6 apart. Report the true worst-case gap so
  // this line cannot cry wolf on Monday.
  const bTolerance = 2;
  console.log(
    `\nDepth check: uniform b = ${uniformSeed.liquidityB.toFixed(1)}, worst deviation ` +
      `across priced rows = ${maxBDeviation.toFixed(2)} ` +
      `(${maxBDeviation <= bTolerance ? "OK" : "BROKEN"}; tolerance ${bTolerance}, ` +
      `nonzero only because targetMaxLoss is rounded to whole credits).`,
  );

  // Show the agent conflict rather than claiming it. At open pctChangeVsOpen
  // is 0 for every card, so the agents' model has no information and anchors
  // to 0.50 — it will trade the seed back up.
  const hoursToClose = 24 * 7;
  const agentFairDriftless = computeLockInFairUp(0, hoursToClose);
  const agentFairDrifted = computeLockInFairUp(
    0,
    hoursToClose,
    undefined,
    undefined,
    UPDOWN_AGENT_DRIFT_PER_DAY,
  );
  console.log(
    `\nAgent fair value at open (flat card, ${hoursToClose}h left):\n` +
      `  driftless (what every call site uses TODAY): ${agentFairDriftless?.toFixed(4) ?? "null"}\n` +
      `  with UPDOWN_AGENT_DRIFT_PER_DAY=${UPDOWN_AGENT_DRIFT_PER_DAY.toFixed(6)}: ` +
      `${agentFairDrifted?.toFixed(4) ?? "null"}`,
  );
  console.log(
    `The driftless model cannot do anything but 0.50 at open — pctChangeVsOpen ` +
      `is 0 by definition — so agents would trade a ${UPDOWN_HOT_UP_PRICE} seed ` +
      `back up. The drift term fixes that and is calibrated off the same ` +
      `constant as the seed, but NO call site passes it yet, so the wiring diff ` +
      `must enable both together or the agents will still fight the seed.`,
  );

  if (isUpDownOpeningPriorEnabled()) {
    console.log(
      `\nWARNING: UPDOWN_OPENING_PRIOR_ENABLED is set, but nothing reads it ` +
        `yet — generateWeeklyUpDown does not call this module. Markets will ` +
        `still open 50/50. The flag is reserved for the week-35 wiring diff.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
