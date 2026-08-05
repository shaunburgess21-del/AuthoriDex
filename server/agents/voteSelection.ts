/**
 * Pure selection helpers for the agent vote sweep.
 *
 * Lives in its own module with NO side-effect imports (no `../db`, no schema)
 * so unit tests can exercise the weighting without dragging in a DB connection
 * attempt at module-load time. Same split as `drainBreaker-evaluate.ts`.
 *
 * See `voteWorker.ts` for the DB-reading shell that consumes these.
 */

/**
 * Attach each card's real (non-seed) vote count so selection can favour the
 * emptiest cards. Seed counts are deliberately excluded: they're an admin
 * display lever, whereas this is about directing genuine activity to cards
 * that have none.
 */
export function attachVoteCounts<T extends { id: string }>(
  candidates: T[],
  counts: Array<{ id: string | null; c: number | string }>,
): Array<T & { voteCount: number }> {
  const byId = new Map(
    counts
      .filter((row): row is { id: string; c: number | string } => row.id != null)
      .map((row) => [row.id, Number(row.c || 0)]),
  );
  return candidates.map((c) => ({ ...c, voteCount: byId.get(c.id) ?? 0 }));
}

/**
 * Pick a card, weighted toward the ones with the fewest real votes.
 *
 * Replaces uniform random selection, which spread the cohort's very small vote
 * budget evenly over every eligible card. With ~90 live cards of each type and
 * only ~40 agent votes a week reaching a given type, a newly published card
 * averaged well under one vote per week while months-old cards kept accruing —
 * so new cards looked dead for weeks (the Jul 2026 sentiment-poll cohort
 * averaged 1 vote against 5–19 for older cohorts).
 *
 * Weight is `1 / (votes + 1)`: an empty card is ~10x likelier to be picked than
 * one with nine votes, and the advantage decays on its own as the card fills.
 * No threshold to tune, and no lasting bias once the inventory is evenly
 * populated. Total vote volume is unchanged — this only redistributes where
 * votes land, so the pacing the simulation profiles set is untouched.
 *
 * Throws on an empty list rather than returning `undefined` behind a `T`
 * signature. Every caller already guards with `if (!eligible.length) continue`,
 * so this only fires if a future one forgets — and an explicit error beats a
 * `Cannot read properties of undefined` surfacing later inside a vote
 * transaction. The vote sweep catches per agent, so a throw here costs that
 * agent's turn, not the sweep.
 */
export function pickLeastVotedFirst<T extends { voteCount: number }>(
  candidates: T[],
): T {
  if (!candidates.length) {
    throw new Error("pickLeastVotedFirst called with no candidates");
  }
  const weights = candidates.map((c) => 1 / (Math.max(0, c.voteCount) + 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  // Every weight is > 0, so the loop always returns for a non-empty list. This
  // is only reachable via floating-point drift leaving `roll` a hair above 0.
  return candidates[candidates.length - 1];
}

/**
 * Selection weight for a given vote count. Exported for tests and for anyone
 * reasoning about how strong the bias is at a particular count.
 */
export function selectionWeight(voteCount: number): number {
  return 1 / (Math.max(0, voteCount) + 1);
}
