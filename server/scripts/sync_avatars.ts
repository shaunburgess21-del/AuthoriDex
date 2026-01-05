import { db } from "../db";
import { trackedPeople, celebrityImages } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

async function syncAvatars() {
  console.log("Starting avatar sync from celebrity_images to tracked_people...\n");

  const people = await db.select().from(trackedPeople);
  console.log(`Found ${people.length} tracked celebrities\n`);

  let updated = 0;
  let skipped = 0;
  let noImage = 0;

  for (const person of people) {
    const images = await db
      .select()
      .from(celebrityImages)
      .where(eq(celebrityImages.personId, person.id))
      .orderBy(
        desc(celebrityImages.isPrimary),
        desc(sql`(${celebrityImages.votesUp} - ${celebrityImages.votesDown})`)
      )
      .limit(1);

    if (images.length === 0) {
      console.log(`  ⚠ ${person.name}: No images found in celebrity_images`);
      noImage++;
      continue;
    }

    const primaryImage = images[0];
    
    if (person.avatar === primaryImage.imageUrl) {
      console.log(`  ✓ ${person.name}: Avatar already up to date`);
      skipped++;
      continue;
    }

    await db
      .update(trackedPeople)
      .set({ avatar: primaryImage.imageUrl })
      .where(eq(trackedPeople.id, person.id));

    console.log(`  ✓ ${person.name}: Updated avatar`);
    console.log(`    Old: ${person.avatar || "(empty)"}`);
    console.log(`    New: ${primaryImage.imageUrl}`);
    updated++;
  }

  console.log("\n--- Sync Complete ---");
  console.log(`Updated: ${updated}`);
  console.log(`Already current: ${skipped}`);
  console.log(`No images found: ${noImage}`);
  console.log(`Total processed: ${people.length}`);
}

syncAvatars()
  .then(() => {
    console.log("\nAvatar sync completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error syncing avatars:", error);
    process.exit(1);
  });
