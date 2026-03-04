/**
 * Sentiment Polls CSV Import Script
 *
 * Usage: npx tsx scripts/import-sentiment-polls.ts [path-to-csv]
 *
 * Defaults to: attached_assets/sentiment_polls_upload_v2_1772042536028.csv
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { db } from "../server/db";
import { trendingPolls, trackedPeople } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

const VALID_CATEGORIES = new Set(["Tech", "Politics", "Business", "Music", "Sports", "Acting", "Gaming", "Creator", "misc"]);

const CATEGORY_MAP: Record<string, string> = {
  "custom topic": "misc",
  "custom": "misc",
  "misc": "misc",
  "tech": "Tech",
  "politics": "Politics",
  "business": "Business",
  "music": "Music",
  "sports": "Sports",
  "acting": "Acting",
  "gaming": "Gaming",
  "creator": "Creator",
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
    const subjectText = row[idx.subjectText]?.trim() || '';
    const description = row[idx.description]?.trim() || '';
    const rawCelebrity = row[idx.celebrity]?.trim() || '';

    if (!headline || !slug) {
      errors.push(`Row ${rowNum}: Missing headline or slug — skipping`);
      skipped++;
      continue;
    }

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

    try {
      const result = await db.execute(sql`
        INSERT INTO trending_polls (
          id, category, headline, slug, subject_text, description,
          person_id, seed_support_count, seed_neutral_count, seed_oppose_count,
          status, visibility, featured, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${category}, ${headline}, ${slug}, ${subjectText}, ${description},
          ${personId}, ${seedSupportCount}, ${seedNeutralCount}, ${seedOpposeCount},
          'live', 'live', false, NOW(), NOW()
        )
        ON CONFLICT (slug) DO UPDATE SET
          category = EXCLUDED.category,
          headline = EXCLUDED.headline,
          subject_text = EXCLUDED.subject_text,
          description = EXCLUDED.description,
          person_id = EXCLUDED.person_id,
          seed_support_count = EXCLUDED.seed_support_count,
          seed_neutral_count = EXCLUDED.seed_neutral_count,
          seed_oppose_count = EXCLUDED.seed_oppose_count,
          status = 'live',
          visibility = 'live',
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `);

      const wasInserted = (result.rows[0] as any)?.inserted;
      if (wasInserted === true || wasInserted === 't') {
        created++;
      } else {
        updated++;
      }
    } catch (err: any) {
      errors.push(`Row ${rowNum} (slug: ${slug}): DB error — ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`Total rows processed: ${dataRows.length}`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
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
  for (const row of dbCount.rows) {
    console.log(`  status="${(row as any).status}": ${(row as any).count} polls`);
  }

  console.log(`\nDone.\n`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
