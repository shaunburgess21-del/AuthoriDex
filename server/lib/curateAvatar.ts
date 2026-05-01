import { eq, asc, desc } from "drizzle-orm";
import { db } from "../db";
import { celebrityImages, trackedPeople, trendingPeople } from "@shared/schema";

/**
 * Recompute the curate-winning image for a person and propagate it to BOTH
 * `tracked_people.avatar` and `trending_people.avatar`. Also flips
 * `celebrity_images.is_primary` so it points at the current winner.
 *
 * The "winner" is the row in `celebrity_images` with the highest `votes_up`,
 * tie-broken by oldest `added_at`. This is the single source of truth used
 * across all surfaces of the app (leaderboard, sentiment polls, opinion polls,
 * predict cards, value cards, person detail).
 *
 * Safe to call repeatedly. Used by:
 *   - the curate-vote endpoint (after every vote)
 *   - the admin set-primary endpoint
 *   - the admin sync-curate-images backfill
 *   - the one-off heal script (`scripts/heal-curate-avatars.ts`)
 */
export async function syncWinningAvatarForPerson(personId: string): Promise<void> {
  const [topImage] = await db
    .select()
    .from(celebrityImages)
    .where(eq(celebrityImages.personId, personId))
    .orderBy(desc(celebrityImages.votesUp), asc(celebrityImages.addedAt))
    .limit(1);

  if (topImage) {
    console.log(
      `[AvatarSync] Person ${personId}: winning image ${topImage.id} ` +
      `(votesUp=${topImage.votesUp}, votesDown=${topImage.votesDown}, ` +
      `url=${topImage.imageUrl.substring(0, 60)}...)`
    );
    await db.update(celebrityImages).set({ isPrimary: false }).where(eq(celebrityImages.personId, personId));
    await db.update(celebrityImages).set({ isPrimary: true }).where(eq(celebrityImages.id, topImage.id));
    await db.update(trackedPeople).set({ avatar: topImage.imageUrl }).where(eq(trackedPeople.id, personId));
    await db.update(trendingPeople).set({ avatar: topImage.imageUrl }).where(eq(trendingPeople.id, personId));
  } else {
    await db.update(trackedPeople).set({ avatar: null }).where(eq(trackedPeople.id, personId));
    await db.update(trendingPeople).set({ avatar: null }).where(eq(trendingPeople.id, personId));
  }
}
