/**
 * Quiet post-vote line under result bars.
 *
 * The percents are the ones already painted on the card. A race whose
 * top two shares sit within CROWD_SPLIT_THRESHOLD_PP of each other is a
 * split, including an exact tie. Otherwise the user's share is either
 * the clear lead or the minority.
 */

export const CROWD_SPLIT_THRESHOLD_PP = 5;

export type CrowdLineKind = "majority" | "minority" | "split" | "rating";

export interface CrowdLineOption {
  key: string;
  percent: number;
}

export interface CrowdLine {
  kind: CrowdLineKind;
  text: string;
  /** The user's share, rounded the same way the bars show it. */
  userPercent: number;
}

function finitePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * True when the two largest shares are within `threshold` points.
 * A single option, or a field with no votes, is not a split.
 */
export function isCrowdSplit(
  percents: readonly number[],
  threshold: number = CROWD_SPLIT_THRESHOLD_PP,
): boolean {
  const ranked = percents
    .map(finitePercent)
    .filter((percent) => percent > 0)
    .sort((a, b) => b - a);
  if (ranked.length < 2) return false;
  return ranked[0] - ranked[1] <= threshold;
}

/**
 * Choice cards (matchup, agree/disagree, opinion). Returns null when
 * the user has no option or every share is empty — the slot still
 * reserves its line so the card does not jump.
 */
export function choiceCrowdLine(
  options: readonly CrowdLineOption[],
  userKey: string | null | undefined,
): CrowdLine | null {
  if (!userKey) return null;
  const user = options.find((option) => option.key === userKey);
  if (!user) return null;
  const percents = options.map((option) => finitePercent(option.percent));
  if (percents.every((percent) => percent <= 0)) return null;
  const userPercent = Math.round(finitePercent(user.percent));
  if (isCrowdSplit(percents)) {
    return { kind: "split", text: "The crowd is split", userPercent };
  }
  const leader = Math.max(...percents);
  const userIsLeader = finitePercent(user.percent) === leader && leader > 0;
  if (userIsLeader) {
    return {
      kind: "majority",
      text: `You're with the majority (${userPercent}%)`,
      userPercent,
    };
  }
  return {
    kind: "minority",
    text: `Only ${userPercent}% agreed with you`,
    userPercent,
  };
}

/**
 * Rating cards. The share is the user's 1–5 bucket, already on the
 * bars. A close top of the distribution still reads as a split.
 * Otherwise the line is that bucket's share — no invented average.
 */
export function ratingCrowdLine(
  bucketPercents: readonly number[],
  userRating: number | null | undefined,
): CrowdLine | null {
  if (userRating == null || !Number.isFinite(userRating)) return null;
  const index = Math.round(userRating) - 1;
  if (index < 0 || index >= bucketPercents.length) return null;
  const percents = bucketPercents.map(finitePercent);
  if (percents.every((percent) => percent <= 0)) return null;
  const userPercent = Math.round(percents[index] ?? 0);
  if (isCrowdSplit(percents)) {
    return { kind: "split", text: "The crowd is split", userPercent };
  }
  return {
    kind: "rating",
    text: `${userPercent}% rated it like you`,
    userPercent,
  };
}
