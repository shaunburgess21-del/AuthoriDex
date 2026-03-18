export const POSITIVE_HINTS = ["up", "rise", "higher", "yes", "win", "grow", "more", "increase"];
export const NEGATIVE_HINTS = ["down", "fall", "lower", "no", "lose", "decline", "less", "decrease"];

export const CONTRARIAN_TRIGGER_THRESHOLD = 0.65;
export const RATIONALE_CONFIDENCE_THRESHOLD = 0.65;
export const MEMORY_CAP = 20;
export const ACTION_WORKER_BATCH_SIZE = 20;
export const ACTION_WORKER_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

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

// Default stake amounts by agent risk appetite
export const BASE_STAKE_AMOUNT = 100;
export const MAX_AGENT_STAKE = 300;

// Credit refresh: top up agents that fall below threshold
export const AGENT_CREDIT_LOW_THRESHOLD = 10_000;
export const AGENT_CREDIT_TOPUP_TARGET = 50_000;

// Agent runner sweep interval (checks for new markets every 30 min)
export const AGENT_RUNNER_INTERVAL_MS = 30 * 60 * 1000;
export const AGENT_RUNNER_STARTUP_DELAY_MS = 3 * 60 * 1000;

// Stagger: only evaluate this many markets per sweep (rest deferred to next sweep)
export const MARKETS_PER_SWEEP = 15;

// Conviction re-bets: allow agents to bet again on markets with significant score movement
export const CONVICTION_SCORE_THRESHOLD_PCT = 0.05; // 5% move from baseline
export const CONVICTION_MAX_PER_MARKET = 1; // max 1 conviction bet per agent per market

// World Market re-evaluation timing
export const WORLD_REEVAL_INTERVAL_DAYS = 7;
export const WORLD_CONVICTION_INTERVAL_DAYS = 30;
export const WORLD_CONVICTION_CHANCE = 0.30;
export const WORLD_CONVICTION_MIN_DAYS_OPEN = 14;

// Agent-specific stake modifiers (by username)
export const AGENT_STAKE_OVERRIDES: Record<string, { multiplier?: number; cap?: number; floor?: number }> = {
  ironhands_official: { multiplier: 2.5 },
  safeplay_bot:       { cap: 150 },
  wildcard_za:        { floor: 50 },
};
