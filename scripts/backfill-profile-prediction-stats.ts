/**
 * Recompute profiles.win_rate and profiles.total_predictions from
 * user-facing market_bets (same rules as /api/me/predictions).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-profile-prediction-stats.ts
 *   npx tsx --env-file=.env scripts/backfill-profile-prediction-stats.ts --execute
 */

import { pool } from "../server/db";
import {
  computeUserFacingPredictionStats,
  syncProfilePredictionStats,
} from "../server/services/profile-prediction-stats";

const EXECUTE = process.argv.includes("--execute");

async function main() {
  const client = await pool.connect();
  try {
    const { rows: userRows } = await client.query<{ id: string }>(`
      SELECT DISTINCT user_id AS id
      FROM market_bets
      ORDER BY user_id
    `);

    console.log(
      `[backfill-profile-prediction-stats] ${EXECUTE ? "EXECUTE" : "DRY-RUN"} — ${userRows.length} users with bets`,
    );

    let changed = 0;
    for (const { id: userId } of userRows) {
      const { rows: beforeRows } = await client.query<{
        win_rate: number;
        total_predictions: number;
      }>(
        `SELECT win_rate, total_predictions FROM profiles WHERE id = $1`,
        [userId],
      );
      const before = beforeRows[0];
      if (!before) continue;

      const stats = await computeUserFacingPredictionStats(userId);

      const winRateDelta = Math.abs((before.win_rate ?? 0) - stats.winRate) > 0.05;
      const totalDelta = (before.total_predictions ?? 0) !== stats.total;
      if (!winRateDelta && !totalDelta) continue;

      changed += 1;
      console.log(
        `  ${userId}: win_rate ${before.win_rate}% -> ${stats.winRate}%, total_predictions ${before.total_predictions} -> ${stats.total}`,
      );

      if (EXECUTE) {
        await syncProfilePredictionStats(userId);
      }
    }

    console.log(
      `[backfill-profile-prediction-stats] Done. ${changed} profile(s) would ${EXECUTE ? "were" : "be"} updated.`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
