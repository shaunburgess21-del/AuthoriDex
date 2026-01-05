import { db } from "../db";
import { trackedPeople, celebrityImages } from "@shared/schema";
import { eq } from "drizzle-orm";

const SUPABASE_URL = process.env.SUPABASE_URL;
const BUCKET_NAME = "celebrity_images";
const IMAGES_PER_CELEBRITY = 5;

function wikiSlugToFolderSlug(wikiSlug: string | null): string {
  if (!wikiSlug) return "";
  return wikiSlug
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function seedCelebrityImages() {
  if (!SUPABASE_URL) {
    console.error("ERROR: SUPABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("Starting celebrity image seeding...");
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Images per celebrity: ${IMAGES_PER_CELEBRITY}`);
  console.log("");

  const people = await db.select().from(trackedPeople).where(eq(trackedPeople.status, "main_leaderboard"));
  
  console.log(`Found ${people.length} celebrities on main leaderboard\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let errors: string[] = [];

  for (const person of people) {
    const slug = wikiSlugToFolderSlug(person.wikiSlug);
    if (!slug) {
      console.log(`  ⚠ ${person.name}: No wikiSlug, skipping`);
      continue;
    }
    console.log(`Processing: ${person.name} (wikiSlug: ${person.wikiSlug} → folder: ${slug})`);

    for (let i = 1; i <= IMAGES_PER_CELEBRITY; i++) {
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${slug}/${i}.png`;
      
      try {
        const existing = await db.select()
          .from(celebrityImages)
          .where(eq(celebrityImages.imageUrl, imageUrl))
          .limit(1);
        
        if (existing.length > 0) {
          console.log(`  ⏭ Image ${i} already exists, skipping`);
          totalSkipped++;
          continue;
        }

        await db.insert(celebrityImages).values({
          personId: person.id,
          imageUrl: imageUrl,
          source: "admin_upload",
          isPrimary: i === 1,
        });
        
        console.log(`  ✓ Added image ${i}${i === 1 ? " (primary)" : ""}`);
        totalInserted++;
      } catch (error) {
        const errorMsg = `Failed to insert image ${i} for ${person.name}: ${error}`;
        console.log(`  ✗ ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
  }

  console.log("\n========================================");
  console.log("SEEDING COMPLETE");
  console.log("========================================");
  console.log(`Total images inserted: ${totalInserted}`);
  console.log(`Total images skipped: ${totalSkipped}`);
  console.log(`Total errors: ${errors.length}`);
  
  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach(e => console.log(`  - ${e}`));
  }
}

seedCelebrityImages()
  .then(() => {
    console.log("\nScript finished successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
