export const POSITIVE_HINTS = ["up", "rise", "higher", "yes", "win", "grow", "more", "increase"];
export const NEGATIVE_HINTS = ["down", "fall", "lower", "no", "lose", "decline", "less", "decrease"];

// Crowd-skew threshold (0-1) above which a contrarian agent will fade
// the consensus instead of joining it. 0.65 means "if 65%+ of stake is
// on one side, contrarians look at the other side first." Below this
// they behave like normal agents — keeps contrarian behaviour focused
// on actually crowded markets rather than firing on any minor lean.
export const CONTRARIAN_TRIGGER_THRESHOLD = 0.65;

// Prestige UP-tilt only when baseline reflects real leaderboard stature.
export const PRESTIGE_MIN_BASELINE = 200_000;

// Young markets with no directional signal — throttle Monday-morning pile-on.
export const NO_SIGNAL_ABSTAIN_RATE_STANDARD = 0.60;
export const NO_SIGNAL_ABSTAIN_RATE_SHARP = 0.30;
export const YOUNG_MARKET_HOURS = 24;

// Minimum agent confidence (0-1) required before we generate an LLM
// rationale. Anything below 0.65 is treated as a low-conviction trade
// and gets a templated reason instead — saves both LLM cost and the
// post-trade "why" feed being clogged with weakly-justified picks.
export const RATIONALE_CONFIDENCE_THRESHOLD = 0.65;

// Per-agent memory cap. The decision engine reads the N most recent
// memories (recent_outcome / strength / weakness / self_note) when
// composing rationale and tuning persona behaviour. 20 covers ~3-4
// weeks of resolved markets per agent — long enough to detect recent
// trend without bloating the rationale prompt token count.
export const MEMORY_CAP = 20;

// Action worker claim batch size. Each 2-min worker tick claims up to
// 20 pending scheduled_agent_actions (FOR UPDATE SKIP LOCKED). 20
// gives a comfortable throughput for the ~600 agents × N markets/day
// volume while keeping the inner per-action transaction small enough
// to finish well under the next 2-min tick deadline.
export const ACTION_WORKER_BATCH_SIZE = 20;
// Cadence for the worker loop. 2 minutes balances "responsive enough
// that scheduled actions execute close to their executeAfter target"
// against "infrequent enough that idle ticks don't hammer the DB."
export const ACTION_WORKER_INTERVAL_MS = 2 * 60 * 1000;

// Quiet hours in SAST (UTC+2): no agent writes between 22:30 and 06:30
export const QUIET_HOUR_START_SAST = 22.5;
export const QUIET_HOUR_END_SAST = 6.5;

// Delay ranges in seconds by archetype for staggered prediction timing (native markets)
export const ARCHETYPE_DELAY_RANGES: Record<string, [number, number]> = {
  recency_bias:       [300,    7_200],   //  5min – 2hrs
  momentum_chaser:    [1_800,  14_400],  // 30min – 4hrs
  news_reactive:      [3_600,  18_000],  //  1hr  – 5hrs
  contrarian:         [7_200,  28_800],  //  2hrs – 8hrs
  prestige_maximiser: [14_400, 43_200],  //  4hrs – 12hrs
  long_horizon:       [21_600, 86_400],  //  6hrs – 24hrs
  domain_specialist:  [3_600,  18_000],  //  1hr  – 5hrs
  culture_tracker:    [1_800,  14_400],  // 30min – 4hrs
  high_conviction:    [14_400, 43_200],  //  4hrs – 12hrs
  conservative:       [1_800,  10_800],  // 30min – 3hrs
  chaos_agent:        [300,    28_800],  //  5min – 8hrs
};

// Delay ranges for World Market evaluations (longer stagger to look natural)
export const WORLD_MARKET_DELAY_RANGES: Record<string, [number, number]> = {
  conservative:       [3_600,   21_600],  //  1–6 hrs
  domain_specialist:  [3_600,   21_600],  //  1–6 hrs
  momentum_chaser:    [21_600,  86_400],  //  6–24 hrs
  culture_tracker:    [21_600,  86_400],  //  6–24 hrs
  high_conviction:    [86_400,  259_200], // 24–72 hrs
  long_horizon:       [86_400,  259_200], // 24–72 hrs
  chaos_agent:        [3_600,   172_800], //  1–48 hrs
  contrarian:         [3_600,   172_800], //  1–48 hrs
  recency_bias:       [21_600,  86_400],  //  6–24 hrs
  news_reactive:      [3_600,   21_600],  //  1–6 hrs
  prestige_maximiser: [21_600,  86_400],  //  6–24 hrs
};

