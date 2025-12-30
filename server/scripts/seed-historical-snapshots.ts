import { db } from "../db";
import { trackedPeople, trendSnapshots, apiCache } from "@shared/schema";
import { computeTrendScore } from "../scoring/trendScore";

async function seedHistoricalSnapshots() {
  console.log("🕐 Generating historical trend snapshots for charts...\n");

  const people = await db.select().from(trackedPeople);
  console.log(`📊 Found ${people.length} celebrities`);

  const cachedData = await db.select().from(apiCache);
  
  const wikiCache = new Map<string, any>();
  const gdeltCache = new Map<string, any>();
  const serperCache = new Map<string, any>();
  const xCache = new Map<string, any>();
  
  for (const cache of cachedData) {
    try {
      const data = JSON.parse(cache.responseData);
      if (cache.provider === "wiki") {
        const slug = cache.cacheKey.replace("wiki:pageviews:", "");
        wikiCache.set(slug, data);
      } else if (cache.provider === "gdelt") {
        const name = cache.cacheKey.replace("gdelt:news:", "").replace(/_/g, " ");
        gdeltCache.set(name.toLowerCase(), data);
      } else if (cache.provider === "serper") {
        const name = cache.cacheKey.replace("serper:search:", "").replace(/_/g, " ");
        serperCache.set(name.toLowerCase(), data);
      } else if (cache.provider === "x") {
        const handle = cache.cacheKey.replace("x:metrics:", "");
        xCache.set(handle.toLowerCase(), data);
      }
    } catch (e) {}
  }

  const now = Date.now();
  const hoursToGenerate = 24 * 30;
  
  console.log(`\n📈 Generating ${hoursToGenerate} hours of historical data (30 days)...`);
  console.log("   This will create realistic trend variations over time.\n");

  let totalInserted = 0;

  for (const person of people) {
    const wiki = person.wikiSlug ? wikiCache.get(person.wikiSlug) : null;
    const news = gdeltCache.get(person.name.toLowerCase());
    const serper = serperCache.get(person.name.toLowerCase());
    const xMetrics = person.xHandle 
      ? xCache.get(person.xHandle.toLowerCase().replace("@", ""))
      : null;

    const baseInputs = {
      wikiPageviews: wiki?.pageviews24h || Math.random() * 100000,
      wikiDelta: wiki?.delta || 0,
      newsDelta: news?.delta || 0,
      searchDelta: serper?.delta || 0,
      xQuoteVelocity: xMetrics?.quoteVelocity || 0,
      xReplyVelocity: xMetrics?.replyVelocity || 0,
      activePlatforms: {
        wiki: !!person.wikiSlug,
        x: !!person.xHandle,
        instagram: !!person.instagramHandle,
        youtube: !!person.youtubeId,
      },
    };

    const baseScore = computeTrendScore(baseInputs);
    
    const snapshots = [];
    
    for (let hoursAgo = hoursToGenerate; hoursAgo >= 0; hoursAgo -= 1) {
      const timestamp = new Date(now - hoursAgo * 60 * 60 * 1000);
      
      const dayOfWeek = timestamp.getDay();
      const hourOfDay = timestamp.getHours();
      
      const weekdayMultiplier = dayOfWeek === 0 || dayOfWeek === 6 ? 0.85 : 1.0;
      const timeOfDayMultiplier = hourOfDay >= 9 && hourOfDay <= 21 ? 1.1 : 0.9;
      
      const trendMultiplier = 1 + (Math.random() - 0.5) * 0.15;
      const spikeChance = Math.random();
      const spikeMultiplier = spikeChance > 0.98 ? 1.5 : spikeChance > 0.95 ? 1.2 : 1.0;
      
      const finalMultiplier = weekdayMultiplier * timeOfDayMultiplier * trendMultiplier * spikeMultiplier;
      
      const adjustedScore = Math.round(baseScore.trendScore * finalMultiplier);
      
      snapshots.push({
        personId: person.id,
        timestamp,
        trendScore: adjustedScore,
        newsCount: news?.articleCount24h || 0,
        searchVolume: serper?.searchVolume || 0,
        youtubeViews: 0,
        spotifyFollowers: 0,
        wikiPageviews: wiki?.pageviews24h || 0,
        wikiDelta: wiki?.delta || 0,
        newsDelta: news?.delta || 0,
        searchDelta: serper?.delta || 0,
        xQuoteVelocity: xMetrics?.quoteVelocity || 0,
        xReplyVelocity: xMetrics?.replyVelocity || 0,
        massScore: baseScore.massScore,
        velocityScore: baseScore.velocityScore,
        confidence: baseScore.confidence,
        momentum: baseScore.momentum,
        drivers: baseScore.drivers,
      });
    }
    
    if (snapshots.length > 0) {
      const sample = snapshots.filter((_, i) => i % 4 === 0);
      
      for (const snapshot of sample) {
        await db.insert(trendSnapshots).values(snapshot);
        totalInserted++;
      }
    }
    
    process.stdout.write(`\r   Processing: ${person.name.padEnd(30)} `);
  }

  console.log(`\n\n✅ Inserted ${totalInserted} historical snapshots`);
  console.log("   Charts should now display 30 days of trend data!");
  
  const count = await db.select().from(trendSnapshots);
  console.log(`\n📊 Total snapshots in database: ${count.length}`);
}

seedHistoricalSnapshots()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
