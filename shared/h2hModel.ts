/**
 * VoxDex H2H Model — deterministic win-probability for head-to-head markets.
 *
 * Why deterministic (no LLM):
 * - We already own the strongest signal (fame index) and a momentum label
 *   derived from it; LLM-generated probabilities would be noisy, uncachable,
 *   and unexplainable to users.
 * - This keeps the pill honest: same inputs always produce the same number,
 *   and users can reason about why.
 *
 * Formula:
 *   weightedScore = fameIndex * momentumBonus(momentum)
 *   p1Pct = round( weightedScore1 / (weightedScore1 + weightedScore2) * 100 )
 *   p2Pct = 100 - p1Pct
 *
 * `confidence` is derived from the gap from 50/50, so users get a visual
 * signal when the model is actually differentiating vs. basically a coin flip.
 *
 * Lives in `shared/` so both the Express server and the React client can
 * call it without duplication. Keep it framework-free and side-effect-free.
 */

export type MomentumLabel = "Breakout" | "Sustained" | "Cooling" | "Stable";

export interface H2hModelSide {
  fameIndex: number;
  momentum?: MomentumLabel | string | null;
  /** Reserved for future blending. Accepted so callers can pass the full row. */
  change7d?: number | null;
}

export interface H2hModelResult {
  /** Integer percent for side 1, in [1, 99]. */
  p1: number;
  /** Integer percent for side 2, in [1, 99]. Always equals 100 - p1. */
  p2: number;
  /** Qualitative read on how much the model is differentiating. */
  confidence: "low" | "medium" | "high";
}

function momentumBonus(momentum: H2hModelSide["momentum"]): number {
  switch (momentum) {
    case "Breakout":
      return 1.10;
    case "Sustained":
      return 1.05;
    case "Cooling":
      return 0.95;
    default:
      return 1.0;
  }
}

/**
 * Compute a head-to-head win probability based purely on trend data.
 *
 * Clamps the output to [1, 99] so the UI never renders "0% vs 100%" even
 * when one side has an essentially-zero fame index (which would happen for
 * a brand-new addition before their first ingest cycle).
 */
export function h2hModelProbability(
  p1: H2hModelSide,
  p2: H2hModelSide,
): H2hModelResult {
  const f1 = Math.max(p1.fameIndex ?? 0, 1);
  const f2 = Math.max(p2.fameIndex ?? 0, 1);

  const s1 = f1 * momentumBonus(p1.momentum);
  const s2 = f2 * momentumBonus(p2.momentum);

  const rawP1 = (s1 / (s1 + s2)) * 100;
  const p1Pct = Math.min(99, Math.max(1, Math.round(rawP1)));
  const p2Pct = 100 - p1Pct;

  const gap = Math.abs(p1Pct - 50);
  const confidence: H2hModelResult["confidence"] =
    gap >= 15 ? "high" : gap >= 7 ? "medium" : "low";

  return { p1: p1Pct, p2: p2Pct, confidence };
}
