import { db, pool } from '../db';
import { matchups } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = process.env.DRY_RUN !== 'false';
const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  console.error('ERROR: SUPABASE_URL not set');
  process.exit(1);
}

const baseStorageUrl = `${SUPABASE_URL}/storage/v1/object/public/matchups`;

interface CsvRow {
  slug: string;
  seedA: number;
  seedB: number;
}

function parseCSV(filePath: string): CsvRow[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(',');
    if (parts.length >= 3) {
      rows.push({
        slug: parts[0].trim(),
        seedA: parseInt(parts[1].trim(), 10) || 0,
        seedB: parseInt(parts[2].trim(), 10) || 0,
      });
    }
  }
  return rows;
}

function deriveSlug(optionA: string, optionB: string): string {
  const slugify = (s: string) =>
    s.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slugify(optionA)}-vs-${slugify(optionB)}`;
}

async function main() {
  console.log(`\n=== Matchup Seed Script (DRY_RUN=${DRY_RUN}) ===\n`);

  const csvPath = path.join(__dirname, '../../attached_assets/matchups_seed_votes_1771956253262.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const csvRows = parseCSV(csvPath);
  console.log(`Loaded ${csvRows.length} rows from CSV\n`);

  const csvMap = new Map<string, CsvRow>();
  for (const row of csvRows) {
    csvMap.set(row.slug, row);
  }

  const allMatchups = await db.select().from(matchups);
  console.log(`Found ${allMatchups.length} matchups in DB\n`);

  let updated = 0;
  let skipped = 0;
  const matchedSlugs = new Set<string>();

  for (const m of allMatchups) {
    let csvRow: CsvRow | undefined;

    if (m.slug && csvMap.has(m.slug)) {
      csvRow = csvMap.get(m.slug);
    }

    if (!csvRow && m.optionAText && m.optionBText) {
      const derived = deriveSlug(m.optionAText, m.optionBText);
      if (csvMap.has(derived)) {
        csvRow = csvMap.get(derived);
      }
      const reversed = deriveSlug(m.optionBText, m.optionAText);
      if (!csvRow && csvMap.has(reversed)) {
        csvRow = csvMap.get(reversed);
      }
    }

    if (!csvRow) {
      const derivedForLog = m.optionAText && m.optionBText
        ? deriveSlug(m.optionAText, m.optionBText)
        : '(no options)';
      console.log(`  SKIP: "${m.optionAText} vs ${m.optionBText}" (derived: ${derivedForLog}) — no CSV match`);
      skipped++;
      continue;
    }

    matchedSlugs.add(csvRow.slug);

    const updateData = {
      slug: csvRow.slug,
      seedVotesA: csvRow.seedA,
      seedVotesB: csvRow.seedB,
      optionAImage: `${baseStorageUrl}/${csvRow.slug}/optionA.webp`,
      optionBImage: `${baseStorageUrl}/${csvRow.slug}/optionB.webp`,
    };

    console.log(`  UPDATE: "${m.optionAText} vs ${m.optionBText}"`);
    console.log(`          slug: ${csvRow.slug}`);
    console.log(`          seeds: A=${csvRow.seedA}, B=${csvRow.seedB}`);
    console.log(`          imgA: ${updateData.optionAImage}`);
    console.log(`          imgB: ${updateData.optionBImage}`);

    if (!DRY_RUN) {
      await db.update(matchups).set(updateData).where(eq(matchups.id, m.id));
    }

    updated++;
  }

  const unmatchedCsv = csvRows.filter(r => !matchedSlugs.has(r.slug));
  if (unmatchedCsv.length > 0) {
    console.log(`\n  UNMATCHED CSV slugs (${unmatchedCsv.length}):`);
    unmatchedCsv.forEach(r => console.log(`    - ${r.slug}`));
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Unmatched CSV rows: ${unmatchedCsv.length}`);
  console.log(`  DRY_RUN: ${DRY_RUN}`);
  if (DRY_RUN) {
    console.log(`\n  To apply changes, run with: DRY_RUN=false npx tsx server/scripts/seed-matchup-data.ts\n`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
