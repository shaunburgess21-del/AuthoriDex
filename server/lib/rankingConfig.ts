// Ranking tunables — single source of truth for Phase 2 + Phase 3.
//
// Every ranking knob that is likely to need tuning as content velocity,
// user base, or engagement patterns change lives here. Defaults preserve
// Phase 2 behaviour exactly (14-day freshness boost, 5-vote induction
// boost) so introducing this module is not a behavioural change on its
// own — Phase 3's blending only activates once a user has behavioural
// rows in user_category_engagement.
//
// Override at deploy time via env vars listed alongside each constant.
// Invalid / non-numeric env values fall back to the default and emit a
// one-time warning at module load rather than crashing the server.

export function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(
      `[rankingConfig] env ${name}=${JSON.stringify(raw)} is not a finite number; falling back to ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}

// ── Phase 2 constants (unchanged defaults) ─────────────────────────

/**
 * How much "younger" an interest-match card pretends to be when sorting
 * recency-based feeds. 14 days matches the Phase 2 tuning that shipped
 * with commit 239206ca — bridges the natural age gap between freshly
 * seeded non-interest content and older interest content while leaving
 * room for a genuinely fresh non-interest card to crack the top.
 */
export const PERSONALISED_FRESHNESS_BOOST_DAYS = readNumberEnv(
  "RANK_FRESHNESS_BOOST_DAYS",
  14,
);

/**
 * Vote-equivalent boost for the induction feed which is ranked by
 * seedVotes (not recency). ~5 votes lifts a candidate inside the user's
 * interests above an evenly-matched one outside, but the genuine vote
 * leader still wins.
 */
export const PERSONALISED_INDUCTION_VOTE_BOOST = readNumberEnv(
  "RANK_INDUCTION_VOTE_BOOST",
  5,
);

// ── Phase 3 constants (behavioural blending) ───────────────────────

/**
 * Exponential decay half-life for behavioural engagement scores.
 * A category the user last engaged with 30 days ago contributes half
 * its raw count; 60 days ≈ 25%; 90 days ≈ 12.5%. Applied at read time
 * via score = raw * exp(-ln(2) * daysSinceLastEngaged / halfLife).
 */
export const BEHAVIOUR_HALF_LIFE_DAYS = readNumberEnv(
  "RANK_BEHAVIOUR_HALF_LIFE_DAYS",
  30,
);

/**
 * Distinct-category threshold below which behavioural signal is ignored
 * entirely. A user who has only engaged within 1 category has one strong
 * signal repeated, not broad behavioural data — don't let that dominate.
 */
export const BEHAVIOUR_RAMP_MIN_CATEGORIES = readNumberEnv(
  "RANK_BEHAVIOUR_RAMP_MIN",
  4,
);

/**
 * Distinct-category threshold at which behavioural signal reaches full
 * ramp. Between MIN and FULL the ramp is linear so newer users aren't
 * discontinuously snapped into "fully behavioural".
 */
export const BEHAVIOUR_RAMP_FULL_CATEGORIES = readNumberEnv(
  "RANK_BEHAVIOUR_RAMP_FULL",
  8,
);

/**
 * Blend curve anchors: stated vs behavioural weight at weeks 1 and 4
 * after first engagement. Linear interpolation between them; clamped
 * outside. At week 1 stated ~= 0.7 (users trust what they picked);
 * by week 4 behaviour ~= 0.7 (usage is a more honest signal).
 */
export const BLEND_STATED_WEEK_1 = readNumberEnv("RANK_BLEND_STATED_WEEK_1", 0.7);
export const BLEND_STATED_WEEK_4 = readNumberEnv("RANK_BLEND_STATED_WEEK_4", 0.3);

/**
 * Cap for stake-weighted prediction contributions. Each bet contributes
 *   min(3 * log1p(stakeCredits), PREDICTION_STAKE_WEIGHT_CAP)
 * so a 1-credit dabble (~2.08) and a 10,000-credit conviction bet (cap)
 * are both bounded. Prevents whales from monopolising the behavioural
 * signal while still preserving the stake-as-conviction gradient.
 */
export const PREDICTION_STAKE_WEIGHT_CAP = readNumberEnv(
  "RANK_PREDICTION_STAKE_WEIGHT_CAP",
  8,
);

// ── Derived helpers ────────────────────────────────────────────────

/**
 * Linear interpolation between the week-1 and week-4 anchors, clamped
 * outside that range. Input is days since first engagement (≥ 0).
 * Returns the stated weight; behaviour weight = 1 - stated.
 */
export function statedWeightAtDays(daysSinceFirstEngagement: number): number {
  if (!Number.isFinite(daysSinceFirstEngagement) || daysSinceFirstEngagement <= 7) {
    return BLEND_STATED_WEEK_1;
  }
  if (daysSinceFirstEngagement >= 28) {
    return BLEND_STATED_WEEK_4;
  }
  const t = (daysSinceFirstEngagement - 7) / (28 - 7);
  return BLEND_STATED_WEEK_1 + (BLEND_STATED_WEEK_4 - BLEND_STATED_WEEK_1) * t;
}

/**
 * Linear ramp over distinct-category count. Returns 0 below MIN, 1 at
 * FULL, linear in between. Guards against FULL <= MIN misconfiguration
 * by returning a binary 0/1 step at MIN in that case.
 */
export function behaviourRampProgress(distinctCategories: number): number {
  const min = BEHAVIOUR_RAMP_MIN_CATEGORIES;
  const full = BEHAVIOUR_RAMP_FULL_CATEGORIES;
  if (!Number.isFinite(distinctCategories) || distinctCategories <= min) return 0;
  if (full <= min) return 1;
  if (distinctCategories >= full) return 1;
  return (distinctCategories - min) / (full - min);
}

/**
 * Read-time exponential decay factor for a behavioural score. Returns a
 * multiplier in (0, 1]. Using ln(2) / half-life keeps the "days = one
 * half-life" intuition intact.
 */
export function decayFactor(daysSinceLastEngaged: number): number {
  if (!Number.isFinite(daysSinceLastEngaged) || daysSinceLastEngaged <= 0) return 1;
  return Math.exp(-Math.LN2 * (daysSinceLastEngaged / BEHAVIOUR_HALF_LIFE_DAYS));
}

/**
 * Stake-to-weight transform for a single prediction bet.
 * Guarded against negative / non-finite inputs — returns 0 in that case
 * so a malformed bet never poisons the aggregate.
 */
export function stakeBetWeight(stakeCredits: number): number {
  if (!Number.isFinite(stakeCredits) || stakeCredits <= 0) return 0;
  return Math.min(3 * Math.log1p(stakeCredits), PREDICTION_STAKE_WEIGHT_CAP);
}
