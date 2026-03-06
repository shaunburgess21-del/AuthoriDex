/**
 * Opinion Polls CSV Import Script
 *
 * Usage: npx tsx scripts/import-opinion-polls.ts [path-to-csv]
 *
 * CSV columns: headline, slug, category, description,
 *   option_A_name, option_A_seed, option_B_name, option_B_seed, ... through option_T_name, option_T_seed
 *
 * - Inserts into opinion_polls and opinion_poll_options (not trending_polls).
 * - Skips rows when a poll with the same slug already exists (no update).
 * - Only inserts options where option_X_name is not blank.
 * - visibility = "live", featured = false for all.
 * - imageUrl = [SUPABASE_URL]/storage/v1/object/public/opinion-polls/[slug]/1.webp
 * - If an option name matches a row in tracked_people, sets that option's person_id.
 *
 * Env: DATABASE_URL (required), SUPABASE_URL (optional, for image URLs).
 * Same pattern as import-sentiment-polls.ts — no dotenv; set in shell or .env loaded by runner.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { db } from "../server/db";
import { opinionPolls, opinionPollOptions, trackedPeople } from "../shared/schema";
import { eq } from "drizzle-orm";

const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRST".split("");

const VALID_CATEGORIES = new Set([
  "Tech",
  "Politics",
  "Business",
  "Music",
  "Sports",
  "Film & TV",
  "Gaming",
  "Creator",
  "misc",
  "Food & Drink",
  "Lifestyle",
]);

const CATEGORY_MAP: Record<string, string> = {
  "custom topic": "misc",
  "custom": "misc",
  "misc": "misc",
  "tech": "Tech",
  "politics": "Politics",
  "business": "Business",
  "music": "Music",
  "sports": "Sports",
  "sport": "Sports",
  "acting": "Film & TV",
  "film-tv": "Film & TV",
  "film & tv": "Film & TV",
  "gaming": "Gaming",
  "creator": "Creator",
  "food-drink": "Food & Drink",
  "food & drink": "Food & Drink",
  "lifestyle": "Lifestyle",
};

function normalizeCategory(raw: string): string | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (CATEGORY_MAP[lower]) return CATEGORY_MAP[lower];
  const canonical = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  if (VALID_CATEGORIES.has(canonical)) return canonical;
  if (VALID_CATEGORIES.has(trimmed)) return trimmed;
  return null;
}

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < content.length) {
    const row: string[] = [];
    while (i < content.length && content[i] !== "\n") {
      if (content[i] === '"') {
        let cell = "";
        i++;
        while (i < content.length) {
          if (content[i] === '"' && content[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else if (content[i] === '"') {
            i++;
            break;
          } else {
            cell += content[i];
            i++;
          }
        }
        row.push(cell);
        if (i < content.length && content[i] === ",") i++;
      } else {
        let cell = "";
        while (i < content.length && content[i] !== "," && content[i] !== "\n") {
          cell += content[i];
          i++;
        }
        row.push(cell.trim());
        if (i < content.length && content[i] === ",") i++;
      }
    }
    if (content[i] === "\n") i++;
    if (row.length > 0 && row.some((c) => c !== "")) {
      rows.push(row);
    }
  }
  return rows;
}

function parseSeedInt(raw: string, rowNum: number, optionLabel: string, warnings: string[]): number {
  const trimmed = raw?.trim() || "";
  if (!trimmed) return 0;
  const val = parseInt(trimmed, 10);
  if (isNaN(val)) {
    warnings.push(`Row ${rowNum} option ${optionLabel}: Invalid seed "${trimmed}", using 0`);
    return 0;
  }
  if (val < 0) {
    warnings.push(`Row ${rowNum} option ${optionLabel}: Negative seed ${val}, clamping to 0`);
    return 0;
  }
  return val;
}

/** Slugify option name for option image path: lowercase, spaces → hyphens, special chars removed. */
function slugifyOptionName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function main() {
  const csvPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve("opinion_polls.csv");

  console.log(`\n=== Opinion Polls CSV Import ===`);
  console.log(`Reading: ${csvPath}\n`);

  let content: string;
  try {
    content = readFileSync(csvPath, "utf-8");
  } catch (err: any) {
    console.error(`ERROR: Cannot read file: ${err.message}`);
    process.exit(1);
  }

  const allRows = parseCSV(content);
  if (allRows.length < 2) {
    console.error("ERROR: CSV has no data rows");
    process.exit(1);
  }

  const headers = allRows[0].map((h) => h.trim().toLowerCase());
  console.log("First row (headers) as seen by script:", JSON.stringify(allRows[0]));
  console.log("Normalized headers:", JSON.stringify(headers));

  const idx: Record<string, number> = {
    headline: headers.findIndex((h) => h === "headline"),
    slug: headers.findIndex((h) => h === "slug"),
    category: headers.findIndex((h) => h === "category"),
    description: headers.findIndex((h) => h === "description"),
  };

  const optionCols: { letter: string; nameIdx: number; seedIdx: number }[] = [];
  for (const letter of OPTION_LETTERS) {
    const lower = letter.toLowerCase();
    const nameIdx = headers.findIndex((h) => h === `option_${lower}_name`);
    const seedIdx = headers.findIndex((h) => h === `option_${lower}_seed`);
    if (nameIdx >= 0 && seedIdx >= 0) {
      optionCols.push({ letter, nameIdx, seedIdx });
    }
  }

  console.log(
    `Column mapping: headline=${idx.headline}, slug=${idx.slug}, category=${idx.category}, description=${idx.description}`
  );
  console.log(`Option columns: ${optionCols.length} (${optionCols.map((c) => c.letter).join(", ")})\n`);

  const allPeople = await db
    .select({ id: trackedPeople.id, name: trackedPeople.name })
    .from(trackedPeople);
  const peopleByName = new Map<string, string>();
  for (const p of allPeople) {
    peopleByName.set(p.name.toLowerCase().trim(), p.id);
  }
  console.log(`Loaded ${allPeople.length} tracked people for option name matching\n`);

  const dataRows = allRows.slice(1);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  const SUPABASE_URL = process.env.SUPABASE_URL || "";
  if (!SUPABASE_URL && dataRows.length > 0) {
    warnings.push(
      "SUPABASE_URL not set: poll imageUrl will be left blank (set env for opinion-polls bucket URLs)."
    );
  }

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2;
    const row = dataRows[i];

    const rawCategory = row[idx.category]?.trim() || "";
    const category = normalizeCategory(rawCategory);
    if (!category) {
      errors.push(`Row ${rowNum}: Unrecognized category "${rawCategory}" — skipping`);
      skipped++;
      continue;
    }

    const headline = row[idx.headline]?.trim() || "";
    const slug = row[idx.slug]?.trim().toLowerCase() || "";
    const description = row[idx.description]?.trim() || "";

    if (!headline || !slug) {
      errors.push(`Row ${rowNum}: Missing headline or slug — skipping`);
      skipped++;
      continue;
    }

    const [existingBySlug] = await db
      .select({ id: opinionPolls.id })
      .from(opinionPolls)
      .where(eq(opinionPolls.slug, slug));

    if (existingBySlug) {
      const imageUrl = SUPABASE_URL
        ? `${SUPABASE_URL}/storage/v1/object/public/opinion-polls/${slug}/1.webp`
        : null;
      try {
        await db
          .update(opinionPolls)
          .set({ imageUrl, updatedAt: new Date() })
          .where(eq(opinionPolls.id, existingBySlug.id));
        updated++;
      } catch (err: any) {
        errors.push(`Row ${rowNum} (slug: ${slug}): Update imageUrl error — ${err.message}`);
        skipped++;
      }
      continue;
    }

    const options: { name: string; seedCount: number; personId: string | null }[] = [];
    for (const { letter, nameIdx, seedIdx } of optionCols) {
      const name = row[nameIdx]?.trim() || "";
      if (!name) continue;
      const seedCount = parseSeedInt(row[seedIdx], rowNum, letter, warnings);
      const personId = peopleByName.get(name.toLowerCase()) || null;
      options.push({ name, seedCount, personId });
    }

    if (options.length < 3) {
      errors.push(`Row ${rowNum} (slug: ${slug}): Need at least 3 options with names — skipping`);
      skipped++;
      continue;
    }

    const imageUrl = SUPABASE_URL
      ? `${SUPABASE_URL}/storage/v1/object/public/opinion-polls/${slug}/1.webp`
      : null;

    try {
      const [createdPoll] = await db
        .insert(opinionPolls)
        .values({
          title: headline,
          slug,
          category,
          description: description || null,
          imageUrl,
          featured: false,
          visibility: "live",
        })
        .returning({ id: opinionPolls.id });

      if (!createdPoll) {
        errors.push(`Row ${rowNum} (slug: ${slug}): Insert returned no id`);
        skipped++;
        continue;
      }

      for (let o = 0; o < options.length; o++) {
        const opt = options[o];
        // TODO: uncomment when option images are uploaded to Supabase
        // Option image path: opinion-polls/[poll-slug]/[option-slug].webp
        // const optionImageUrl = SUPABASE_URL
        //   ? `${SUPABASE_URL}/storage/v1/object/public/opinion-polls/${slug}/${slugifyOptionName(opt.name)}.webp`
        //   : null;
        await db.insert(opinionPollOptions).values({
          pollId: createdPoll.id,
          name: opt.name,
          imageUrl: null, // set optionImageUrl when option images are in Supabase
          personId: opt.personId,
          orderIndex: o,
          seedCount: opt.seedCount,
        });
      }
      created++;
    } catch (err: any) {
      errors.push(`Row ${rowNum} (slug: ${slug}): DB error — ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`Total rows processed: ${dataRows.length}`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated (imageUrl): ${updated}`);
  console.log(`  Skipped (duplicate slug or error): ${skipped}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Errors: ${errors.length}`);

  if (warnings.length > 0) {
    console.log(`\nWarnings:`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    errors.forEach((e) => console.log(`  - ${e}`));
  }

  console.log(`\nDone.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