// Default stake floors / caps by agent risk appetite. 100 is the
// reference position size — a 1% notional on the 10,000-credit human
// baseline so agent activity feels comparable to a real user. 300 caps
// the most aggressive sizings; without a ceiling the conviction × edge
// curve can run away on high-confidence sharp trades and concentrate
// risk on a single market.
export const BASE_STAKE_AMOUNT = 100;
export const MAX_AGENT_STAKE = 300;

// Credit refresh thresholds. Once an agent's predict_credits drops
// below LOW_THRESHOLD they get topped up to TOPUP_TARGET. 10k floor
// keeps positions sized realistically (an agent below 10k credits
// would be sizing in dust); 50k refill is generous enough that a
// single resolved market doesn't immediately push them back into
// top-up territory.
export const AGENT_CREDIT_LOW_THRESHOLD = 10_000;
export const AGENT_CREDIT_TOPUP_TARGET = 50_000;

// Agent runner sweep cadence. 30 minutes means every market is
// re-evaluated 48 times/day across the cohort — frequent enough that
// price discovery keeps pace with intraday Trend Score moves, sparse
// enough that the LLM ranker and per-market evaluation costs stay
// bounded. 3-min startup delay lets the rest of the server (DB
// connections, OpenAI client) warm up before the first sweep fires.
export const AGENT_RUNNER_INTERVAL_MS = 30 * 60 * 1000;
export const AGENT_RUNNER_STARTUP_DELAY_MS = 3 * 60 * 1000;

// Stagger: only evaluate this many markets per sweep (rest deferred to next sweep)
// Bumped 15→30 (2026-05-02). With WORLD_MARKET_RESERVE_PER_SWEEP=10, the
// native pool was getting only 5 markets per sweep — out of 159 weekly
// up/down cards plus jackpot/h2h/gainer. That's why agents kept piling on
// the same handful of celebrities (Theo Von, Peter Thiel, etc.) instead of
// spreading across the catalogue. 20 native per sweep × 48 sweeps/day = 960
// evaluations, which gives every up/down market multiple chances to be
// sampled per day even with the rotation memory below.
export const MARKETS_PER_SWEEP = 30;
export const WORLD_MARKET_RESERVE_PER_SWEEP = 10;

// Rotation memory: how many recently-sampled native markets to push to the
// back of the next sweep's shuffle. Without this, the random shuffle has no
// memory and the same markets keep landing in the slice. With a buffer of
// 40 (2 sweeps' worth of native picks), we guarantee fresh markets every
// sweep until the catalogue cycles through.
export const NATIVE_ROTATION_MEMORY = 40;

// Lenient env-flag parser. Accepts true/false in any case plus common
// truthy aliases (1, yes, on) so a Railway value of `TRUE` doesn't read
// as falsy (which is exactly how WORLD_MARKETS_LLM_ENABLED stayed silently
// disabled for 2 days in May 2026 — Railway saved the value as "TRUE",
// the strict `=== "true"` check returned false, and the kill switch
// stayed engaged with no obvious symptom).
function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

// World Market boost mode (toggle via env WORLD_MARKET_BOOST_ENABLED).
// SAFETY: Default flipped to OFF (2026-05-01). When enabled, drops the
// per-market skip rate dramatically and 1.5x's the activity gate, which
// multiplies LLM call volume ~3x. Only re-enable once per-market caching
// has been proven stable in production.
export const WORLD_MARKET_BOOST_ENABLED = envFlag(process.env.WORLD_MARKET_BOOST_ENABLED);
export const WORLD_MARKET_ACTIVITY_MULTIPLIER = 1.5;

// HARD KILL SWITCH for World Market LLM calls (web_search Responses API).
// Each call costs ~$0.20-0.40 (web search + ~1k output tokens). With 56 agents
// independently evaluating each market, a single sweep can burn $40+. When
// false, agents abstain from World Markets without ever touching OpenAI.
//
// Set WORLD_MARKETS_LLM_ENABLED=true ONLY after:
//   1. Topping up the OpenAI billing balance, AND
//   2. Confirming the per-market cache (predictionMarkets.metadata.worldAssessment)
//      is in place so the LLM only runs ONCE per market per TTL.
export const WORLD_MARKETS_LLM_ENABLED = envFlag(process.env.WORLD_MARKETS_LLM_ENABLED);

