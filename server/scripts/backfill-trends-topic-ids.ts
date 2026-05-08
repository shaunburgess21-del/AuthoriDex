// ============================================================================
// Backfill Google Trends Topic IDs for existing tracked people
// ============================================================================
// Usage:
//   npx tsx --env-file=.env server/scripts/backfill-trends-topic-ids.ts
//   npx tsx --env-file=.env server/scripts/backfill-trends-topic-ids.ts --apply
//
// Without --apply: outputs a CSV of suggestions for admin review.
// With --apply: writes the auto-selected Topic ID to the database for each
// person where a high-confidence match is found (type contains "Person",
// "Politician", "Athlete", "Singer", "Actor", etc.).

import { db } from "../db";
import { trackedPeople } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";
import { fetchTrendsTopicSuggestions, isSerpApiTrendsConfigured } from "../providers/serpapi-trends";

const PERSON_TYPES = ["person", "politician", "athlete", "singer", "actor", "rapper", "comedian", "model", "author", "director", "businessperson", "musician", "entrepreneur"];
const INTER_CALL_DELAY_MS = 600;

async function main() {
  if (!isSerpApiTrendsConfigured()) {
    console.error("[Backfill] SERPAPI_API_KEY not set. Exiting.");
    process.exit(1);
  }

  const applyMode = process.argv.includes("--apply");
  console.log(`[Backfill] Mode: ${applyMode ? "APPLY (will write to DB)" : "DRY-RUN (output only)"}`);

  const people = await db
    .select({ id: trackedPeople.id, name: trackedPeople.name, category: trackedPeople.category })
    .from(trackedPeople)
    .where(isNull(trackedPeople.googleTrendsTopicId));

  console.log(`[Backfill] Found ${people.length} people without a Google Trends Topic ID\n`);

  if (people.length === 0) {
    console.log("[Backfill] Nothing to do.");
    process.exit(0);
  }

  console.log("name,suggestedTopicId,suggestedTitle,suggestedType,confidence,applied");

  let applied = 0;
  let noMatch = 0;
  let lowConfidence = 0;

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    try {
      const suggestions = await fetchTrendsTopicSuggestions(p.name);

      if (suggestions.length === 0) {
        console.log(`"${p.name}",,,,no_suggestions,false`);
        noMatch++;
        if (i < people.length - 1) await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS));
        continue;
      }

      const personMatch = suggestions.find(s =>
        PERSON_TYPES.some(t => s.type.toLowerCase().includes(t))
      );

      const best = personMatch || suggestions[0];
      const confidence = personMatch ? "high" : "low";

      if (confidence === "low") lowConfidence++;

      const shouldApply = applyMode && confidence === "high";
      if (shouldApply) {
        await db
          .update(trackedPeople)
          .set({ googleTrendsTopicId: best.topicId })
          .where(eq(trackedPeople.id, p.id));
        applied++;
      }

      console.log(`"${p.name}","${best.topicId}","${best.title}","${best.type}",${confidence},${shouldApply}`);
    } catch (err) {
      console.log(`"${p.name}",,,,error:${(err as Error).message},false`);
    }

    if (i < people.length - 1) await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS));
  }

  console.log(`\n[Backfill] Summary: ${people.length} people, ${applied} applied, ${noMatch} no match, ${lowConfidence} low confidence`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[Backfill] FATAL:", e);
  process.exit(1);
});
