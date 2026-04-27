import { db } from "../db";
import { trendSnapshots, trackedPeople, apiCache } from "@shared/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";

// "SEARCH" was removed Apr 2026 (PR3 of trend-engine tuning). The Serper
// SERP-shape signal didn't measure search interest — it tracked structural
// SERP features (knowledge panels, related searches, PAA boxes) which are
// slow-changing and produced false-positive "Search spiking" badges.
// determinePrimaryDriver below dropped it from candidates at the same time;
// the type is narrowed here so consumers can drop their dead branches too.
export type TrendDriver = "NEWS" | "WIKI";

export interface TrendContext {
  primaryDriver: TrendDriver | null;
  secondaryDriver: TrendDriver | null;
  reasonTag: string;
  driverStrength: number;
  headlineSnippet: string | null;
  lastScoredAt: Date | null;
  sourceTimestamps: {
    wiki: Date | null;
    news: Date | null;
    search: Date | null;
  };
  isHeated: boolean;
}

const KEYWORD_MAPPINGS: Array<{
  keywords: string[];
  tag: string;
}> = [
  { keywords: ["earnings", "revenue", "stock", "shares", "profit", "quarterly", "fiscal", "market cap"], tag: "Earnings" },
  { keywords: ["arrested", "charges", "court", "lawsuit", "sued", "indicted", "trial", "verdict", "prison", "jail", "convicted"], tag: "Legal News" },
  { keywords: ["album", "tour", "single", "concert", "music", "song", "grammy", "billboard", "spotify"], tag: "Music" },
  { keywords: ["election", "campaign", "vote", "poll", "president", "congress", "senator", "governor", "political"], tag: "Politics" },
  { keywords: ["injury", "match", "championship", "playoff", "score", "game", "season", "draft", "trade", "team"], tag: "Sports" },
  { keywords: ["movie", "film", "trailer", "premiere", "oscar", "box office", "actor", "actress", "director", "netflix"], tag: "Music" },
  { keywords: ["married", "wedding", "divorce", "engaged", "dating", "relationship", "baby", "pregnant", "family"], tag: "Personal Life" },
  { keywords: ["died", "death", "passed away", "rip", "obituary", "funeral", "tribute", "memorial"], tag: "Breaking News" },
  { keywords: ["twitter", "tweet", "x.com", "viral", "meme", "trending", "post", "social media"], tag: "Viral Moment" },
  { keywords: ["controversy", "backlash", "criticism", "outrage", "scandal", "accused", "allegations"], tag: "Heated" },
  { keywords: ["announced", "launch", "reveal", "unveil", "new", "breaking"], tag: "Announcement" },
  { keywords: ["interview", "podcast", "appearance", "spoke", "said", "commented", "statement"], tag: "Public Appearance" },
  { keywords: ["ai", "tech", "technology", "startup", "company", "ceo", "founder", "innovation"], tag: "Tech News" },
  { keywords: ["billion", "million", "wealth", "rich", "net worth", "fortune", "investment", "deal"], tag: "Business" },
];

function extractReasonTag(headlines: string[]): { tag: string; confidence: number } {
  if (!headlines || headlines.length === 0) {
    return { tag: "In The News", confidence: 0 };
  }
  
  const keywordCounts: Record<string, number> = {};
  const allText = headlines.join(" ").toLowerCase();
  
  for (const mapping of KEYWORD_MAPPINGS) {
    let count = 0;
    for (const keyword of mapping.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "gi");
      const matches = allText.match(regex);
      if (matches) {
        count += matches.length;
      }
    }
    if (count > 0) {
      keywordCounts[mapping.tag] = count;
    }
  }
  
  const sortedTags = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]);
  
  if (sortedTags.length > 0 && sortedTags[0][1] >= 2) {
    return { tag: sortedTags[0][0], confidence: Math.min(1, sortedTags[0][1] / 5) };
  }
  
  if (sortedTags.length > 0) {
    const firstHeadline = headlines[0]?.toLowerCase() || "";
    for (const mapping of KEYWORD_MAPPINGS) {
      for (const keyword of mapping.keywords) {
        if (firstHeadline.includes(keyword)) {
          return { tag: mapping.tag, confidence: 0.7 };
        }
      }
    }
  }
  
  return { tag: "In The News", confidence: 0.3 };
}


