import { db, pool } from "../server/db";
import { celebrityMetrics, trendingPeople } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

interface CSVRow {
  name: string;
  wikiSlug: string;
  category: string;
  totalValueVotes: number;
  underratedPct: number;
}

function normalizeForMatching(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function parseCSV(content: string): CSVRow[] {
  const lines = content.trim().split("\n");
  const rows: CSVRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(",");
    if (parts.length < 5) continue;
    
    const name = parts[0].trim();
    const wikiSlug = parts[1].trim();
    const category = parts[2].trim();
    const totalValueVotes = parseInt(parts[3].trim(), 10);
    const underratedPct = parseFloat(parts[4].trim());
    
    if (isNaN(totalValueVotes) || isNaN(underratedPct)) {
      console.warn(`Skipping invalid row: ${line}`);
      continue;
    }
    
    rows.push({
      name,
      wikiSlug,
      category,
      totalValueVotes,
      underratedPct,
    });
  }
  
  return rows;
}

async function overwriteValueSeeds() {
  console.log("=== Overwriting Value Seed Data from CSV ===\n");
  
  const csvPath = path.join(process.cwd(), "attached_assets", "FameDex_Value_Seed_Data_v2_1769862491694.csv");
  
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found at: ${csvPath}`);
    process.exit(1);
  }
  
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const csvRows = parseCSV(csvContent);
  
  console.log(`Parsed ${csvRows.length} rows from CSV\n`);
  
  const people = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
    })
    .from(trendingPeople);
  
  console.log(`Found ${people.length} celebrities in database\n`);
  
  const nameToId = new Map<string, string>();
  
  for (const person of people) {
    nameToId.set(normalizeForMatching(person.name), person.id);
  }
  
  let updated = 0;
  let notFound = 0;
  
  for (const row of csvRows) {
    const normalizedName = normalizeForMatching(row.name);
    
    let celebrityId = nameToId.get(normalizedName);
    
    if (!celebrityId) {
      console.warn(`[NOT FOUND] ${row.name} (slug: ${row.wikiSlug})`);
      notFound++;
      continue;
    }
    
    const seedUnderratedCount = Math.round(row.totalValueVotes * row.underratedPct);
    const seedOverratedCount = row.totalValueVotes - seedUnderratedCount;
    
    const underratedVotesCount = seedUnderratedCount;
    const overratedVotesCount = seedOverratedCount;
    const totalVotes = underratedVotesCount + overratedVotesCount;
    
    const underratedPctDisplay = totalVotes > 0 ? Math.round((underratedVotesCount / totalVotes) * 100) : 0;
    const overratedPctDisplay = 100 - underratedPctDisplay;
    const valueScore = underratedPctDisplay - overratedPctDisplay;
    
    await db
      .update(celebrityMetrics)
      .set({
        seedUnderratedCount,
        seedOverratedCount,
        underratedVotesCount,
        overratedVotesCount,
        underratedPct: underratedPctDisplay,
        overratedPct: overratedPctDisplay,
        valueScore,
        updatedAt: new Date(),
      })
      .where(eq(celebrityMetrics.celebrityId, celebrityId));
    
    console.log(`[UPDATED] ${row.name}: ${row.totalValueVotes} votes, ${Math.round(row.underratedPct * 100)}% underrated, valueScore=${valueScore}`);
    updated++;
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Not found: ${notFound}`);
  
  const topValue = await db
    .select({
      name: trendingPeople.name,
      valueScore: celebrityMetrics.valueScore,
      underratedPct: celebrityMetrics.underratedPct,
      underratedVotesCount: celebrityMetrics.underratedVotesCount,
      overratedVotesCount: celebrityMetrics.overratedVotesCount,
    })
    .from(celebrityMetrics)
    .innerJoin(trendingPeople, eq(celebrityMetrics.celebrityId, trendingPeople.id))
    .orderBy(sql`${celebrityMetrics.valueScore} DESC`)
    .limit(10);
  
  console.log(`\n=== Top 10 Value Leaderboard (after update) ===`);
  topValue.forEach((p, i) => {
    const total = (p.underratedVotesCount || 0) + (p.overratedVotesCount || 0);
    console.log(`${i + 1}. ${p.name}: valueScore=${p.valueScore}, ${p.underratedPct}% underrated, ${total} total votes`);
  });
  
  const elonCheck = await db
    .select({
      name: trendingPeople.name,
      valueScore: celebrityMetrics.valueScore,
      underratedPct: celebrityMetrics.underratedPct,
      underratedVotesCount: celebrityMetrics.underratedVotesCount,
      overratedVotesCount: celebrityMetrics.overratedVotesCount,
    })
    .from(celebrityMetrics)
    .innerJoin(trendingPeople, eq(celebrityMetrics.celebrityId, trendingPeople.id))
    .where(sql`LOWER(${trendingPeople.name}) LIKE '%elon%'`)
    .limit(1);
  
  if (elonCheck.length > 0) {
    const elon = elonCheck[0];
    const total = (elon.underratedVotesCount || 0) + (elon.overratedVotesCount || 0);
    console.log(`\n=== Elon Musk Verification ===`);
    console.log(`Name: ${elon.name}`);
    console.log(`Total Votes: ${total} (target: ~1112)`);
    console.log(`Underrated %: ${elon.underratedPct}% (target: 65%)`);
    console.log(`Value Score: ${elon.valueScore} (target: ~30)`);
  }
  
  const putinCheck = await db
    .select({
      name: trendingPeople.name,
      valueScore: celebrityMetrics.valueScore,
      underratedPct: celebrityMetrics.underratedPct,
    })
    .from(celebrityMetrics)
    .innerJoin(trendingPeople, eq(celebrityMetrics.celebrityId, trendingPeople.id))
    .where(sql`LOWER(${trendingPeople.name}) LIKE '%putin%'`)
    .limit(1);
  
  if (putinCheck.length > 0) {
    const putin = putinCheck[0];
    console.log(`\n=== Vladimir Putin Verification ===`);
    console.log(`Name: ${putin.name}`);
    console.log(`Underrated %: ${putin.underratedPct}% (target: ~78%)`);
    console.log(`Value Score: ${putin.valueScore}`);
  }
  
  await pool.end();
  console.log("\nDone!");
}

overwriteValueSeeds().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
