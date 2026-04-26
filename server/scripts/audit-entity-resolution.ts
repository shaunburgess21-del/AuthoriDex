// Targeted Serper entity-resolution diagnostic for the celebrities the trend
// engine is misranking. Runs `runEntityDiagnostic` for a small list and writes
// results to ./audit-entity-resolution-output.json.
//
// Read-only against Serper (consumes a small number of API credits).

import { db } from "../db";
import { trackedPeople } from "@shared/schema";
import { eq } from "drizzle-orm";
import { runEntityDiagnostic } from "../diagnostics/entity-resolution";
import * as fs from "fs";
import * as path from "path";

// People with anomalously low search velocity in the top-50 audit, plus a few
// "good" controls (high-search) to see how well-formed Serper results look.
const NAMES = [
  "Donald Trump",
  "Elon Musk",
  "Narendra Modi",
  "Lionel Messi",
  "LeBron James",
  "Cristiano Ronaldo",
  "Rihanna",
  "Jeff Bezos",
  // Controls that score well on search:
  "Tim Cook",
  "John Ternus",
  "Drake",
];

async function main() {
  const out: any = { generatedAt: new Date().toISOString(), entries: [] };
  for (const name of NAMES) {
    const [person] = await db
      .select()
      .from(trackedPeople)
      .where(eq(trackedPeople.name, name))
      .limit(1);
    if (!person) {
      out.entries.push({ name, error: "person not found in tracked_people" });
      continue;
    }
    const diag = await runEntityDiagnostic(person.id);
    if (!diag) {
      out.entries.push({ name, personId: person.id, error: "entity diagnostic returned null" });
      continue;
    }
    out.entries.push({
      name,
      personId: person.id,
      searchQueryUsed: diag.searchQueryUsed,
      conclusion: diag.conclusion,
      mismatchReasons: diag.mismatchReasons,
      knowledgeGraph: diag.knowledgeGraph,
      topResultsCount: diag.topResults.length,
      topResultTitles: diag.topResults.slice(0, 5).map((r) => r.title),
      rawInputs: diag.rawInputs,
      percentiles: diag.percentiles,
      latestFameIndex: diag.latestFameIndex,
      latestRank: diag.latestRank,
    });
    await new Promise((r) => setTimeout(r, 300));
  }
  const outPath = path.resolve(process.cwd(), "audit-entity-resolution-output.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n[audit-entity-resolution] Wrote results to ${outPath}\n`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[audit-entity-resolution] fatal:", err);
  process.exit(1);
});