function determinePrimaryDriver(
  wikiDelta: number,
  newsDelta: number,
  _searchDelta: number,
  _xVelocity: number = 0,
  hasHeadlines: boolean = false
): { primary: TrendDriver | null; secondary: TrendDriver | null; strength: number } {
  // SEARCH was dropped from candidates Apr 2026 (PR3 of trend-engine tuning).
  // Its source — Serper SERP-shape — never measured search volume; it
  // measured presence of SERP features (knowledge panels, related searches,
  // PAA boxes) which are slow-changing structural signals, not interest
  // velocity. Letting it win primary driver produced "Search spiking"
  // badges on the Hot Movers / Trending feed that didn't correspond to
  // any real change in the score (search weight is now 0 in scoring too).
  const drivers: Array<{ type: TrendDriver; value: number }> = [
    { type: "WIKI", value: wikiDelta },
    { type: "NEWS", value: newsDelta },
  ];

  drivers.sort((a, b) => b.value - a.value);

  const THRESHOLD = 0.02;

  let primary = drivers[0].value > THRESHOLD ? drivers[0] : null;

  if (!primary && hasHeadlines) {
    primary = { type: "NEWS", value: 0.1 };
  }

  const secondary = drivers[1].value > THRESHOLD && primary ? drivers[1] : null;

  return {
    primary: primary?.type || null,
    secondary: secondary?.type || null,
    strength: primary ? Math.min(100, Math.round(primary.value * 100)) : 0,
  };
}

function getDriverLabel(driver: TrendDriver | null): string {
  switch (driver) {
    case "NEWS": return "News surge";
    case "WIKI": return "Wiki views up";
    default: return "Steady";
  }
}


export async function getTrendContext(personId: string): Promise<TrendContext> {
  const person = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personId)).limit(1);
  
  if (person.length === 0) {
    return {
      primaryDriver: null,
      secondaryDriver: null,
      reasonTag: "Unknown",
      driverStrength: 0,
      headlineSnippet: null,
      lastScoredAt: null,
      sourceTimestamps: { wiki: null, news: null, search: null },
      isHeated: false,
    };
  }
  
  const personData = person[0];
  
  const latestSnapshot = await db
    .select()
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
      eq(trendSnapshots.snapshotOrigin, 'ingest')
    ))
    .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
    .limit(1);
  
  const personName = personData.name.toLowerCase().replace(/ /g, "_");
  const gdeltKey = `gdelt:news:${personName}`;
  const wikiKey = `wiki:pageviews:${personData.wikiSlug}`;
  const serperKey = `serper:search:${personName}`;

  const cacheResults = await db
    .select()
    .from(apiCache)
    .where(
      sql`${apiCache.cacheKey} IN (${gdeltKey}, ${wikiKey}, ${serperKey})`
    );
  
  const gdeltCache = cacheResults.find(c => c.cacheKey === gdeltKey);
  const wikiCache = cacheResults.find(c => c.cacheKey === wikiKey);
  const serperCache = cacheResults.find(c => c.cacheKey === serperKey);
  
  let headlines: string[] = [];
  if (gdeltCache) {
    try {
      const gdeltData = JSON.parse(gdeltCache.responseData);
      headlines = gdeltData.topHeadlines || [];
    } catch (e) {
    }
  }
  
  const snapshot = latestSnapshot[0];
  const wikiDelta = snapshot?.wikiDelta || 0;
  const newsDelta = snapshot?.newsDelta || 0;
  const searchDelta = snapshot?.searchDelta || 0;
  const hasHeadlines = headlines.length > 0;
  
  const { primary, secondary, strength } = determinePrimaryDriver(
    wikiDelta,
    newsDelta,
    searchDelta,
    0,
    hasHeadlines
  );
  
  let reasonTagResult = { tag: getDriverLabel(primary), confidence: 0 };
  
  if ((primary === "NEWS" || hasHeadlines) && headlines.length > 0) {
    reasonTagResult = extractReasonTag(headlines);
  }
  
  // Apr 2026 (PR3): isHeated was previously gated on `searchDelta > 0.3`,
  // but the Serper SERP-shape signal often returned 0 for legitimately
  // hot people, dragging this flag false. Re-anchor on news + wiki —
  // a person with both surging is unambiguously heated.
  const isHeated = (newsDelta > 0.3 && wikiDelta > 0.3);

  return {
    primaryDriver: primary,
    secondaryDriver: secondary,
    reasonTag: reasonTagResult.tag,
    driverStrength: strength,
    headlineSnippet: headlines[0] || null,
    lastScoredAt: snapshot?.timestamp || null,
    sourceTimestamps: {
      wiki: wikiCache?.fetchedAt || null,
      news: gdeltCache?.fetchedAt || null,
      search: serperCache?.fetchedAt || null,
    },
    isHeated,
  };
}

export function formatDriverBadge(driver: TrendDriver | null): string {
  return getDriverLabel(driver);
}

