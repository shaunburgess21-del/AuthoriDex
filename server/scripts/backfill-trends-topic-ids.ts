// ============================================================================
// Backfill Google Trends Topic IDs for existing tracked people
// ============================================================================
// Usage:
//   npx tsx --env-file=.env server/scripts/backfill-trends-topic-ids.ts
//   npx tsx --env-file=.env server/scripts/backfill-trends-topic-ids.ts --apply
//
// Without --apply: outputs a CSV of suggestions for admin review.
// With --apply: writes the auto-selected Topic ID to the database for each
// person where a high-confidence match is found (name matches AND type is
// a person-like entity, not a book/product/topic).

import { db } from "../db";
import { trackedPeople } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";
import { fetchTrendsTopicSuggestions, isSerpApiTrendsConfigured } from "../providers/serpapi-trends";

// Types that indicate "this is about that actual person" vs a book/product/topic
const REJECT_TYPES = ["book", "topic", "scale model", "album", "film", "tv", "song", "game", "event", "movie", "wine", "software", "tour", "wallpaper"];
const INTER_CALL_DELAY_MS = 600;

/**
 * Check if a suggestion title plausibly matches the tracked person's name.
 * Handles common variations: "Vinícius Júnior" vs "Vinicius Jr",
 * "J. K. Rowling" vs "J.K. Rowling", "MrBeast" vs "Mr Beast", etc.
 */
function nameMatches(personName: string, suggestionTitle: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip accents
      .replace(/[.\-']/g, "")                              // strip punctuation
      .replace(/\s+/g, " ")
      .trim();

  const pn = normalize(personName);
  const st = normalize(suggestionTitle);

  if (pn === st) return true;

  const pTokens = pn.split(" ").filter(t => t.length > 1);
  const sTokens = st.split(" ").filter(t => t.length > 1);

  // Mononyms ("Adele", "Drake", "Zendaya"): exact match only.
  // Substring matching is too loose — "Adèle Exarchopoulos" ≠ "Adele".
  if (pTokens.length === 1) return pn === st;

  // Substring containment, but only when the suggestion title isn't padded
  // with event/product junk (e.g., "Club 90s: Ariana Grande Night" has 5+
  // tokens vs 2 for "Ariana Grande" — reject). Allow ≤2 extra tokens.
  if (st.includes(pn) && sTokens.length <= pTokens.length + 2) return true;
  if (pn.includes(st) && pTokens.length <= sTokens.length + 2) return true;

  if (pTokens.length === 0 || sTokens.length === 0) return false;

  // Last name match is strongest signal
  const pLast = pTokens[pTokens.length - 1];
  const sLast = sTokens[sTokens.length - 1];
  const lastNameMatch = pLast === sLast || pLast.includes(sLast) || sLast.includes(pLast);

  // First name/token match
  const firstMatch = pTokens[0] === sTokens[0] ||
    pTokens[0].startsWith(sTokens[0]) || sTokens[0].startsWith(pTokens[0]);

  if (lastNameMatch && firstMatch) return true;

  // Count overlapping tokens (handles middle name additions/removals).
  // Guard: if the suggestion title is much longer than the person name,
  // all person tokens appearing inside a padded title likely means an
  // event/product named after the person, not the person themselves.
  const tooLong = sTokens.length > pTokens.length + 2;
  const overlap = pTokens.filter(t => sTokens.some(s => s === t || s.includes(t) || t.includes(s)));
  if (!tooLong && overlap.length >= 2) return true;
  if (!tooLong && overlap.length >= 1 && Math.min(pTokens.length, sTokens.length) <= 2) return lastNameMatch;

  return false;
}

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

      // Strategy: find the first suggestion where the title plausibly matches
      // the person's name AND the type isn't a known non-person entity.
      // SerpApi entity types are short labels ("Book", "Event", "Wine") while
      // person descriptions are long ("American singer-songwriter and actress").
      // Only apply the reject check to short type strings to avoid false
      // positives like "song" matching inside "songwriter".
      const isRejectedType = (type: string) => {
        const t = type.toLowerCase().trim();
        if (t.length > 25) return false;
        return REJECT_TYPES.some(rt => t.includes(rt));
      };
      const nameAndTypeMatch = suggestions.find(s =>
        nameMatches(p.name, s.title) && !isRejectedType(s.type)
      );

      // Fallback: first suggestion with matching name (any type)
      const nameOnly = !nameAndTypeMatch
        ? suggestions.find(s => nameMatches(p.name, s.title))
        : null;

      const best = nameAndTypeMatch || nameOnly || suggestions[0];
      const confidence = nameAndTypeMatch ? "high"
        : nameOnly ? "medium"
        : "low";

      if (confidence !== "high") lowConfidence++;

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
