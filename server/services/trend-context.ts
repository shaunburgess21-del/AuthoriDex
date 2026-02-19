import { db } from "../db";
import { trendSnapshots, trackedPeople, apiCache } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export type TrendDriver = "NEWS" | "SEARCH" | "WIKI";

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
  searchDelta: number,
  _xVelocity: number = 0,
  hasHeadlines: boolean = false
): { primary: TrendDriver | null; secondary: TrendDriver | null; strength: number } {
  const drivers: Array<{ type: TrendDriver; value: number }> = [
    { type: "WIKI", value: wikiDelta },
    { type: "NEWS", value: newsDelta },
    { type: "SEARCH", value: searchDelta },
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
    case "SEARCH": return "Search spiking";
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
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);
  
  const cacheKeys = [
    { key: `wiki:pageviews:${personData.wikiSlug}`, provider: "wiki" },
    { key: `gdelt:news:${personData.name.toLowerCase().replace(/ /g, "_")}`, provider: "gdelt" },
    { key: `serper:search:${personData.name.toLowerCase().replace(/ /g, "_")}`, provider: "serper" },
  ];
  
  const cacheResults = await db
    .select()
    .from(apiCache)
    .where(
      eq(apiCache.provider, "gdelt")
    );
  
  const gdeltCache = cacheResults.find(c => 
    c.cacheKey === `gdelt:news:${personData.name.toLowerCase().replace(/ /g, "_")}`
  );
  
  const allCache = await db.select().from(apiCache);
  const wikiCache = allCache.find(c => c.cacheKey === `wiki:pageviews:${personData.wikiSlug}`);
  const serperCache = allCache.find(c => c.cacheKey === `serper:search:${personData.name.toLowerCase().replace(/ /g, "_")}`);
  
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
  
  const isHeated = (newsDelta > 0.3 && searchDelta > 0.3);
  
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
  
  const people = await db.select().from(trackedPeople);
  const allSnapshots = await db
    .select()
    .from(trendSnapshots)
    .where(and(
      sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
      eq(trendSnapshots.snapshotOrigin, 'ingest')
    ))
    .orderBy(desc(trendSnapshots.timestamp));
  const allCache = await db.select().from(apiCache);
  
  const snapshotMap = new Map<string, typeof allSnapshots[0]>();
  for (const snap of allSnapshots) {
    if (!snapshotMap.has(snap.personId)) {
      snapshotMap.set(snap.personId, snap);
    }
  }
  
  const cacheMap = new Map<string, typeof allCache[0]>();
  for (const cache of allCache) {
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
      } catch (e) {}
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
    
    const isHeated = (newsDelta > 0.3 && searchDelta > 0.3);
    
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
