import { db } from "./db";
import { trackedPeople, celebrityProfiles, type InsertCelebrityProfile, type TrackedPerson } from "@shared/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { fetchWebSearchContext, fetchNetWorthContext } from "./providers/serper";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

async function refreshAllProfiles() {
  console.log("Starting bulk profile refresh for all celebrities...");
  
  const people = await db.select().from(trackedPeople);
  console.log(`Found ${people.length} celebrities to refresh.`);
  
  let successCount = 0;
  let errorCount = 0;
  
  const batchSize = 5;
  for (let i = 0; i < people.length; i += batchSize) {
    const batch = people.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (person: TrackedPerson) => {
      try {
        console.log(`\nProcessing: ${person.name}`);
        
        const [webContext, netWorthContext] = await Promise.all([
          fetchWebSearchContext(person.name).catch(() => null),
          fetchNetWorthContext(person.name).catch(() => null)
        ]);
        
        let webContextSection = "";
        if (webContext && (webContext.headlines.length > 0 || webContext.snippets.length > 0)) {
          webContextSection = `
CURRENT WEB SEARCH RESULTS FOR ${person.name.toUpperCase()} (use this for current information):
Recent Headlines:
${webContext.headlines.slice(0, 5).map(h => `- ${h}`).join('\n')}

Recent Information Snippets:
${webContext.snippets.slice(0, 5).map(s => `- ${s}`).join('\n')}

`;
        }
        
        let netWorthSection = "";
        if (netWorthContext && netWorthContext.sources.length > 0) {
          netWorthSection = `
NET WORTH SEARCH RESULTS (use the MOST RECENT authoritative source for accurate net worth):
${netWorthContext.sources.map(s => `- "${s.title}": ${s.snippet}`).join('\n')}

IMPORTANT: Prefer Forbes, Bloomberg, or Celebrity Net Worth sources. Use the MOST RECENT figure available.
${netWorthContext.estimate ? `Quick extract found: ${netWorthContext.estimate} (verify against sources above)` : ''}

`;
        }
        
        const currentYear = new Date().getFullYear();
        const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const prompt = `You are a celebrity data expert. Generate accurate, factual information about ${person.name}.

${webContextSection}${netWorthSection}CRITICAL INSTRUCTIONS:
1. Today is ${currentDate}. Use your most current knowledge.
2. This person's data will be cached for 7 days, so accuracy is essential.
3. If this person is a politician, CEO, or public figure, state their CURRENT title/position as of ${currentYear}.
4. POLITICAL FIGURES - USE CURRENT FACTS:
   - Donald Trump: Inaugurated as 47th U.S. President on January 20, 2025 (second term)
   - JD Vance: Current U.S. Vice President (since January 20, 2025)
   - Joe Biden: Former President (term ended January 20, 2025)
   - Kamala Harris: Former Vice President (term ended January 20, 2025)
5. For politicians: If they are currently serving in office, this MUST be stated clearly with their current title.
6. For business leaders: State their current company and role.
7. If someone was recently elected or appointed to a new role, mention this prominently.
8. IMPORTANT: DO NOT mention net worth, wealth, or financial figures in shortBio or longBio. Net worth goes ONLY in the estimatedNetWorth field.

Return a JSON object with exactly these fields:
{
  "shortBio": "A concise 2-3 sentence summary emphasizing their CURRENT primary role and achievements. DO NOT mention net worth here. (150-200 characters)",
  "longBio": "A comprehensive 4-6 sentence biography covering their current position, career highlights, and achievements. DO NOT mention net worth or wealth here. (400-600 characters)",
  "knownFor": "Their primary areas of expertise or fame, comma-separated",
  "fromCountry": "Their country of origin (full name)",
  "fromCountryCode": "ISO 3166-1 alpha-2 code",
  "basedIn": "Where they currently live or work (full name)", 
  "basedInCountryCode": "ISO 3166-1 alpha-2 code",
  "estimatedNetWorth": "Estimated net worth in ${currentYear} from authoritative sources. Use the EXACT figure from net worth search results."
}

Be factual, accurate, and emphasize their current status. Only return the JSON object, nothing else.`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_tokens: 1000,
        });
        
        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("No response from AI");
        
        const parsed = JSON.parse(content);
        
        const profileData: InsertCelebrityProfile = {
          personId: person.id,
          personName: person.name,
          shortBio: parsed.shortBio || "No biography available",
          longBio: parsed.longBio || null,
          knownFor: parsed.knownFor || "Various achievements",
          fromCountry: parsed.fromCountry || "Unknown",
          fromCountryCode: parsed.fromCountryCode?.toUpperCase() || "XX",
          basedIn: parsed.basedIn || "Unknown",
          basedInCountryCode: parsed.basedInCountryCode?.toUpperCase() || "XX",
          estimatedNetWorth: parsed.estimatedNetWorth || "Not available",
          generatedAt: new Date(),
        };
        
        const existing = await db.select().from(celebrityProfiles).where(
          eq(celebrityProfiles.personId, person.id)
        ).limit(1);
        
        if (existing.length > 0) {
          await db.update(celebrityProfiles)
            .set(profileData)
            .where(eq(celebrityProfiles.personId, person.id));
        } else {
          await db.insert(celebrityProfiles).values(profileData);
        }
        
        successCount++;
        console.log(`  ✓ ${person.name}: ${parsed.shortBio?.substring(0, 60)}...`);
      } catch (err: any) {
        errorCount++;
        console.error(`  ✗ ${person.name}: ${err.message}`);
      }
    }));
    
    if (i + batchSize < people.length) {
      console.log(`\nWaiting 2 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n========================================`);
  console.log(`Bulk refresh complete!`);
  console.log(`Success: ${successCount}/${people.length}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`========================================`);
  
  process.exit(0);
}

refreshAllProfiles().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
