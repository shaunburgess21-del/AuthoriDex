/**
 * Unique ballots behind "Votes Cast" and the vote-count badges.
 *
 * One row per target counts as one ballot. Changing a rating, matchup
 * side, or curate photo updates that row and does not add another.
 * The list is every surface the vote hub (and the older value / daily
 * sentiment writers) persist. Overall rating lives in `user_votes` and
 * was missing from the old counter.
 */
export const USER_BALLOT_SOURCES = [
  { id: "matchup", table: "votes", filter: "vote_type = 'face_off'" },
  { id: "sentiment", table: "trending_poll_votes" },
  { id: "opinion", table: "opinion_poll_votes" },
  { id: "overall_rating", table: "user_votes" },
  { id: "induction", table: "induction_votes" },
  { id: "curate", table: "image_votes" },
  { id: "value", table: "celebrity_value_votes" },
  { id: "legacy_sentiment", table: "sentiment_votes" },
] as const;

export type UserBallotSourceId = (typeof USER_BALLOT_SOURCES)[number]["id"];

const TABLE_NAME = /^[a-z_]+$/;
const ALLOWED_FILTER = /^vote_type = 'face_off'$/;

export function assertBallotSourceSafe(source: { table: string; filter?: string }): void {
  if (!TABLE_NAME.test(source.table)) {
    throw new Error(`Refusing ballot count for table ${source.table}`);
  }
  if (source.filter && !ALLOWED_FILTER.test(source.filter)) {
    throw new Error(`Refusing ballot count filter ${source.filter}`);
  }
}

/** Vote-count badge ladder. Thresholds match shared/badge-config.ts. */
export const VOTE_COUNT_BADGE_THRESHOLDS = [
  { threshold: 1, key: "first_vote" },
  { threshold: 25, key: "quarter_century" },
  { threshold: 100, key: "century_citizen" },
  { threshold: 500, key: "dedicated_voter" },
  { threshold: 1000, key: "voxmax_voter" },
  { threshold: 10000, key: "legend_of_ballot" },
] as const;

export function badgeKeysForVoteTotal(total: number): string[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  return VOTE_COUNT_BADGE_THRESHOLDS.filter((tier) => total >= tier.threshold).map((tier) => tier.key);
}

export function sumBallotCounts(counts: readonly number[]): number {
  return counts.reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);
}
