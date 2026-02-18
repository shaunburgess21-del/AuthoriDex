import XLSX from 'xlsx';
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
  const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined;
  const allowSeedDelete = process.env.ALLOW_SEED_DELETE === 'true';

  if (!isDev && !allowSeedDelete) {
    console.error('ABORT: seed-celebrities.ts refused to run.');
    console.error('This script deletes ALL trending data (trending_people, trend_snapshots, api_cache, etc.).');
    console.error('To proceed, either:');
    console.error('  1. Set NODE_ENV=development');
    console.error('  2. Set ALLOW_SEED_DELETE=true (for intentional production reseeds)');
    process.exit(1);
  }

  if (allowSeedDelete && !isDev) {
    console.warn('WARNING: Running seed with ALLOW_SEED_DELETE=true in non-development environment.');
    console.warn('This will wipe all scored data. Proceeding in 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('Starting celebrity seed from Excel file...\n');

  const workbook = XLSX.readFile('attached_assets/2025-12-30_FameDex_Leaderboard_-_Final_1767047208792.xlsx');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<ExcelRow>(sheet);

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

seedCelebrities().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
