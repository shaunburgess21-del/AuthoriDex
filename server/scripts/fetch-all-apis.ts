import { db } from "../db";
import { trackedPeople, apiCache } from "@shared/schema";
import { fetchSerperData } from "../providers/serper";
import { fetchXData } from "../providers/x-api";
import { runQuickScoring } from "../jobs/quick-score";

async function fetchAllApiData() {
  console.log("🚀 Starting full API data fetch for all celebrities...\n");

  const people = await db.select().from(trackedPeople);
  console.log(`📊 Found ${people.length} celebrities to process\n`);

  console.log("=" .repeat(60));
  console.log("📡 SERPER (Google Search) - Fetching for all celebrities");
  console.log("=" .repeat(60));
  
  let serperSuccess = 0;
  let serperErrors = 0;
  
  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    console.log(`[${i + 1}/${people.length}] Fetching Serper data for ${person.name}...`);
    
    try {
      const result = await fetchSerperData(person.name);
      if (result) {
        serperSuccess++;
        console.log(`   ✓ Search volume: ${result.searchVolume.toFixed(2)}, Delta: ${result.delta}`);
      } else {
        serperErrors++;
        console.log(`   ✗ No data returned`);
      }
    } catch (error) {
      serperErrors++;
      console.log(`   ✗ Error: ${error}`);
    }
    
    if (i < people.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`\n📊 Serper Summary: ${serperSuccess} success, ${serperErrors} errors\n`);

  console.log("=" .repeat(60));
  console.log("🐦 X API (Twitter) - Fetching for celebrities with handles");
  console.log("=" .repeat(60));
  
  const peopleWithX = people.filter(p => p.xHandle);
  console.log(`Found ${peopleWithX.length} celebrities with X handles\n`);
  
  let xSuccess = 0;
  let xErrors = 0;
  let xRateLimited = false;
  
  const MAX_X_REQUESTS = 30;
  
  for (let i = 0; i < Math.min(peopleWithX.length, MAX_X_REQUESTS); i++) {
    const person = peopleWithX[i];
    console.log(`[${i + 1}/${Math.min(peopleWithX.length, MAX_X_REQUESTS)}] Fetching X data for @${person.xHandle}...`);
    
    try {
      const result = await fetchXData(person.xHandle!);
      if (result) {
        xSuccess++;
        console.log(`   ✓ Quotes: ${result.quoteVelocity.toFixed(1)}, Replies: ${result.replyVelocity.toFixed(1)}`);
      } else {
        xErrors++;
        console.log(`   ✗ No data returned`);
      }
    } catch (error: any) {
      if (error?.message?.includes("429") || error?.message?.includes("rate")) {
        console.log(`   ⚠ Rate limit hit - stopping X API requests`);
        xRateLimited = true;
        break;
      }
      xErrors++;
      console.log(`   ✗ Error: ${error}`);
    }
    
    if (i < Math.min(peopleWithX.length, MAX_X_REQUESTS) - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n📊 X API Summary: ${xSuccess} success, ${xErrors} errors${xRateLimited ? " (rate limited)" : ""}\n`);

  console.log("=" .repeat(60));
  console.log("📈 Running Quick Scoring with new data");
  console.log("=" .repeat(60));
  
  const scoreResult = await runQuickScoring();
  console.log(`\n✅ Scoring complete: ${scoreResult.processed} processed, ${scoreResult.errors} errors`);

  const cachedData = await db.select().from(apiCache);
  const serperCount = cachedData.filter(c => c.provider === "serper").length;
  const xCount = cachedData.filter(c => c.provider === "x").length;
  const wikiCount = cachedData.filter(c => c.provider === "wiki").length;
  const gdeltCount = cachedData.filter(c => c.provider === "gdelt").length;
  
  console.log("\n📊 Final Cache Summary:");
  console.log(`   Wikipedia: ${wikiCount} records`);
  console.log(`   GDELT:     ${gdeltCount} records`);
  console.log(`   Serper:    ${serperCount} records`);
  console.log(`   X API:     ${xCount} records`);
  
  console.log("\n✨ All API data fetched successfully!");
}

fetchAllApiData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
