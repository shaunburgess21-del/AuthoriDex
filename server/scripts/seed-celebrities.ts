import ExcelJS from 'exceljs';
import { db } from '../db';
import { trackedPeople, trendingPeople, trendSnapshots, apiCache, platformInsights, insightItems } from '@shared/schema';
import { sql } from 'drizzle-orm';

interface ExcelRow {
  '#': number;
  Name: string;
  Category: string;
  Wiki_Slug: string;
  X_Handle: string;
  'Induction Status': string;
}

async function seedCelebrities() {
  const isDev = process.env.NODE_ENV === 'development';
  const allowSeedDelete = process.env.ALLOW_SEED_DELETE === 'true';
  const confirmSeedDelete = process.env.CONFIRM_SEED_DELETE === 'YES_I_UNDERSTAND';

  if (!isDev) {
    if (!allowSeedDelete || !confirmSeedDelete) {
      console.error('ABORT: seed-celebrities.ts refused to run.');
      console.error('This script deletes ALL trending data (trending_people, trend_snapshots, api_cache, etc.).');
      console.error('');
      console.error('To run in development, set: NODE_ENV=development');
      console.error('To run in production/other, set ALL of these:');
      console.error('  ALLOW_SEED_DELETE=true');
      console.error('  CONFIRM_SEED_DELETE=YES_I_UNDERSTAND');
      console.error('');
      console.error(`Current NODE_ENV: "${process.env.NODE_ENV || '(unset)'}"`);
      process.exit(1);
    }

    console.warn('WARNING: Running destructive seed in non-development environment.');
    console.warn(`NODE_ENV="${process.env.NODE_ENV || '(unset)'}", ALLOW_SEED_DELETE=true, CONFIRM_SEED_DELETE confirmed.`);
    console.warn('This will wipe ALL scored data. Proceeding in 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('Starting celebrity seed from Excel file...\n');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('attached_assets/2025-12-30_FameDex_Leaderboard_-_Final_1767047208792.xlsx');
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    console.error('No worksheet found in seed spreadsheet. Aborting.');
    process.exit(1);
  }
  const data = readExcelRows<ExcelRow>(worksheet);

  console.log(`Found ${data.length} celebrities in Excel file`);

  if (data.length !== 100) {
    console.error(`Expected 100 celebrities, found ${data.length}. Aborting.`);
    process.exit(1);
  }

  console.log('\nClearing old data (in order due to foreign keys)...');
  
  await db.delete(insightItems);
  console.log('   - Cleared insight_items');
  
  await db.delete(platformInsights);
  console.log('   - Cleared platform_insights');
  
  await db.delete(trendSnapshots);
  console.log('   - Cleared trend_snapshots');
  
  await db.delete(trendingPeople);
  console.log('   - Cleared trending_people');
  
  await db.delete(apiCache);
  console.log('   - Cleared api_cache');
  
  await db.delete(trackedPeople);
  console.log('   - Cleared tracked_people');

  console.log('\n📥 Inserting 100 celebrities...');
  
  const celebrities = data.map((row, index) => ({
    name: row.Name.trim(),
    category: row.Category.trim(),
    displayOrder: index + 1,
    wikiSlug: row.Wiki_Slug?.trim() || null,
    xHandle: row.X_Handle?.trim() || null,
    avatar: null,
    bio: null,
    youtubeId: null,
    spotifyId: null,
    instagramHandle: null,
    tiktokHandle: null,
  }));

  for (const celeb of celebrities) {
    await db.insert(trackedPeople).values(celeb);
  }

  console.log(`✅ Inserted ${celebrities.length} celebrities`);

  const verification = await db.select().from(trackedPeople);
  console.log(`\n📋 Verification: ${verification.length} celebrities now in database`);
  
  console.log('\nTop 10:');
  verification
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .slice(0, 10)
    .forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.name} (${p.category}) - Wiki: ${p.wikiSlug}, X: @${p.xHandle}`);
    });

  console.log('\n✨ Celebrity seed complete!');
  console.log('   Next: Run data ingestion to fetch fresh scores');
  
  process.exit(0);
}

function getCellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value && value.result != null) return String(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    return '';
  }
  return String(value);
}

function readExcelRows<T>(worksheet: ExcelJS.Worksheet): T[] {
  const headerRow = worksheet.getRow(1);
  const headers = new Map<number, string>();
  headerRow.eachCell((cell, colNumber) => {
    headers.set(colNumber, getCellText(cell.value).trim());
  });

  const rows: T[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasData = false;
    headers.forEach((header, colNumber) => {
      if (!header) return;
      const text = getCellText(row.getCell(colNumber).value).trim();
      if (text.length > 0) hasData = true;
      record[header] = text;
    });
    if (hasData) rows.push(record as unknown as T);
  });

  return rows;
}

seedCelebrities().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
