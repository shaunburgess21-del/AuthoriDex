export type ImageVoteAction = 'noop' | 'insert' | 'swap';

/**
 * Decide what the POST /api/people/:personId/images/:imageId/vote handler
 * should do for this user on this person.
 *
 * - `insert`: user has no prior vote on any image for this person -> create a new row.
 * - `noop`:   user already voted for this exact image -> return alreadyVoted.
 * - `swap`:   user previously voted for a different image on this person -> move the
 *             vote to the new image (UPDATE in place; decrement old image's votes_up,
 *             increment new image's votes_up).
 */
export function classifyImageVoteAction(
  existing: { imageId: string } | null | undefined,
  targetImageId: string,
): ImageVoteAction {
  if (!existing) return 'insert';
  if (existing.imageId === targetImageId) return 'noop';
  return 'swap';
}
