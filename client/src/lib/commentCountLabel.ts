export const COMMENT_COUNT_WORDS = {
  Discussion: ["discussion", "discussions"],
  Comments: ["comment", "comments"],
  Insights: ["insight", "insights"],
  Replies: ["reply", "replies"],
} as const;

export type CommentCountLabel = keyof typeof COMMENT_COUNT_WORDS;

/** "1 discussion", "3 discussions", "0 discussions". */
export function inlineCommentCount(count: number, label: CommentCountLabel): string {
  const [singular, plural] = COMMENT_COUNT_WORDS[label];
  const word = count === 1 ? singular : plural;
  return `${count} ${word}`;
}
