/**
 * Avatar Hydration Script
 * 
 * Updates face-offs and other active game data with fresh avatar URLs from tracked_people.
 * This fixes stale/empty avatar URLs in snapshot columns.
 * 
 * Usage: npx tsx scripts/refresh_active_cards.ts
 */

import { db } from "../server/db";
import { trackedPeople, faceOffs } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

async function refreshActiveCards() {
  console.log("🔄 Starting Avatar Hydration...\n");

  let updatedFaceOffs = 0;
  let skippedFaceOffs = 0;

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

    // Step 2: Update Face-Offs
    console.log("🎭 Updating Face-Offs...");
    const allFaceOffs = await db.select().from(faceOffs);

    for (const faceOff of allFaceOffs) {
      let needsUpdate = false;
      let newOptionAImage = faceOff.optionAImage;
      let newOptionBImage = faceOff.optionBImage;

      // Try to match option A text to a celebrity name
      const optionAKey = faceOff.optionAText.toLowerCase();
      if (avatarMap[optionAKey] && avatarMap[optionAKey] !== faceOff.optionAImage) {
        newOptionAImage = avatarMap[optionAKey];
        needsUpdate = true;
      }

      // Try to match option B text to a celebrity name
      const optionBKey = faceOff.optionBText.toLowerCase();
      if (avatarMap[optionBKey] && avatarMap[optionBKey] !== faceOff.optionBImage) {
        newOptionBImage = avatarMap[optionBKey];
        needsUpdate = true;
      }

      if (needsUpdate) {
        await db.update(faceOffs)
          .set({
            optionAImage: newOptionAImage,
            optionBImage: newOptionBImage,
          })
          .where(eq(faceOffs.id, faceOff.id));

        console.log(`  ✅ Updated: "${faceOff.title}" (${faceOff.optionAText} vs ${faceOff.optionBText})`);
        updatedFaceOffs++;
      } else {
        skippedFaceOffs++;
      }
    }

    console.log(`\n📊 Face-Off Summary:`);
    console.log(`   ✅ Updated: ${updatedFaceOffs}`);
    console.log(`   ⏭️  Skipped: ${skippedFaceOffs} (no matching celebrity or already up-to-date)`);

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
