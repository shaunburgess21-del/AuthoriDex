/**
 * Sentiment Polls CSV Import Script
 *
 * Usage: npx tsx scripts/import-sentiment-polls.ts [path-to-csv]
 *
 * CSV columns: headline, slug, category, question, linked_celebrity, support_seed, neutral_seed, oppose_seed
 * - If a poll with the same slug exists: UPDATE seed counts, person_id, image_url only (do not change headline, slug, visibility, status).
 * - If slug does not exist: INSERT new poll with visibility/status "live"; featured = true if headline contains "Elon" or row is in top 10.
 * - imageUrl set to [SUPABASE_URL]/storage/v1/object/public/sentiment-polls/[slug]/1.webp only when
 *   there is no linked_celebrity (otherwise left blank for app to use celebrity image).
 *
 * Default path: attached_assets/sentiment_polls_upload_v2_1772042536028.csv
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { db } from "../server/db";
import { trendingPolls, trackedPeople } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

const VALID_CATEGORIES = new Set(["Tech", "Politics", "Business", "Music", "Sports", "Film & TV", "Gaming", "Creator", "misc", "Food & Drink", "Lifestyle"]);

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
    while (i < content.length && content[i] !== '\n') {
      if (content[i] === '"') {
        let cell = '';
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
        if (i < content.length && content[i] === ',') i++;
      } else {
        let cell = '';
        while (i < content.length && content[i] !== ',' && content[i] !== '\n') {
          cell += content[i];
          i++;
        }
        row.push(cell.trim());
        if (i < content.length && content[i] === ',') i++;
      }
    }
    if (content[i] === '\n') i++;
    if (row.length > 0 && row.some(c => c !== '')) {
      rows.push(row);
    }
  }
  return rows;
}

function parseSeedInt(raw: string, rowNum: number, field: string, warnings: string[]): number {
  const trimmed = raw?.trim() || '';
  if (!trimmed) {
    warnings.push(`Row ${rowNum}: Missing "${field}", defaulting to 0`);
    return 0;
  }
  const val = parseInt(trimmed, 10);
  if (isNaN(val)) {
    warnings.push(`Row ${rowNum}: Invalid "${field}" value "${trimmed}", defaulting to 0`);
    return 0;
  }
  if (val < 0) {
    warnings.push(`Row ${rowNum}: Negative "${field}" value ${val}, clamping to 0`);
    return 0;
  }
  return val;
}

async function main() {
  const csvPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve("attached_assets/sentiment_polls_upload_v2_1772042536028.csv");

  console.log(`\n=== Sentiment Polls CSV Import ===`);
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

  const headers = allRows[0].map(h => h.trim().toLowerCase());
  console.log(`CSV headers: ${headers.join(', ')}`);

  const idx = {
    category: headers.findIndex(h => h === 'category'),
    headline: headers.findIndex(h => h === 'headline'),
    slug: headers.findIndex(h => h === 'slug'),
    subjectText: headers.findIndex(h => h.replace(/[\s/]+/g, '').includes('subject') || h.includes('question')),
    description: headers.findIndex(h => h === 'description'),
    celebrity: headers.findIndex(h => h.includes('celebrity') || h.includes('linked')),
    seedSupport: headers.findIndex(h => h.includes('support') && (h.includes('seed') || true)),
    seedNeutral: headers.findIndex(h => h.includes('neutral')),
    seedOppose: headers.findIndex(h => h.includes('oppose')),
  };

  console.log(`Column mapping: category=${idx.category}, headline=${idx.headline}, slug=${idx.slug}, subjectText=${idx.subjectText}, description=${idx.description}, celebrity=${idx.celebrity}, seedSupport=${idx.seedSupport}, seedNeutral=${idx.seedNeutral}, seedOppose=${idx.seedOppose}\n`);

  const allPeople = await db.select({ id: trackedPeople.id, name: trackedPeople.name }).from(trackedPeople);
  const peopleByName = new Map<string, string>();
  for (const p of allPeople) {
    peopleByName.set(p.name.toLowerCase().trim(), p.id);
  }
  console.log(`Loaded ${allPeople.length} tracked people for celebrity matching\n`);

  const dataRows = allRows.slice(1);
  let created = 0, updated = 0, skipped = 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  const SUPABASE_URL = process.env.SUPABASE_URL || "";
  if (!SUPABASE_URL && dataRows.length > 0) {
    warnings.push("SUPABASE_URL not set: poll images will be left blank (set env for sentiment-polls bucket URLs).");
  }

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2;
    const row = dataRows[i];

    const rawCategory = row[idx.category]?.trim() || '';
    const category = normalizeCategory(rawCategory);
    if (!category) {
      errors.push(`Row ${rowNum}: Unrecognized category "${rawCategory}" — skipping`);
      skipped++;
      continue;
    }

    const headline = row[idx.headline]?.trim() || '';
    const slug = row[idx.slug]?.trim().toLowerCase() || '';
    const subjectText = row[idx.subjectText]?.trim() || headline;
    const description = row[idx.description]?.trim() || '';
    const rawCelebrity = row[idx.celebrity]?.trim() || '';

    if (!headline || !slug) {
      errors.push(`Row ${rowNum}: Missing headline or slug — skipping`);
      skipped++;
      continue;
    }

    const [existingBySlug] = await db.select({ id: trendingPolls.id }).from(trendingPolls).where(eq(trendingPolls.slug, slug));

    let personId: string | null = null;
    if (rawCelebrity) {
      const matched = peopleByName.get(rawCelebrity.toLowerCase().trim());
      if (matched) {
        personId = matched;
      } else {
        warnings.push(`Row ${rowNum}: Celebrity "${rawCelebrity}" not found in tracked_people — leaving unlinked`);
      }
    }

    const seedSupportCount = parseSeedInt(row[idx.seedSupport], rowNum, 'Seed Support', warnings);
    const seedNeutralCount = parseSeedInt(row[idx.seedNeutral], rowNum, 'Seed Neutral', warnings);
    const seedOpposeCount = parseSeedInt(row[idx.seedOppose], rowNum, 'Seed Oppose', warnings);

    const imageUrl = !personId && SUPABASE_URL
      ? `${SUPABASE_URL}/storage/v1/object/public/sentiment-polls/${slug}/1.webp`
      : null;

    if (existingBySlug) {
      try {
        await db
          .update(trendingPolls)
          .set({
            seedSupportCount,
            seedNeutralCount,
            seedOpposeCount,
            personId,
            imageUrl,
            updatedAt: new Date(),
          })
          .where(eq(trendingPolls.id, existingBySlug.id));
        updated++;
      } catch (err: any) {
        errors.push(`Row ${rowNum} (slug: ${slug}): Update error — ${err.message}`);
        skipped++;
      }
      continue;
    }

    const featured = headline.toLowerCase().includes("elon") || i < 10;

    try {
      await db.insert(trendingPolls).values({
        category,
        headline,
        slug,
        subjectText: subjectText || headline,
        description: description || null,
        personId,
        imageUrl,
        seedSupportCount,
        seedNeutralCount,
        seedOpposeCount,
        status: "live",
        visibility: "live",
        featured,
      });
      created++;
    } catch (err: any) {
      errors.push(`Row ${rowNum} (slug: ${slug}): DB error — ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`Total rows processed: ${dataRows.length}`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (error): ${skipped}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Errors: ${errors.length}`);

  if (warnings.length > 0) {
    console.log(`\nWarnings:`);
    warnings.forEach(w => console.log(`  - ${w}`));
  }

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    errors.forEach(e => console.log(`  - ${e}`));
  }

  const dbCount = await db.execute(sql`SELECT status, COUNT(*)::int as count FROM trending_polls GROUP BY status`);
  console.log(`\nDB state after import:`);
  const countRows = Array.isArray(dbCount) ? dbCount : (dbCount as { rows?: unknown[] }).rows ?? [];
  for (const row of countRows) {
    const r = row as { status: string; count: number };
    console.log(`  status="${r.status}": ${r.count} polls`);
  }

  console.log(`\nDone.\n`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
