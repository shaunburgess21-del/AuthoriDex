/**
 * How big a trend score is. Shared by the score engine and the client so a
 * jackpot guess the form accepts is a guess the server accepts.
 *
 * The composite is a 0..100 number. Multiply by `FAME_INDEX_SCALE` to get the
 * integer on the leaderboard. Nov 2026: the scale went from x10,000 (ceiling
 * 1,000,000) to x1,000 (ceiling 100,000). Ranks and percentage moves do not
 * depend on it; anything that compares an absolute score does.
 */

/** Multiplier applied to the 0..100 composite to produce the Fame Index. */
export const FAME_INDEX_SCALE = 1_000;

/** Hard ceiling for a Fame Index (composite of 100). */
export const FAME_INDEX_MAX = 100 * FAME_INDEX_SCALE;

/**
 * Highest jackpot guess accepted. Twice the engine ceiling, so a breakout
 * week still fits and an absurd guess cannot decide "closest number".
 */
export const JACKPOT_MAX_PREDICTED_SCORE = 2 * FAME_INDEX_MAX;