// TTL for cached per-market LLM assessments — adaptive by time-to-resolution.
//
// Most world markets resolve months out (e.g. "Will Tesla close above $400 on
// Dec 31?") and don't materially change day-to-day; refreshing those daily
// burns money on noise. But markets in their final stretch (e.g. a verdict
// expected this week) ARE news-sensitive and need a tighter cache.
//
// Tiers (read by `getAssessmentTtlMs` in worldMarketEngine):
//   • < 3 days to resolve  → 12h  (final stretch, news swings outcomes)
//   • 3-14 days            → 48h  (this week's news still matters)
//   • 14-60 days           → 5d   (medium horizon, occasional refresh)
//   • > 60 days OR unknown → 14d  (long horizon — noise > signal)
//
// 2026-05-17 cost trim: each tier was doubled from its original value
// (6h/24h/3d/7d) to roughly halve average per-market spend with minimal
// loss of news freshness — a final-stretch market still refreshes twice
// per day, near markets every other day, which is well inside the news
// cycles that actually move outcomes. Versus a flat 24h, the typical
// world-market mix (most are 1-12 months out) now drops average refresh
// frequency ~10-14x, with no meaningful loss of responsiveness.
export const WORLD_MARKET_ASSESSMENT_TTL_FINAL_MS = 12 * 60 * 60 * 1000;
export const WORLD_MARKET_ASSESSMENT_TTL_NEAR_MS = 48 * 60 * 60 * 1000;
export const WORLD_MARKET_ASSESSMENT_TTL_MEDIUM_MS = 5 * 24 * 60 * 60 * 1000;
export const WORLD_MARKET_ASSESSMENT_TTL_LONG_MS = 14 * 24 * 60 * 60 * 1000;
/** Effective ceiling — used by admin diagnostics & cache cleanup. */
export const WORLD_MARKET_ASSESSMENT_TTL_MAX_MS = WORLD_MARKET_ASSESSMENT_TTL_LONG_MS;
/** @deprecated Kept for backwards compatibility with admin status JSON. */
export const WORLD_MARKET_ASSESSMENT_TTL_MS = WORLD_MARKET_ASSESSMENT_TTL_NEAR_MS;

/**
 * Hard daily budget cap (USD) on world-market LLM spend, applied
 * per-process by `server/agents/worldMarketBudget.ts`. When today's
 * estimated spend would exceed this value, agents abstain from
 * world markets for the rest of the UTC day. Cached assessments
 * continue to serve normally — the cap only gates NEW LLM calls.
 * Reset at UTC midnight.
 *
 * Set conservatively. The point is to bound worst-case overnight
 * spend, not to optimise average cost. Raise via Railway env
 * `WORLD_MARKETS_DAILY_BUDGET_USD` once you've observed steady-state
 * production cost on the OpenAI billing dashboard for a week.
 *
 * NOTE: the live value at runtime is read by `worldMarketBudget.ts`
 * directly from `process.env`. This exported constant is a snapshot
 * at module load for display / docs / IDE discoverability. To change
 * the live cap, set the env var and redeploy — don't edit this file.
 */
