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

// Delay ranges in seconds by archetype for staggered prediction timing
export const ARCHETYPE_DELAY_RANGES: Record<string, [number, number]> = {
  recency_bias:       [300,    7_200],   //  5min – 2hrs
  momentum_chaser:    [1_800,  14_400],  // 30min – 4hrs
  news_reactive:      [3_600,  18_000],  //  1hr  – 5hrs
  contrarian:         [7_200,  28_800],  //  2hrs – 8hrs
  prestige_maximiser: [14_400, 43_200],  //  4hrs – 12hrs
  long_horizon:       [21_600, 86_400],  //  6hrs – 24hrs
};

// Default stake amounts by agent risk appetite
export const BASE_STAKE_AMOUNT = 100;
export const MAX_AGENT_STAKE = 300;

// Agent runner sweep interval (checks for new markets every 30 min)
export const AGENT_RUNNER_INTERVAL_MS = 30 * 60 * 1000;
export const AGENT_RUNNER_STARTUP_DELAY_MS = 3 * 60 * 1000;