export function formatRelativeTime(date: Date | null): string {
  if (!date) return "N/A";
  
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export async function getTrendContextBatch(personIds: string[]): Promise<Map<string, TrendContext>> {
  const results = new Map<string, TrendContext>();
  if (personIds.length === 0) return results;

  const people = await db.select({
    id: trackedPeople.id,
    name: trackedPeople.name,
    wikiSlug: trackedPeople.wikiSlug,
  }).from(trackedPeople).where(inArray(trackedPeople.id, personIds));

  const batchSnapshots = await db
    .select({
      personId: trendSnapshots.personId,
      timestamp: trendSnapshots.timestamp,
      wikiDelta: trendSnapshots.wikiDelta,
      newsDelta: trendSnapshots.newsDelta,
      searchDelta: trendSnapshots.searchDelta,
    })
    .from(trendSnapshots)
    .where(and(
      inArray(trendSnapshots.personId, personIds),
      sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
      eq(trendSnapshots.snapshotOrigin, 'ingest'),
      sql`${trendSnapshots.timestamp} >= NOW() - INTERVAL '7 days'`
    ))
    .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id));

  const cacheKeys: string[] = [];
  for (const p of people) {
    const slug = p.name.toLowerCase().replace(/ /g, "_");
    cacheKeys.push(`gdelt:news:${slug}`);
    cacheKeys.push(`serper:search:${slug}`);
    if (p.wikiSlug) cacheKeys.push(`wiki:pageviews:${p.wikiSlug}`);
  }

  const batchCache = cacheKeys.length > 0
    ? await db.select({
        cacheKey: apiCache.cacheKey,
        fetchedAt: apiCache.fetchedAt,
        responseData: apiCache.responseData,
      }).from(apiCache).where(inArray(apiCache.cacheKey, cacheKeys))
    : [];

  const snapshotMap = new Map<string, typeof batchSnapshots[0]>();
  for (const snap of batchSnapshots) {
    if (!snapshotMap.has(snap.personId)) {
      snapshotMap.set(snap.personId, snap);
    }
  }
  
  const cacheMap = new Map<string, typeof batchCache[0]>();
  for (const cache of batchCache) {
    cacheMap.set(cache.cacheKey, cache);
  }
  
  for (const personId of personIds) {
    const person = people.find(p => p.id === personId);
    if (!person) {
      results.set(personId, {
        primaryDriver: null,
        secondaryDriver: null,
        reasonTag: "Unknown",
        driverStrength: 0,
        headlineSnippet: null,
        lastScoredAt: null,
        sourceTimestamps: { wiki: null, news: null, search: null },
        isHeated: false,
      });
      continue;
    }
    
    const snapshot = snapshotMap.get(personId);
    const gdeltKey = `gdelt:news:${person.name.toLowerCase().replace(/ /g, "_")}`;
    const gdeltCache = cacheMap.get(gdeltKey);
    
    let headlines: string[] = [];
    if (gdeltCache) {
      try {
        const gdeltData = JSON.parse(gdeltCache.responseData);
        headlines = gdeltData.topHeadlines || [];
      } catch (e) {
        console.error("[trend-context] Error parsing GDELT cache:", e);
      }
    }
    
    const wikiDelta = snapshot?.wikiDelta || 0;
    const newsDelta = snapshot?.newsDelta || 0;
    const searchDelta = snapshot?.searchDelta || 0;
    const hasHeadlines = headlines.length > 0;

    const { primary, secondary, strength } = determinePrimaryDriver(
      wikiDelta,
      newsDelta,
      searchDelta,
      0,
      hasHeadlines
    );

    let reasonTagResult = { tag: getDriverLabel(primary), confidence: 0 };
    if ((primary === "NEWS" || hasHeadlines) && headlines.length > 0) {
      reasonTagResult = extractReasonTag(headlines);
    }

    // See note in getTrendContext above — search dropped from heated gate.
    const isHeated = (newsDelta > 0.3 && wikiDelta > 0.3);
    
    const wikiKey = `wiki:pageviews:${person.wikiSlug}`;
    const serperKey = `serper:search:${person.name.toLowerCase().replace(/ /g, "_")}`;
    
    results.set(personId, {
      primaryDriver: primary,
      secondaryDriver: secondary,
      reasonTag: reasonTagResult.tag,
      driverStrength: strength,
      headlineSnippet: headlines[0] || null,
      lastScoredAt: snapshot?.timestamp || null,
      sourceTimestamps: {
        wiki: cacheMap.get(wikiKey)?.fetchedAt || null,
        news: gdeltCache?.fetchedAt || null,
        search: cacheMap.get(serperKey)?.fetchedAt || null,
      },
      isHeated,
    });
  }
  
  return results;
}