export const WORLD_MARKETS_DAILY_BUDGET_USD = (() => {
  const raw = Number(process.env.WORLD_MARKETS_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5.0;
})();

/**
 * Per-call cost ESTIMATE used by the budget module to reserve budget
 * BEFORE the LLM call fires. Deliberately on the conservative side —
 * better to refuse one borderline call than to overrun the cap. Real
 * cost varies with web_search activity and output token count; ops
 * should reconcile against the actual OpenAI billing dashboard
 * weekly. Override via Railway env
 * `WORLD_MARKETS_PER_CALL_ESTIMATE_USD` if observation shows the
 * estimate is way off in either direction.
 */
export const WORLD_MARKETS_PER_CALL_ESTIMATE_USD = (() => {
  const raw = Number(process.env.WORLD_MARKETS_PER_CALL_ESTIMATE_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.4;
})();

// Conviction re-bets: an agent already holding a position gets to bet
// AGAIN if the Trend Score moves >5% in their favour from the original
// buy's baseline. 5% is roughly one standard-deviation weekly move on
// the highest-volume celebrities — large enough to be a real signal,
// small enough to fire 2-3 times per week on a hot market. Capped at
// 1 conviction re-bet per agent per market so a runaway score doesn't
// turn into a stack of compounding positions.
export const CONVICTION_SCORE_THRESHOLD_PCT = 0.05;

// Score-aligned follow-up tunables (Up/Down AMM — May 2026).
// Conviction and re-predict read pctChangeVsOpen vs weekly open, not AMM price delta.
// Phase 3 (May 2026): loosened after Phase 1 news smoothing verified — do not
// lower further while trend-score sawtooth remains elevated.
export const DECISIVE_WEEKLY_MOVE_PCT = 0.10;
/** Re-arm decisive latch when |pctChangeVsOpen| falls back below this (hysteresis). */
export const DECISIVE_REVERT_PCT = (() => {
  const raw = Number(process.env.DECISIVE_REVERT_PCT);
  return Number.isFinite(raw) && raw > 0 && raw < DECISIVE_WEEKLY_MOVE_PCT ? raw : 0.05;
})();
/** Log latch-revert disarm candidates without changing bets. */
export const LATCH_REVERT_SHADOW = envFlag(process.env.LATCH_REVERT_SHADOW);
/** Treat latched markets as non-decisive when score reverts near flat. */
export const LATCH_REVERT_ENABLED = envFlag(process.env.LATCH_REVERT_ENABLED);
/** Hourly fame samples when deciding whether to set weeklyOpen.decisiveLatched. */
export const LATCH_TRAILING_SAMPLE_COUNT = (() => {
  const raw = Number(process.env.LATCH_TRAILING_SAMPLE_COUNT);
  return Number.isInteger(raw) && raw >= 2 ? raw : 3;
})();
/** Log mid-week convergence candidates without scheduling bets. */
export const MIDWEEK_CONVERGENCE_SHADOW = envFlag(process.env.MIDWEEK_CONVERGENCE_SHADOW);
/** Arb cohort nudges mispriced up/down markets before the final-6h window. */
export const MIDWEEK_CONVERGENCE_ENABLED = envFlag(process.env.MIDWEEK_CONVERGENCE_ENABLED);
/** Higher edge bar than ARB_MIN_EDGE_PP to avoid mid-week thrash. */
export const ARB_MIDWEEK_MIN_EDGE_PP = (() => {
  const raw = Number(process.env.ARB_MIDWEEK_MIN_EDGE_PP);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.12;
})();
/**
 * Decisive-score gate for the MIDWEEK sweep only (near-close arb keeps
 * LOCKIN_DECISIVE_PCT = 0.10). Lower so mispriced near-flat markets — e.g.
 * a score that reverted after an early pile-on — are tradeable midweek;
 * the 12pp edge bar stays the real safety control. Default 0.02 still
 * filters pure-noise flats (±2%).
 */
export const ARB_MIDWEEK_DECISIVE_PCT = (() => {
  const raw = Number(process.env.ARB_MIDWEEK_DECISIVE_PCT);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.02;
})();

export function isLatchRevertShadow(): boolean {
  return envFlag(process.env.LATCH_REVERT_SHADOW);
}

export function isLatchRevertEnabled(): boolean {
  return envFlag(process.env.LATCH_REVERT_ENABLED);
}

export function isMidweekConvergenceShadow(): boolean {
  return envFlag(process.env.MIDWEEK_CONVERGENCE_SHADOW);
}

export function isMidweekConvergenceEnabled(): boolean {
  return envFlag(process.env.MIDWEEK_CONVERGENCE_ENABLED);
}

// ---------------------------------------------------------------------------
// Community (World Market) source-anchored convergence
// ---------------------------------------------------------------------------
// Scouted World Markets carry the source market's consensus prices in
// metadata.source (pricesAtImport at import, livePrices refreshed daily by
// the source watcher). The arb cohort can converge AMM prices toward that
// anchor — deterministic, zero LLM cost. Same shadow -> enable rollout
// pattern as the native lock-in flags. All read at call time so a Railway
// flag flip applies on the next sweep without restart-order concerns.

/** Log community convergence candidates without scheduling trades. */
export function isCommunityConvergenceShadow(): boolean {
  return envFlag(process.env.COMMUNITY_CONVERGENCE_SHADOW);
}

/** Arb cohort trades scouted community markets toward the source anchor. */
export function isCommunityConvergenceEnabled(): boolean {
  return envFlag(process.env.COMMUNITY_CONVERGENCE_ENABLED);
}

/** Agent sell sweep may exit community positions (price-band anchors). */
export function isCommunitySellSweepEnabled(): boolean {
  return envFlag(process.env.COMMUNITY_SELL_SWEEP_ENABLED);
}

/**
 * Edge bar for community arb buys. Higher than the native near-close
 * ARB_MIN_EDGE_PP (0.04) because the anchor refreshes daily — a stale
 * anchor plus a thin edge would let agents chase yesterday's news.
 */
export const COMMUNITY_ARB_MIN_EDGE_PP = (() => {
  const raw = Number(process.env.COMMUNITY_ARB_MIN_EDGE_PP);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.06;
})();

/** Max community markets per convergence sweep (canary cap). */
export const COMMUNITY_CONVERGENCE_MARKETS_PER_SWEEP = (() => {
  const raw = Number(process.env.COMMUNITY_CONVERGENCE_MARKETS_PER_SWEEP);
  return Number.isInteger(raw) && raw > 0 ? raw : 10;
})();

export const REPREDICT_PCT_THRESHOLD = 0.06;
export const REPREDICT_MAX_PER_MARKET = 2;
export const CONVICTION_SCORE_AGREE_FLIP = 0.12;
export const CONVICTION_SCORE_DISAGREE_FLIP_BASE = 0.55;
export const CONVICTION_SCORE_DISAGREE_FLIP_CONTRARIAN = 0.10;
export const SCORE_REVERSAL_SELL_PCT = 0.06;
export const CONVICTION_MAX_PER_MARKET = 2;
export const MISPRICED_PRIORITY_SLICE = 5;
export const MISPRICED_SCORE_PCT = 0.08;
export const MISPRICED_UP_PRICE_HIGH = 0.52;
export const MISPRICED_UP_PRICE_LOW = 0.48;

// ---------------------------------------------------------------------------
// Native markets LLM assessment (Up/Down, H2H, Gainer — May 2026)
// ---------------------------------------------------------------------------
export const NATIVE_MARKETS_LLM_ENABLED = envFlag(process.env.NATIVE_MARKETS_LLM_ENABLED);
export const NATIVE_MARKETS_DAILY_BUDGET_USD = (() => {
  const raw = Number(process.env.NATIVE_MARKETS_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 2.0;
})();
export const NATIVE_MARKETS_PER_CALL_ESTIMATE_USD = (() => {
  const raw = Number(process.env.NATIVE_MARKETS_PER_CALL_ESTIMATE_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.012;
})();
export const NATIVE_LLM_BOOST_WEIGHT = 0.15;
export const NATIVE_ASSESSMENT_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Lock-in fair value (time-aware certainty — May/Jun 2026)
// Sigma DEFAULT pinned to the legacy 0.109: the recalibration to ~0.115 is a
// SEPARATE deploy that must land AFTER observing the EMA-relaxed (0.68) score
// series — never co-deploy EMA + sigma (caveat #3/#6). When ready, raise via
// LOCKIN_SIGMA_1D env (or bump this default in its own commit).
// ---------------------------------------------------------------------------
export const LOCKIN_SIGMA_1D_DEFAULT = 0.109;
export const LOCKIN_BETA_DEFAULT = 0.36;
/** Log shadow fair targets without changing bets. */
export const LOCKIN_FAIR_SHADOW = envFlag(process.env.LOCKIN_FAIR_SHADOW);
/** Apply fair as confidence floor in computePrediction. */
export const LOCKIN_FAIR_ENABLED = envFlag(process.env.LOCKIN_FAIR_ENABLED);
/** Dedicated arb / convergence cohort places trades. */
export const ARB_COHORT_ENABLED = envFlag(process.env.ARB_COHORT_ENABLED);
/** Friday 23:59 UTC betting cutoff for native AMM up/down (not just jackpot). */
export const NATIVE_FRIDAY_CUTOFF_ENABLED = envFlag(process.env.NATIVE_FRIDAY_CUTOFF_ENABLED);

/** Arb agents: per-trade budget ceiling (actionWorker). */
export const ARB_AGENT_MAX_STAKE = (() => {
  const raw = Number(process.env.ARB_AGENT_MAX_STAKE);
  return Number.isFinite(raw) && raw >= 100 ? Math.round(raw) : 5000;
})();

export const ARB_MIN_EDGE_PP = 0.04;
export const ARB_EDGE_BAND = 0.35;
/** Max up/down markets per near-close convergence sweep (canary). */
export const ARB_CONVERGENCE_MARKETS_PER_SWEEP = (() => {
  const raw = Number(process.env.ARB_CONVERGENCE_MARKETS_PER_SWEEP);
  return Number.isInteger(raw) && raw > 0 ? raw : 10;
})();

/** H2H lock-in: shadow logs only (no bet changes). */
export const LOCKIN_FAIR_H2H_SHADOW = envFlag(process.env.LOCKIN_FAIR_H2H_SHADOW);
/** H2H lock-in: confidence floor + force-pick + arb convergence. */
export const LOCKIN_FAIR_H2H_ENABLED = envFlag(process.env.LOCKIN_FAIR_H2H_ENABLED);
/** Favored-side fair at or above this → force-pick that entry (H2H). */
export const LOCKIN_H2H_DECISIVE_FAIR = (() => {
  const raw = Number(process.env.LOCKIN_H2H_DECISIVE_FAIR);
  return Number.isFinite(raw) && raw > 0.5 && raw < 1 ? raw : 0.58;
})();
export const LOCKIN_H2H_SIGMA_1D = (() => {
  const raw = Number(process.env.LOCKIN_H2H_SIGMA_1D);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const base = Number(process.env.LOCKIN_SIGMA_1D);
  return Number.isFinite(base) && base > 0 ? base : LOCKIN_SIGMA_1D_DEFAULT;
})();
export const LOCKIN_H2H_BETA = (() => {
  const raw = Number(process.env.LOCKIN_H2H_BETA);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const base = Number(process.env.LOCKIN_BETA);
  return Number.isFinite(base) && base > 0 ? base : LOCKIN_BETA_DEFAULT;
})();

/** Runtime read (tests can flip env without re-importing the module). */
export function isLockInFairH2HShadow(): boolean {
  return envFlag(process.env.LOCKIN_FAIR_H2H_SHADOW);
}

export function isLockInFairH2HEnabled(): boolean {
  return envFlag(process.env.LOCKIN_FAIR_H2H_ENABLED);
}

/** Gainer lock-in: shadow logs only (no bet changes). */
export const LOCKIN_FAIR_GAINER_SHADOW = envFlag(process.env.LOCKIN_FAIR_GAINER_SHADOW);
/** Gainer lock-in: confidence floor + force-pick + arb convergence. */
export const LOCKIN_FAIR_GAINER_ENABLED = envFlag(process.env.LOCKIN_FAIR_GAINER_ENABLED);
/** Favored-side fair at or above this → force-pick that entry (gainer). */
export const LOCKIN_GAINER_DECISIVE_FAIR = (() => {
  const raw = Number(process.env.LOCKIN_GAINER_DECISIVE_FAIR);
  return Number.isFinite(raw) && raw > 0.2 && raw < 1 ? raw : 0.45;
})();
export const LOCKIN_GAINER_SIGMA_1D = (() => {
  const raw = Number(process.env.LOCKIN_GAINER_SIGMA_1D);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const base = Number(process.env.LOCKIN_SIGMA_1D);
  return Number.isFinite(base) && base > 0 ? base : LOCKIN_SIGMA_1D_DEFAULT;
})();
export const LOCKIN_GAINER_BETA = (() => {
  const raw = Number(process.env.LOCKIN_GAINER_BETA);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const base = Number(process.env.LOCKIN_BETA);
  return Number.isFinite(base) && base > 0 ? base : LOCKIN_BETA_DEFAULT;
})();

/** Runtime read (tests can flip env without re-importing the module). */
export function isLockInFairGainerShadow(): boolean {
  return envFlag(process.env.LOCKIN_FAIR_GAINER_SHADOW);
}

export function isLockInFairGainerEnabled(): boolean {
  return envFlag(process.env.LOCKIN_FAIR_GAINER_ENABLED);
}

// ---------------------------------------------------------------------------
// Stage 4 (optional) — early-week settlement bonus + score EMA relaxation
// ---------------------------------------------------------------------------
export const EARLY_WEEK_SETTLEMENT_BONUS_ENABLED = envFlag(
  process.env.EARLY_WEEK_SETTLEMENT_BONUS_ENABLED,
);
export const EARLY_WEEK_SETTLEMENT_BONUS_MULTIPLIER = (() => {
  const raw = Number(process.env.EARLY_WEEK_SETTLEMENT_BONUS_MULTIPLIER);
  return Number.isFinite(raw) && raw >= 1 && raw <= 1.5 ? raw : 1.15;
})();
/** Hours after market startAt that qualify as "early week" for bonus. */
export const EARLY_WEEK_BONUS_HOURS = (() => {
  const raw = Number(process.env.EARLY_WEEK_BONUS_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : 48;
})();
export const SCORE_EMA_MORE_RAW_ENABLED = envFlag(process.env.SCORE_EMA_MORE_RAW_ENABLED);

// ---------------------------------------------------------------------------
// Agent sells (Phase 1 — AMM up/down only)
// ---------------------------------------------------------------------------
//
// Each agent's open AMM position has a "conviction band" anchored on their
// weighted-average buy price. When the live AMM price exits the band on
// either side, the agent becomes a CANDIDATE to sell. Whether they actually
// do is filtered through several persona-specific gates designed to capture
// human imperfection — the cohort should NOT sell in lockstep on every
// breach.
//
// Five gates, in order:
//   1. Forgot to look       — agent doesn't even evaluate this position
//   2. Persona pSell        — even when the band is breached, they may not act
//   3. Hope for reversal    — extra hold-anyway gate when in the loss zone
//   4. Inside-band early    — small chance to take partial profit pre-breach
//   5. Sell fraction        — how much of the position to dump (rarely 100%)
//
// Tuning rationale per band:
//   - sharp     : disciplined exits, tight bands, mostly clean-exit fractions
//   - casual    : paper hands of profit / diamond hands of loss; wide bands
//   - noisy     : impulsive, takes early profits, inconsistent on losses
//   - liquidity : passive market-makers; rarely exit, hold to resolution
//   - whale     : selective, big positions, careful but decisive when they act
// Per-agent sell caps. 2 sells per market per agent permits one partial
// take-profit + one full exit (or two partials), but rules out the
// thrashing pattern of sell-rebuy-sell on the same position.
export const MAX_SELLS_PER_MARKET_PER_AGENT = 2;
// Minimum fractional shares an agent will sell. Anything below 0.1
// rounds to <1 credit of proceeds and isn't worth the trade cost +
// log noise.
export const MIN_SHARES_TO_SELL = 0.1;
// Minimum net position an agent must hold before sell evaluation
// fires. 0.5 shares skips dust positions left over from rounding /
// partial sells — no point spending CPU on a position that pays <1
// credit even on a 100% win.
export const MIN_NET_SHARES_FOR_SELL_EVAL = 0.5;

export interface SellPersonaTuning {
  /** Probability the agent skips the entire evaluation this sweep. */
  forgetSkipPct: number;
  /** P(act on a top-of-band breach — profit zone). */
  pSellTop: number;
  /** P(act on a bottom-of-band breach — loss zone). */
  pSellBottom: number;
  /** P(stubbornly hold despite a loss-zone breach — denial / hope). */
  hopeForReversalPct: number;
  /** P(opportunistic partial profit-take inside the band, upper half only). */
  earlyProfitPct: number;
  /** [min, max] sell fraction at top breach (0.85-1.00 for sharps, etc.). */
  topFractionRange: [number, number];
  /** [min, max] sell fraction at bottom breach. */
  bottomFractionRange: [number, number];
  /** [min, max] sell fraction at early-profit-take. */
  earlyFractionRange: [number, number];
  /** Multiplier on the conviction-derived band radius. <1 = tighter exits. */
  bandRadiusScale: number;
}

export const SELL_PERSONA_TUNING: Record<
  "sharp" | "casual" | "noisy" | "liquidity" | "whale" | "arb",
  SellPersonaTuning
> = {
  sharp: {
    forgetSkipPct: 0.20,
    pSellTop: 0.65,
    pSellBottom: 0.55,
    hopeForReversalPct: 0.15,
    earlyProfitPct: 0.05,
    topFractionRange: [0.85, 1.00],
    bottomFractionRange: [0.70, 1.00],
    earlyFractionRange: [0.20, 0.35],
    bandRadiusScale: 0.85,
  },
  casual: {
    forgetSkipPct: 0.50,
    pSellTop: 0.30,
    pSellBottom: 0.20,
    hopeForReversalPct: 0.40,
    earlyProfitPct: 0.06,
    topFractionRange: [0.40, 0.70],
    bottomFractionRange: [0.30, 0.60],
    earlyFractionRange: [0.20, 0.40],
    bandRadiusScale: 1.10,
  },
  noisy: {
    forgetSkipPct: 0.40,
    pSellTop: 0.45,
    pSellBottom: 0.30,
    hopeForReversalPct: 0.30,
    earlyProfitPct: 0.08,
    topFractionRange: [0.50, 0.90],
    bottomFractionRange: [0.40, 0.75],
    earlyFractionRange: [0.20, 0.45],
    bandRadiusScale: 1.00,
  },
  liquidity: {
    forgetSkipPct: 0.60,
    pSellTop: 0.20,
    pSellBottom: 0.15,
    hopeForReversalPct: 0.50,
    earlyProfitPct: 0.05,
    topFractionRange: [0.30, 0.55],
    bottomFractionRange: [0.25, 0.50],
    earlyFractionRange: [0.15, 0.30],
    bandRadiusScale: 1.20,
  },
  whale: {
    forgetSkipPct: 0.30,
    pSellTop: 0.40,
    pSellBottom: 0.35,
    hopeForReversalPct: 0.25,
    earlyProfitPct: 0.04,
    topFractionRange: [0.55, 0.85],
    bottomFractionRange: [0.50, 0.80],
    earlyFractionRange: [0.20, 0.40],
    bandRadiusScale: 0.95,
  },
  arb: {
    forgetSkipPct: 0.70,
    pSellTop: 0.15,
    pSellBottom: 0.10,
    hopeForReversalPct: 0.60,
    earlyProfitPct: 0.02,
    topFractionRange: [0.25, 0.45],
    bottomFractionRange: [0.20, 0.40],
    earlyFractionRange: [0.15, 0.25],
    bandRadiusScale: 1.35,
  },
};

/**
 * Default conviction used when the agent's original buy decision payload
 * doesn't carry one (legacy positions opened before Agent v2 stamped
 * `rankerConviction` into `decision_payload`). Lower default = wider band
 * = fewer false-positive sell candidates fired, which is the safer side
 * of the trade-off for legacy data.
 */
export const SELL_DEFAULT_CONVICTION = 0.5;

// World Market re-evaluation cadence. World markets are long-horizon
// (weeks-to-months), so an agent re-evaluating every 7 days picks up
// material news without burning LLM cost on noise. Conviction re-bets
// (deeper position add on a still-held thesis) are rarer at 30-day
// intervals, fire on a 30% probability roll, and require the position
// to have been open at least 14 days — so we don't compound an agent
// into a market they just entered.
export const WORLD_REEVAL_INTERVAL_DAYS = 7;
export const WORLD_CONVICTION_INTERVAL_DAYS = 30;
export const WORLD_CONVICTION_CHANCE = 0.30;
export const WORLD_CONVICTION_MIN_DAYS_OPEN = 14;

// Jackpot agent betting. Agents skip jackpots within 6h of close so a
// late-week burst of agent activity doesn't crowd out the very signal
// the jackpot is testing (closing-score prediction precision). 50 is
// the +/- offset window the action worker searches when an agent's
// chosen integer is already taken — a wider range would dilute the
// "closest guess" precision; narrower would skip too many actions on
// crowded jackpots.
export const JACKPOT_AGENT_MIN_BUFFER_HOURS = 6;
export const JACKPOT_AGENT_COLLISION_RANGE = 50;

// Agent-specific stake modifiers (by username)
export const AGENT_STAKE_OVERRIDES: Record<string, { multiplier?: number; cap?: number; floor?: number }> = {
  ironhands_official: { multiplier: 2.5 },
  safeplay_bot:       { cap: 150 },
  wildcard_za:        { floor: 50 },
};
