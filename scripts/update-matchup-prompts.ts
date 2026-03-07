/**
 * One-time script: Update matchup promptText from CSV.
 *
 * Usage: npx tsx scripts/update-matchup-prompts.ts [path-to-csv]
 *
 * Default CSV path: matchup_prompts.csv in project root.
 * CSV must have headers: slug, prompt_text
 *
 * Only updates prompt_text for matchups whose slug appears in the CSV.
 * All other matchup fields are left unchanged.
 *
 * Requires DATABASE_URL in the environment.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { db } from "../server/db";
import { matchups } from "../shared/schema";
import { eq } from "drizzle-orm";

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

async function main() {
  const csvPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve("matchup_prompts.csv");

  console.log("\n=== Update Matchup Prompts ===");
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
  const slugIdx = headers.findIndex((h) => h === "slug");
  const promptIdx = headers.findIndex((h) => h === "prompt_text");
  if (slugIdx < 0 || promptIdx < 0) {
    console.error(`ERROR: CSV must have columns 'slug' and 'prompt_text'. Found: ${headers.join(", ")}`);
    process.exit(1);
  }

  const dataRows = allRows.slice(1);
  let updated = 0;
  const notFound: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const slug = row[slugIdx]?.trim() || "";
    const promptText = row[promptIdx]?.trim() ?? "";
    if (!slug) continue;

    const result = await db
      .update(matchups)
      .set({ promptText: promptText || null })
      .where(eq(matchups.slug, slug))
      .returning({ id: matchups.id });

    if (result.length > 0) {
      updated++;
      console.log(`  [${updated}] slug="${slug}" → prompt_text="${promptText}"`);
    } else {
      notFound.push(slug);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Updated: ${updated}`);
  console.log(`  Slugs not found (no row updated): ${notFound.length}`);
  if (notFound.length > 0) {
    console.log("\n  Slugs not found:");
    notFound.forEach((s) => console.log(`    - ${s}`));
  }
  console.log("\nDone.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
