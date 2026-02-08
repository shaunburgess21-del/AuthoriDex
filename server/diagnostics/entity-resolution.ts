import { db } from "../db";
import { trackedPeople, trendSnapshots } from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { fetch7DaySourceStats } from "../scoring/sourceStats";
import { normalizeSourceValue, DEFAULT_SOURCE_STATS } from "../scoring/normalize";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_BASE_URL = "https://google.serper.dev/search";

export interface EntityDiagnosticResult {
  personId: string;
  name: string;
  searchQueryUsed: string;
  wikiSlug: string | null;
  topResults: Array<{
    title: string;
    domain: string;
    snippet: string;
    position: number;
  }>;
  knowledgeGraph: {
    title: string | null;
    description: string | null;
    type: string | null;
  } | null;
  rawInputs: {
    wikiPageviews: number;
    wikiPageviews7dAvg: number;
    newsCount: number;
    searchVolume: number;
  };
  percentiles: {
    wikiPercentile: number;
    newsPercentile: number;
    searchPercentile: number;
  };
  latestFameIndex: number | null;
  latestRank: number | null;
  conclusion: "ENTITY_MATCH_OK" | "POSSIBLE_MISMATCH" | "NO_DATA";
  mismatchReasons: string[];
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function assessEntityMatch(
  name: string,
  topResults: EntityDiagnosticResult["topResults"],
  knowledgeGraph: EntityDiagnosticResult["knowledgeGraph"],
): { conclusion: EntityDiagnosticResult["conclusion"]; reasons: string[] } {
  const reasons: string[] = [];
  const nameParts = name.toLowerCase().split(/\s+/);
  const lastName = nameParts[nameParts.length - 1];
  const firstName = nameParts[0];

  if (topResults.length === 0) {
    return { conclusion: "NO_DATA", reasons: ["No Serper results returned"] };
  }

  let nameMatchCount = 0;
  for (const result of topResults.slice(0, 3)) {
    const titleLower = result.title.toLowerCase();
    const snippetLower = result.snippet.toLowerCase();
    const combined = titleLower + " " + snippetLower;

    if (combined.includes(lastName) && combined.includes(firstName)) {
      nameMatchCount++;
    }
  }

  if (nameMatchCount === 0) {
    reasons.push(`Name "${name}" not found in top 3 result titles/snippets`);
  }

  if (knowledgeGraph?.title) {
    const kgTitleLower = knowledgeGraph.title.toLowerCase();
    if (!kgTitleLower.includes(lastName)) {
      reasons.push(`Knowledge Graph title "${knowledgeGraph.title}" doesn't match name`);
    }
  } else {
    reasons.push("No Knowledge Graph present (less prominent entity)");
  }

  const topDomains = topResults.slice(0, 3).map(r => r.domain);
  const hasWikipedia = topDomains.some(d => d.includes("wikipedia"));
  if (!hasWikipedia) {
    reasons.push("Wikipedia not in top 3 search results");
  }

  if (nameMatchCount >= 2 && (knowledgeGraph?.title || hasWikipedia)) {
    return { conclusion: "ENTITY_MATCH_OK", reasons: [] };
  }

  if (nameMatchCount >= 1 && reasons.length <= 1) {
    return { conclusion: "ENTITY_MATCH_OK", reasons: [] };
  }

  return { conclusion: "POSSIBLE_MISMATCH", reasons };
}

export async function runEntityDiagnostic(personId: string): Promise<EntityDiagnosticResult | null> {
  const [person] = await db
    .select()
    .from(trackedPeople)
    .where(eq(trackedPeople.id, personId))
    .limit(1);

  if (!person) return null;

  const searchQueryUsed = person.searchQueryOverride || person.name;

  let topResults: EntityDiagnosticResult["topResults"] = [];
  let knowledgeGraph: EntityDiagnosticResult["knowledgeGraph"] = null;

  if (SERPER_API_KEY) {
    try {
      const response = await fetch(SERPER_BASE_URL, {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: searchQueryUsed,
          num: 10,
          gl: "us",
          hl: "en",
        }),
      });

      if (response.ok) {
        const data = await response.json();

        topResults = (data.organic || []).slice(0, 3).map((r: any, i: number) => ({
          title: r.title || "",
          domain: extractDomain(r.link || ""),
          snippet: r.snippet || "",
          position: r.position || i + 1,
        }));

        if (data.knowledgeGraph) {
          knowledgeGraph = {
            title: data.knowledgeGraph.title || null,
            description: data.knowledgeGraph.description || null,
            type: data.knowledgeGraph.type || null,
          };
        }
      }
    } catch (err) {
      console.error(`[EntityDiag] Serper fetch failed for ${person.name}:`, err);
    }
  }

  const latestSnapshot = await db
    .select({
      fameIndex: trendSnapshots.fameIndex,
      wikiPageviews: trendSnapshots.wikiPageviews,
      newsCount: trendSnapshots.newsCount,
      searchVolume: trendSnapshots.searchVolume,
    })
    .from(trendSnapshots)
    .where(
      and(
        eq(trendSnapshots.personId, personId),
        eq(trendSnapshots.snapshotOrigin, "ingest"),
        sql`timestamp = date_trunc('hour', timestamp)`
      )
    )
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);

  const snapshot = latestSnapshot[0];

  let sourceStats = DEFAULT_SOURCE_STATS;
  try {
    sourceStats = await fetch7DaySourceStats();
  } catch {
  }

  const wikiRaw = snapshot?.wikiPageviews ?? 0;
  const newsRaw = snapshot?.newsCount ?? 0;
  const searchRaw = snapshot?.searchVolume ?? 0;

  const wikiPercentile = normalizeSourceValue(wikiRaw, sourceStats.wiki);
  const newsPercentile = normalizeSourceValue(newsRaw, sourceStats.news);
  const searchPercentile = normalizeSourceValue(searchRaw, sourceStats.search);

  const allPeople = await db
    .select({ id: trackedPeople.id })
    .from(trackedPeople);

  let latestRank: number | null = null;
  if (snapshot?.fameIndex !== null && snapshot?.fameIndex !== undefined) {
    const rankResult = await db.execute(sql`
      SELECT COUNT(*) + 1 as rank FROM (
        SELECT DISTINCT ON (person_id) fame_index
        FROM trend_snapshots
        WHERE snapshot_origin = 'ingest'
          AND timestamp = date_trunc('hour', timestamp)
        ORDER BY person_id, timestamp DESC
      ) latest
      WHERE fame_index > ${snapshot.fameIndex}
    `);
    latestRank = Number(rankResult.rows?.[0]?.rank ?? null);
  }

  const { conclusion, reasons } = assessEntityMatch(person.name, topResults, knowledgeGraph);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const wikiAvgResult = await db.execute(sql`
    SELECT AVG(wiki_pageviews) as avg_wiki
    FROM trend_snapshots
    WHERE person_id = ${personId}
      AND snapshot_origin = 'ingest'
      AND timestamp = date_trunc('hour', timestamp)
      AND timestamp >= ${sevenDaysAgo}
  `);
  const wikiPageviews7dAvg = Number(wikiAvgResult.rows?.[0]?.avg_wiki ?? 0);

  return {
    personId: person.id,
    name: person.name,
    searchQueryUsed,
    wikiSlug: person.wikiSlug,
    topResults,
    knowledgeGraph,
    rawInputs: {
      wikiPageviews: wikiRaw,
      wikiPageviews7dAvg,
      newsCount: newsRaw,
      searchVolume: searchRaw,
    },
    percentiles: {
      wikiPercentile: Math.round(wikiPercentile * 1000) / 1000,
      newsPercentile: Math.round(newsPercentile * 1000) / 1000,
      searchPercentile: Math.round(searchPercentile * 1000) / 1000,
    },
    latestFameIndex: snapshot?.fameIndex ?? null,
    latestRank,
    conclusion,
    mismatchReasons: reasons,
  };
}

export async function runBatchEntityDiagnostic(
  personIds?: string[]
): Promise<EntityDiagnosticResult[]> {
  let people;
  if (personIds && personIds.length > 0) {
    people = await db
      .select({ id: trackedPeople.id })
      .from(trackedPeople)
      .where(sql`id = ANY(${personIds})`);
  } else {
    people = await db
      .select({ id: trackedPeople.id })
      .from(trackedPeople);
  }

  const results: EntityDiagnosticResult[] = [];
  for (const person of people) {
    const result = await runEntityDiagnostic(person.id);
    if (result) {
      results.push(result);
    }
    if (!personIds) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  results.sort((a, b) => {
    const order = { POSSIBLE_MISMATCH: 0, NO_DATA: 1, ENTITY_MATCH_OK: 2 };
    return order[a.conclusion] - order[b.conclusion];
  });

  return results;
}
