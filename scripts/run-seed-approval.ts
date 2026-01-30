#!/usr/bin/env npx ts-node
/**
 * Direct seed runner script - bypasses API auth
 * Uses the exact data from FameDex_Seed_Data_For_Replit.csv
 * 
 * Run with: npx tsx scripts/run-seed-approval.ts
 */

import { seedApprovalDataDirect } from "../server/seed-approval-data";

async function main() {
  console.log("=".repeat(60));
  console.log("FameDex Approval Seed Runner (Direct Mode)");
  console.log("Using data from FameDex_Seed_Data_For_Replit.csv");
  console.log("=".repeat(60));
  console.log("");

  try {
    console.log("Starting direct seed process...");
    console.log("Expected: 100 celebrities with approval data");
    console.log("");

    const result = await seedApprovalDataDirect();

    console.log("");
    console.log("=".repeat(60));
    console.log("SEED RESULTS:");
    console.log(`  Seeded: ${result.seeded} celebrities`);
    console.log(`  Skipped: ${result.skipped} (already existed)`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log("\nErrors encountered:");
      result.errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
    }
    
    console.log("=".repeat(60));
    console.log("");
    console.log("SUCCESS! Database has been populated with approval data.");
    console.log("The leaderboard should now show approval percentages.");
    
    process.exit(0);
  } catch (error) {
    console.error("FATAL ERROR:", error);
    process.exit(1);
  }
}

main();
