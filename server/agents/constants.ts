export const POSITIVE_HINTS = ["up", "rise", "higher", "yes", "win", "grow", "more", "increase"];
export const NEGATIVE_HINTS = ["down", "fall", "lower", "no", "lose", "decline", "less", "decrease"];

// Crowd-skew threshold (0-1) above which a contrarian agent will fade
// the consensus instead of joining it. 0.65 means "if 65%+ of stake is
// on one side, contrarians look at the other side first." Below this
// they behave like normal agents — keeps contrarian behaviour focused
// on actually crowded markets rather than firing on any minor lean.
export const CONTRARIAN_TRIGGER_THRESHOLD = 0.65;

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

// Conviction re-bets: an agent already holding a position gets to bet
// AGAIN if the Trend Score moves >5% in their favour from the original
// buy's baseline. 5% is roughly one standard-deviation weekly move on
// the highest-volume celebrities — large enough to be a real signal,
// small enough to fire 2-3 times per week on a hot market. Capped at
// 1 conviction re-bet per agent per market so a runaway score doesn't
// turn into a stack of compounding positions.
export const CONVICTION_SCORE_THRESHOLD_PCT = 0.05;
export const CONVICTION_MAX_PER_MARKET = 1;

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
  "sharp" | "casual" | "noisy" | "liquidity" | "whale",
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
    earlyProfitPct: 0.12,
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
    earlyProfitPct: 0.15,
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
    earlyProfitPct: 0.08,
    topFractionRange: [0.55, 0.85],
    bottomFractionRange: [0.50, 0.80],
    earlyFractionRange: [0.20, 0.40],
    bandRadiusScale: 0.95,
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
