#!/usr/bin/env npx ts-node
/**
 * Value Leaderboard Seed Script (Aggregate Method - No Fake Users)
 * 
 * This script populates the seed_underrated_count and seed_overrated_count columns
 * in celebrity_metrics WITHOUT creating fake raw vote rows.
 * 
 * Guards:
 * - Only runs when NODE_ENV !== 'production' AND SEED_METRICS=true
 * - Must be run manually via: SEED_METRICS=true npx tsx scripts/seed-value-aggregates.ts
 * 
 * Hard anchors from requirements:
 * - Elon Musk: ~1112 total value votes
 * - Nick Fuentes: ~98 total value votes
 * - Others: interpolated between these bounds with realistic distributions
 */

import { db } from "../server/db";
import { celebrityMetrics, trackedPeople, trendingPeople } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

// Safety checks
if (process.env.NODE_ENV === 'production') {
  console.error("ERROR: Cannot run seed script in production environment");
  process.exit(1);
}

if (process.env.SEED_METRICS !== 'true') {
  console.error("ERROR: Must set SEED_METRICS=true to run this script");
  console.error("Usage: SEED_METRICS=true npx tsx scripts/seed-value-aggregates.ts");
  process.exit(1);
}

// Hard anchors for specific celebrities
const HARD_ANCHORS: Record<string, { totalVotes: number; underratedBias?: number }> = {
  "Elon Musk": { totalVotes: 1112, underratedBias: 0.65 },  // 65% underrated
  "Nick Fuentes": { totalVotes: 98, underratedBias: 0.35 }, // 35% underrated (controversial)
};

// Simple seeded random for deterministic results (same input = same output)
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Generate deterministic underrated percentage based on celebrity index
// Most celebrities will be between 45-75% underrated
function generateUnderratedPct(index: number): number {
  // Use deterministic random based on index
  const rand1 = seededRandom(index * 12345);
  const rand2 = seededRandom(index * 54321);
  
  // Base distribution centered around 55-60%
  const base = 0.55;
  const variance = rand1 * 0.4 - 0.2; // -0.2 to +0.2
  let pct = base + variance;
  
  // Clamp between 0.30 and 0.85
  pct = Math.max(0.30, Math.min(0.85, pct));
  
  // Occasionally make someone more polarized (10% chance based on deterministic random)
  if (rand2 < 0.1) {
    pct = rand2 > 0.05 ? 0.85 + (rand1 * 0.10) : 0.15 + (rand1 * 0.15);
    pct = Math.max(0.15, Math.min(0.90, pct));
  }
  
  return pct;
}

// Generate total votes based on fame rank (higher fameIndex = more votes)
// This is now deterministic (no randomness)
function generateTotalVotes(fameRank: number, totalCelebs: number): number {
  // Interpolate between anchor values
  const maxVotes = 1112; // Elon's anchor
  const minVotes = 98;   // Nick Fuentes' anchor
  
  // Use a curve that gives top celebs more votes
  const normalizedRank = (fameRank - 1) / (totalCelebs - 1); // 0 to 1
  const curve = 1 - Math.pow(normalizedRank, 0.5); // Square root for softer curve
  
  // Deterministic: no random variance
  return Math.round(minVotes + (maxVotes - minVotes) * curve);
}

async function seedValueAggregates() {
  console.log("=".repeat(60));
  console.log("FameDex Value Leaderboard Seed Script");
  console.log("Using Aggregate Method (No Fake Users)");
  console.log("=".repeat(60));
  console.log("");

  try {
    // Get all tracked people sorted by fameIndex (from trending_people for fame rank)
    const people = await db
      .select({
        id: trackedPeople.id,
        name: trackedPeople.name,
      })
      .from(trackedPeople)
      .innerJoin(trendingPeople, eq(trackedPeople.id, trendingPeople.id))
      .orderBy(desc(trendingPeople.fameIndex));

    console.log(`Found ${people.length} celebrities to seed`);
    console.log("");

    let seeded = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      
      try {
        // Check for hard-coded anchors
        const anchor = HARD_ANCHORS[person.name];
        
        let totalVotes: number;
        let underratedPct: number;
        
        if (anchor) {
          totalVotes = anchor.totalVotes;
          underratedPct = anchor.underratedBias || generateUnderratedPct(i);
          console.log(`[ANCHOR] ${person.name}: ${totalVotes} total votes (${Math.round(underratedPct * 100)}% underrated)`);
        } else {
          totalVotes = generateTotalVotes(i + 1, people.length);
          underratedPct = generateUnderratedPct(i);
        }
        
        const seedUnderratedCount = Math.round(totalVotes * underratedPct);
        const seedOverratedCount = totalVotes - seedUnderratedCount;
        
        // Calculate display values
        const underratedVotesCount = seedUnderratedCount;
        const overratedVotesCount = seedOverratedCount;
        const displayUnderratedPct = Math.round((seedUnderratedCount / totalVotes) * 100);
        const displayOverratedPct = 100 - displayUnderratedPct;
        const valueScore = displayUnderratedPct - displayOverratedPct;
        
        // Upsert into celebrity_metrics
        await db
          .insert(celebrityMetrics)
          .values({
            celebrityId: person.id,
            seedUnderratedCount,
            seedOverratedCount,
            underratedVotesCount,
            overratedVotesCount,
            underratedPct: displayUnderratedPct,
            overratedPct: displayOverratedPct,
            valueScore,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: celebrityMetrics.celebrityId,
            set: {
              seedUnderratedCount,
              seedOverratedCount,
              underratedVotesCount,
              overratedVotesCount,
              underratedPct: displayUnderratedPct,
              overratedPct: displayOverratedPct,
              valueScore,
              updatedAt: new Date(),
            },
          });
        
        seeded++;
        
        if (!anchor) {
          console.log(`[${seeded}/${people.length}] ${person.name}: ${totalVotes} votes (${displayUnderratedPct}% U / ${displayOverratedPct}% O, score: ${valueScore > 0 ? '+' : ''}${valueScore})`);
        }
        
      } catch (error) {
        errors.push(`${person.name}: ${error}`);
        console.error(`ERROR seeding ${person.name}:`, error);
      }
    }

    console.log("");
    console.log("=".repeat(60));
    console.log("SEED RESULTS:");
    console.log(`  Seeded: ${seeded} celebrities`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log("\nErrors encountered:");
      errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
    }
    
    console.log("=".repeat(60));
    console.log("");
    console.log("SUCCESS! Value seed data has been populated.");
    console.log("The Value leaderboard should now show underrated/overrated percentages.");
    console.log("");
    console.log("Key metrics:");
    
    // Verify Elon Musk's values
    const [elonMetrics] = await db
      .select()
      .from(celebrityMetrics)
      .innerJoin(trackedPeople, eq(celebrityMetrics.celebrityId, trackedPeople.id))
      .where(eq(trackedPeople.name, "Elon Musk"))
      .limit(1);
    
    if (elonMetrics) {
      const total = (elonMetrics.celebrity_metrics.seedUnderratedCount || 0) + 
                    (elonMetrics.celebrity_metrics.seedOverratedCount || 0);
      console.log(`  Elon Musk: ${total} total votes, ${elonMetrics.celebrity_metrics.underratedPct}% underrated, score: ${elonMetrics.celebrity_metrics.valueScore}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error("FATAL ERROR:", error);
    process.exit(1);
  }
}

seedValueAggregates();
