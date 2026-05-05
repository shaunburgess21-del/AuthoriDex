export const VOTE_TAB_VOTE_TYPES = [
  "face_off",
  "sentiment",
  "value_vote",
  "overall_rating",
  "trending_poll",
  "opinion_poll",
  "image_curate",
  "induction",
] as const;

export type VoteTabVoteType = (typeof VOTE_TAB_VOTE_TYPES)[number];

const VOTE_TAB_SET = new Set<string>(VOTE_TAB_VOTE_TYPES);

export function isVoteTabVoteType(value: string): value is VoteTabVoteType {
  return VOTE_TAB_SET.has(value);
}
