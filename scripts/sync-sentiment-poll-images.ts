/**
 * One-time script to clear stale convention-based image URLs from sentiment polls.
 * After clearing, the server auto-derives URLs from the current slug.
 *
 * Usage: npx tsx scripts/sync-sentiment-poll-images.ts
 */

import { db } from "../server/db";
import { trendingPolls } from "../shared/schema";
import { eq, isNull } from "drizzle-orm";

async function main() {
  const polls = await db.select({
    id: trendingPolls.id,
    headline: trendingPolls.headline,
    slug: trendingPolls.slug,
    imageUrl: trendingPolls.imageUrl,
    personId: trendingPolls.personId,
  }).from(trendingPolls);

  console.log(`Found ${polls.length} total sentiment polls`);

  let cleared = 0;
  for (const p of polls) {
    if (!p.personId && p.imageUrl && p.imageUrl.includes('/sentiment-polls/') && p.imageUrl.endsWith('/1.webp')) {
      console.log(`  Clearing: "${p.headline}" (slug: ${p.slug})`);
      console.log(`    Old URL: ${p.imageUrl}`);
      await db.update(trendingPolls)
        .set({ imageUrl: null })
        .where(eq(trendingPolls.id, p.id));
      cleared++;
    }
  }

  console.log(`\nCleared ${cleared} stale image URLs out of ${polls.length} polls.`);
  console.log("The server will now auto-derive URLs from the current slug.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
