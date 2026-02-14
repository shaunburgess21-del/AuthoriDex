/**
 * Avatar Hydration Script
 * 
 * Updates matchups and other active game data with fresh avatar URLs from tracked_people.
 * This fixes stale/empty avatar URLs in snapshot columns.
 * 
 * Usage: npx tsx scripts/refresh_active_cards.ts
 */

import { db } from "../server/db";
import { trackedPeople, matchups } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

async function refreshActiveCards() {
  console.log("🔄 Starting Avatar Hydration...\n");

  let updatedMatchups = 0;
  let skippedMatchups = 0;

  try {
    // Step 1: Get all celebrities with their fresh avatars
    const celebrities = await db.select({
      name: trackedPeople.name,
      avatar: trackedPeople.avatar,
    }).from(trackedPeople);

    // Create a lookup map (name -> avatar URL)
    const avatarMap: Record<string, string | null> = {};
    for (const celeb of celebrities) {
      avatarMap[celeb.name.toLowerCase()] = celeb.avatar;
    }
    
    console.log(`📋 Loaded ${celebrities.length} celebrity avatars\n`);

    // Step 2: Update Matchups
    console.log("🎭 Updating Matchups...");
    const allMatchups = await db.select().from(matchups);

    for (const matchup of allMatchups) {
      let needsUpdate = false;
      let newOptionAImage = matchup.optionAImage;
      let newOptionBImage = matchup.optionBImage;

      // Try to match option A text to a celebrity name
      const optionAKey = matchup.optionAText.toLowerCase();
      if (avatarMap[optionAKey] && avatarMap[optionAKey] !== matchup.optionAImage) {
        newOptionAImage = avatarMap[optionAKey];
        needsUpdate = true;
      }

      // Try to match option B text to a celebrity name
      const optionBKey = matchup.optionBText.toLowerCase();
      if (avatarMap[optionBKey] && avatarMap[optionBKey] !== matchup.optionBImage) {
        newOptionBImage = avatarMap[optionBKey];
        needsUpdate = true;
      }

      if (needsUpdate) {
        await db.update(matchups)
          .set({
            optionAImage: newOptionAImage,
            optionBImage: newOptionBImage,
          })
          .where(eq(matchups.id, matchup.id));

        console.log(`  ✅ Updated: "${matchup.title}" (${matchup.optionAText} vs ${matchup.optionBText})`);
        updatedMatchups++;
      } else {
        skippedMatchups++;
      }
    }

    console.log(`\n📊 Matchup Summary:`);
    console.log(`   ✅ Updated: ${updatedMatchups}`);
    console.log(`   ⏭️  Skipped: ${skippedMatchups} (no matching celebrity or already up-to-date)`);

    console.log("\n🎉 Avatar Hydration Complete!");

  } catch (error: any) {
    console.error("❌ Fatal error:", error.message);
    throw error;
  }
}

// Run the hydration
refreshActiveCards()
  .then(() => {
    console.log("\n✅ Script finished successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
