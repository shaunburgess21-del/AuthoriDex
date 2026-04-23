import { randomUUID } from "crypto";
import { db, withDbAdvisoryLock } from "../db";
import { predictionMarkets, marketEntries, trackedPeople, trendingPeople } from "@shared/schema";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { eq, and, desc, inArray, sql, gte } from "drizzle-orm";
import { buildOpeningScores } from "../native-markets/openingScores";
import { getWeeklyBettingCutoff as getWeeklyBettingCutoffForEndAt } from "../native-markets/lifecycle";
import { getWeekContext as getUtcWeekContext } from "../native-markets/week-context";
import { log } from "../log";

const MARKET_GENERATOR_LOCK_KEY = 5_204;
const MARKET_GENERATOR_RETRY_DELAY_MS = 15 * 60 * 1000;
const MARKET_GENERATOR_MAX_RETRIES = 4;

export function getWeeklyBettingCutoff(endAt: Date): Date {
  return getWeeklyBettingCutoffForEndAt(endAt);
}

export function getWeekContext(now = new Date()) {
  return getUtcWeekContext(now);
}

async function countOpenNativeMarketsForWeek(weekNumber: number, monday: Date): Promise<number> {
  const [openCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.status, "OPEN"),
      inArray(predictionMarkets.marketType, ["updown", "h2h", "gainer", "jackpot"]),
      eq(predictionMarkets.weekNumber, weekNumber),
      gte(predictionMarkets.endAt, monday),
    ));
  return openCount?.count ?? 0;
}

export async function generateWeeklyUpDown(): Promise<number> {
  const { monday, sunday, weekNumber } = getWeekContext();
  let people = await db.select().from(trackedPeople).where(eq(trackedPeople.status, "main_leaderboard"));

  if (people.length === 0) {
    log(`[MarketGenerator:UpDown] No trackedPeople found, falling back to trendingPeople`);
    const trending = await db
      .select({ id: trendingPeople.id, name: trendingPeople.name, category: trendingPeople.category, avatar: trendingPeople.avatar })
      .from(trendingPeople)
      .orderBy(desc(trendingPeople.fameIndex))
      .limit(100);
    people = trending.map(t => ({
      ...t,
      category: t.category || "misc",
      displayOrder: 0,
      imageSlug: null as string | null,
      bio: null as string | null,
      youtubeId: null as string | null,
      spotifyId: null as string | null,
      wikiSlug: null as string | null,
      xHandle: null as string | null,
      instagramHandle: null as string | null,
      tiktokHandle: null as string | null,
      searchQueryOverride: null as string | null,
      newsQueryWidened: null as string | null,
      status: "main_leaderboard",
    }));
    log(`[MarketGenerator:UpDown] Fallback: ${people.length} people from trendingPeople`);
  }

  const existing = await db.select({ personId: predictionMarkets.personId })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.marketType, "updown"),
      eq(predictionMarkets.weekNumber, weekNumber),
      gte(predictionMarkets.endAt, monday),
    ));
  const existingPersonIds = new Set(existing.map(e => e.personId));

  const personIdList = people.map(p => p.id);
  // Only scan the last 14 days of snapshots. Snapshots are written every 10
  // minutes for active people so the "latest" snapshot is virtually always
  // within hours; 14 days is a generous cushion. Without this bound the
  // planner sometimes falls off the (person_id, timestamp DESC) index on a
  // long IN-list and times out on Supabase's statement_timeout.
  const openingSnapRows = personIdList.length > 0
    ? await db.execute(sql`
        SELECT DISTINCT ON (person_id) person_id, fame_index, timestamp
        FROM trend_snapshots
        WHERE person_id IN (${sql.join(personIdList.map(id => sql`${id}`), sql`, `)})
          AND timestamp > NOW() - INTERVAL '14 days'
        ORDER BY person_id, timestamp DESC
      `)
    : { rows: [] };
  const openingScoreMap = new Map<string, { score: number; snapshotAt: string }>();
  for (const row of (openingSnapRows.rows || [])) {
    if (row.fame_index != null) {
      openingScoreMap.set(String(row.person_id), {
        score: Number(row.fame_index),
        snapshotAt: new Date(row.timestamp as string).toISOString(),
      });
    }
  }

  let created = 0;
  for (const person of people) {
    if (existingPersonIds.has(person.id)) continue;
    const slug = `updown-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;
    const openScore = openingScoreMap.get(person.id);

    const values = {
      marketType: "updown" as const,
      title: `${person.name}: Up or Down?`,
      slug,
      personId: person.id,
      category: normalizeMarketCategory(person.category),
      visibility: "live" as const,
      status: "OPEN" as const,
      startAt: monday,
      endAt: sunday,
      closeAt: getWeeklyBettingCutoff(sunday),
      weekNumber,
      seedParticipants: 0,
      seedVolume: "0",
      metadata: openScore ? { openingScore: { personId: person.id, score: openScore.score, snapshotAt: openScore.snapshotAt } } : undefined,
      seedConfig: { enabled: true, targetParticipantsMin: 30, targetParticipantsMax: 80, targetPoolMin: 5000, targetPoolMax: 15000, distributionBias: { up: 55, down: 45 } },
      featured: false,
    };

    try {
      const [market] = await db.insert(predictionMarkets).values(values).returning();
      await db.insert(marketEntries).values([
        { marketId: market.id, entryType: "custom", label: "Up", displayOrder: 0, seedCount: 0 },
        { marketId: market.id, entryType: "custom", label: "Down", displayOrder: 1, seedCount: 0 },
      ]);
      created++;
    } catch (slugErr: any) {
      if (slugErr.code === "23505") {
        const slugRetry = `${slug}-${randomUUID().slice(0, 6)}`;
        const [market] = await db.insert(predictionMarkets).values({ ...values, slug: slugRetry }).returning();
        await db.insert(marketEntries).values([
          { marketId: market.id, entryType: "custom", label: "Up", displayOrder: 0, seedCount: 0 },
          { marketId: market.id, entryType: "custom", label: "Down", displayOrder: 1, seedCount: 0 },
        ]);
        created++;
      } else {
        log(`[MarketGenerator] updown slug error for ${person.name}: ${slugErr.message}`);
      }
    }
  }
  return created;
}

/**
 * Ensure the current week's Up/Down market exists for a single inductee (idempotent).
 */
export async function ensureUpDownMarketForInductee(person: {
  id: string;
  name: string;
  category: string;
}): Promise<"created" | "skipped" | "failed"> {
  const { monday, sunday, weekNumber } = getWeekContext();
  const [already] = await db
    .select({ id: predictionMarkets.id })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "updown"),
        eq(predictionMarkets.weekNumber, weekNumber),
        eq(predictionMarkets.personId, person.id),
      ),
    )
    .limit(1);
  if (already) return "skipped";

  const snapRows = await db.execute(sql`
    SELECT fame_index, timestamp
    FROM trend_snapshots
    WHERE person_id = ${person.id}
    ORDER BY timestamp DESC
    LIMIT 1
  `);
  let openScore: { score: number; snapshotAt: string } | undefined;
  const row = (snapRows.rows || [])[0] as
    | { fame_index: unknown; timestamp: unknown }
    | undefined;
  if (row?.fame_index != null) {
    openScore = {
      score: Number(row.fame_index),
      snapshotAt: new Date(String(row.timestamp)).toISOString(),
    };
  }

  const slug = `updown-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-week-${weekNumber}`;
  const values = {
    marketType: "updown" as const,
    title: `${person.name}: Up or Down?`,
    slug,
    personId: person.id,
    category: normalizeMarketCategory(person.category),
    visibility: "live" as const,
    status: "OPEN" as const,
    startAt: monday,
    endAt: sunday,
    closeAt: getWeeklyBettingCutoff(sunday),
    weekNumber,
    seedParticipants: 0,
    seedVolume: "0",
    metadata: openScore
      ? {
          openingScore: {
            personId: person.id,
            score: openScore.score,
            snapshotAt: openScore.snapshotAt,
          },
        }
      : undefined,
    seedConfig: {
      enabled: true,
      targetParticipantsMin: 30,
      targetParticipantsMax: 80,
      targetPoolMin: 5000,
      targetPoolMax: 15000,
      distributionBias: { up: 55, down: 45 },
    },
    featured: false,
  };

  try {
    const [market] = await db.insert(predictionMarkets).values(values).returning();
    await db.insert(marketEntries).values([
      { marketId: market.id, entryType: "custom", label: "Up", displayOrder: 0, seedCount: 0 },
      { marketId: market.id, entryType: "custom", label: "Down", displayOrder: 1, seedCount: 0 },
    ]);
    return "created";
  } catch (slugErr: any) {
    if (slugErr.code === "23505") {
      try {
        const slugRetry = `${slug}-${randomUUID().slice(0, 6)}`;
        const [market] = await db
          .insert(predictionMarkets)
          .values({ ...values, slug: slugRetry })
          .returning();
        await db.insert(marketEntries).values([
          { marketId: market.id, entryType: "custom", label: "Up", displayOrder: 0, seedCount: 0 },
          { marketId: market.id, entryType: "custom", label: "Down", displayOrder: 1, seedCount: 0 },
        ]);
        return "created";
      } catch {
        log(`[MarketGenerator] ensureUpDown retry failed for ${person.name}`);
        return "failed";
      }
    }
    log(`[MarketGenerator] ensureUpDown error for ${person.name}: ${slugErr.message}`);
    return "failed";
  }
}

/**
 * If an OPEN gainer market exists for this week + category, add the inductee if missing.
 */
export async function backfillGainerMarketForInductee(person: {
  id: string;
  name: string;
  category: string;
  avatar?: string | null;
}): Promise<"added" | "skipped" | "no_market"> {
  const { weekNumber } = getWeekContext();
  const cat = normalizeMarketCategory(person.category || "misc");

  const [existingMarket] = await db
    .select({ id: predictionMarkets.id })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "gainer"),
        eq(predictionMarkets.weekNumber, weekNumber),
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.category, cat),
      ),
    )
    .limit(1);

  if (!existingMarket) return "no_market";

  const currentEntries = await db
    .select({ personId: marketEntries.personId })
    .from(marketEntries)
    .where(eq(marketEntries.marketId, existingMarket.id));
  if (currentEntries.some((e) => e.personId === person.id)) return "skipped";

  const startOrder = currentEntries.length;
  await db.insert(marketEntries).values({
    marketId: existingMarket.id,
    entryType: "person",
    personId: person.id,
    label: person.name,
    displayOrder: startOrder,
    seedCount: 0,
    imageUrl: person.avatar ?? null,
  });
  return "added";
}

export async function generateWeeklyJackpot(): Promise<number> {
  const { monday, sunday, weekNumber } = getWeekContext();
  let people = await db.select().from(trackedPeople).where(eq(trackedPeople.status, "main_leaderboard"));

  if (people.length === 0) {
    log(`[MarketGenerator:Jackpot] No trackedPeople found, falling back to trendingPeople`);
    const trending = await db
      .select({ id: trendingPeople.id, name: trendingPeople.name, category: trendingPeople.category, avatar: trendingPeople.avatar })
      .from(trendingPeople)
      .orderBy(desc(trendingPeople.fameIndex))
      .limit(100);
    people = trending.map(t => ({
      ...t,
      category: t.category || "misc",
      displayOrder: 0,
      imageSlug: null as string | null,
      bio: null as string | null,
      youtubeId: null as string | null,
      spotifyId: null as string | null,
      wikiSlug: null as string | null,
      xHandle: null as string | null,
      instagramHandle: null as string | null,
      tiktokHandle: null as string | null,
      searchQueryOverride: null as string | null,
      newsQueryWidened: null as string | null,
      status: "main_leaderboard",
    }));
    log(`[MarketGenerator:Jackpot] Fallback: ${people.length} people from trendingPeople`);
  }

  const existing = await db.select({ personId: predictionMarkets.personId })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.marketType, "jackpot"),
      eq(predictionMarkets.weekNumber, weekNumber),
      gte(predictionMarkets.endAt, monday),
    ));
  const existingPersonIds = new Set(existing.map(e => e.personId));

  let created = 0;
  for (const person of people) {
    if (existingPersonIds.has(person.id)) continue;
    const slug = `jackpot-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;
    const values = {
      marketType: "jackpot" as const,
      title: `${person.name}: Predict Exact Score`,
      slug,
      personId: person.id,
      category: normalizeMarketCategory(person.category),
      visibility: "live" as const,
      status: "OPEN" as const,
      startAt: monday,
      endAt: sunday,
      closeAt: getWeeklyBettingCutoff(sunday),
      weekNumber,
      seedParticipants: 0,
      seedVolume: "0",
      seedConfig: { enabled: true, targetParticipantsMin: 10, targetParticipantsMax: 40, targetPoolMin: 2000, targetPoolMax: 8000 },
      featured: false,
    };

    try {
      const [newMarket] = await db.insert(predictionMarkets).values(values).returning({ id: predictionMarkets.id });
      await db.insert(marketEntries).values({ marketId: newMarket.id, entryType: "custom", label: "Score Prediction", displayOrder: 0 });
      created++;
    } catch (slugErr: any) {
      if (slugErr.code === "23505") {
        const slugRetry = `${slug}-${randomUUID().slice(0, 6)}`;
        const [newMarket] = await db.insert(predictionMarkets).values({ ...values, slug: slugRetry }).returning({ id: predictionMarkets.id });
        await db.insert(marketEntries).values({ marketId: newMarket.id, entryType: "custom", label: "Score Prediction", displayOrder: 0 });
        created++;
      }
    }
  }
  return created;
}

export async function generateWeeklyH2H(): Promise<number> {
  const { monday, sunday, weekNumber } = getWeekContext();

  const top = await db
    .select({ id: trendingPeople.id, name: trendingPeople.name, category: trendingPeople.category, fameIndex: trendingPeople.fameIndex })
    .from(trendingPeople)
    .orderBy(desc(trendingPeople.fameIndex))
    .limit(30);

  if (top.length < 2) return 0;

  const created: number = await db.transaction(async (tx) => {
    const existingH2H = await tx
      .select({ slug: predictionMarkets.slug })
      .from(predictionMarkets)
      .where(and(eq(predictionMarkets.marketType, "h2h"), eq(predictionMarkets.weekNumber, weekNumber)));
    const existingSlugs = new Set(existingH2H.map(e => e.slug));

    if (existingH2H.length > 0) {
      await tx.update(predictionMarkets)
        .set({ visibility: "archived", updatedAt: new Date() })
        .where(and(eq(predictionMarkets.marketType, "h2h"), eq(predictionMarkets.weekNumber, weekNumber), eq(predictionMarkets.status, "OPEN")));
    }

    const byCategory = new Map<string, typeof top>();
    for (const person of top) {
      const cat = (person.category || "misc").toLowerCase();
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(person);
    }

    const pairings: [typeof top[0], typeof top[0]][] = [];
    const paired = new Set<string>();
    for (const [, group] of Array.from(byCategory)) {
      for (let i = 0; i < group.length - 1 && pairings.length < 15; i += 2) {
        pairings.push([group[i], group[i + 1]]);
        paired.add(group[i].id);
        paired.add(group[i + 1].id);
      }
    }
    if (pairings.length < 15) {
      const unpaired = top.filter(p => !paired.has(p.id));
      for (let i = unpaired.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unpaired[i], unpaired[j]] = [unpaired[j], unpaired[i]];
      }
      for (let i = 0; i < unpaired.length - 1 && pairings.length < 15; i += 2) {
        pairings.push([unpaired[i], unpaired[i + 1]]);
      }
    }

    const allPersonIds = Array.from(new Set(pairings.flatMap(([a, b]) => [a.id, b.id])));
    const snapRows = allPersonIds.length > 0
      ? await tx.execute(sql`
          SELECT DISTINCT ON (person_id) person_id, fame_index, timestamp
          FROM trend_snapshots
          WHERE person_id IN (${sql.join(allPersonIds.map(id => sql`${id}`), sql`, `)})
            AND timestamp > NOW() - INTERVAL '14 days'
          ORDER BY person_id, timestamp DESC
        `)
      : { rows: [] };
    const snapMap = new Map<string, { score: number; snapshotAt: string }>();
    for (const row of (snapRows.rows || [])) {
      if (row.fame_index != null) {
        snapMap.set(String(row.person_id), { score: Number(row.fame_index), snapshotAt: new Date(row.timestamp as string).toISOString() });
      }
    }

    let createdCount = 0;
    for (const [personA, personB] of pairings) {
      const baseSlug = `h2h-${personA.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-vs-${personB.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;
      const openingScores = buildOpeningScores([personA.id, personB.id], snapMap);
      const h2hMeta = openingScores.length > 0 ? { openingScores } : undefined;
      const catA = normalizeMarketCategory(personA.category);
      const catB = normalizeMarketCategory(personB.category);
      const h2hCategory = catA === catB ? catA : "trending";

      let slug = baseSlug;
      while (existingSlugs.has(slug)) slug = `${baseSlug}-${randomUUID().slice(0, 6)}`;

      const [market] = await tx.insert(predictionMarkets).values({
        marketType: "h2h",
        title: `${personA.name} vs ${personB.name}`,
        slug,
        category: h2hCategory,
        visibility: "live",
        status: "OPEN",
        startAt: monday,
        endAt: sunday,
        closeAt: getWeeklyBettingCutoff(sunday),
        weekNumber,
        seedParticipants: 0,
        seedVolume: "0",
        metadata: h2hMeta,
        seedConfig: { enabled: true, targetParticipantsMin: 40, targetParticipantsMax: 120, targetPoolMin: 10000, targetPoolMax: 35000, distributionBias: { personA: 50, personB: 50 } },
        featured: false,
      }).returning();

      await tx.insert(marketEntries).values([
        { marketId: market.id, entryType: "person", personId: personA.id, label: personA.name, displayOrder: 0, seedCount: 0, imageUrl: null },
        { marketId: market.id, entryType: "person", personId: personB.id, label: personB.name, displayOrder: 1, seedCount: 0, imageUrl: null },
      ]);
      createdCount++;
      existingSlugs.add(slug);
    }
    return createdCount;
  });

  return created;
}

export async function generateWeeklyGainer(): Promise<{ created: number; updated: number }> {
  const { monday, sunday, weekNumber } = getWeekContext();
  log(`[MarketGenerator:Gainer] Starting for week ${weekNumber} (${monday.toISOString()} – ${sunday.toISOString()})`);

  const existingGainers = await db
    .select({ category: predictionMarkets.category })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.marketType, "gainer"),
      eq(predictionMarkets.weekNumber, weekNumber),
      eq(predictionMarkets.status, "OPEN"),
      inArray(predictionMarkets.visibility, ["live", "inactive"])
    ));
  const existingCategories = new Set(existingGainers.map(e => normalizeMarketCategory(e.category)));
  if (existingCategories.size > 0) {
    log(`[MarketGenerator:Gainer] Existing categories for week ${weekNumber}: ${Array.from(existingCategories).join(", ")}`);
  }

  let people = await db.select().from(trackedPeople).where(eq(trackedPeople.status, "main_leaderboard"));
  log(`[MarketGenerator:Gainer] trackedPeople with main_leaderboard status: ${people.length}`);

  let usedFallback = false;
  if (people.length === 0) {
    log(`[MarketGenerator:Gainer] No trackedPeople found, falling back to trendingPeople`);
    const trending = await db
      .select({ id: trendingPeople.id, name: trendingPeople.name, category: trendingPeople.category, avatar: trendingPeople.avatar })
      .from(trendingPeople)
      .orderBy(desc(trendingPeople.fameIndex))
      .limit(100);
    people = trending.map(t => ({
      ...t,
      category: t.category || "misc",
      displayOrder: 0,
      imageSlug: null as string | null,
      bio: null as string | null,
      youtubeId: null as string | null,
      spotifyId: null as string | null,
      wikiSlug: null as string | null,
      xHandle: null as string | null,
      instagramHandle: null as string | null,
      tiktokHandle: null as string | null,
      searchQueryOverride: null as string | null,
      newsQueryWidened: null as string | null,
      status: "main_leaderboard",
    }));
    usedFallback = true;
    log(`[MarketGenerator:Gainer] Fallback: ${people.length} people from trendingPeople`);
  }

  const byCategory = new Map<string, typeof people>();
  for (const person of people) {
    const cat = normalizeMarketCategory(person.category || "misc");
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(person);
  }

  const categoryBreakdown = Array.from(byCategory.entries()).map(([cat, p]) => `${cat}(${p.length})`).join(", ");
  log(`[MarketGenerator:Gainer] Categories: ${categoryBreakdown || "(none)"}`);

  const allIds = people.map(p => p.id);
  const liveScores = allIds.length > 0
    ? await db.select({ id: trendingPeople.id, fameIndex: trendingPeople.fameIndex }).from(trendingPeople).where(inArray(trendingPeople.id, allIds))
    : [];
  const scoreMap = new Map(liveScores.map(p => [p.id, p.fameIndex ?? 0]));

  const snapRows = allIds.length > 0
    ? await db.execute(sql`
        SELECT DISTINCT ON (person_id) person_id, fame_index, timestamp
        FROM trend_snapshots
        WHERE person_id IN (${sql.join(allIds.map(id => sql`${id}`), sql`, `)})
          AND timestamp > NOW() - INTERVAL '14 days'
        ORDER BY person_id, timestamp DESC
      `)
    : { rows: [] };
  const snapMap = new Map<string, { score: number; snapshotAt: string }>();
  for (const row of (snapRows.rows || [])) {
    if (row.fame_index != null) {
      snapMap.set(String(row.person_id), { score: Number(row.fame_index), snapshotAt: new Date(row.timestamp as string).toISOString() });
    }
  }

  let created = 0;
  let updated = 0;
  let skippedTooFew = 0;
  for (const [cat, catPeople] of Array.from(byCategory.entries())) {
    if (catPeople.length < 3) {
      log(`[MarketGenerator:Gainer] Skipping ${cat}: only ${catPeople.length} people (need ≥3)`);
      skippedTooFew++;
      continue;
    }

    const ranked = [...catPeople].sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));

    if (existingCategories.has(cat)) {
      try {
        const [existingMarket] = await db.select({ id: predictionMarkets.id })
          .from(predictionMarkets)
          .where(and(
            eq(predictionMarkets.marketType, "gainer"),
            eq(predictionMarkets.weekNumber, weekNumber),
            eq(predictionMarkets.status, "OPEN"),
            eq(predictionMarkets.category, cat),
          ))
          .limit(1);
        if (!existingMarket) continue;

        const currentEntries = await db.select({ personId: marketEntries.personId })
          .from(marketEntries)
          .where(eq(marketEntries.marketId, existingMarket.id));
        const existingPersonIds = new Set(currentEntries.map(e => e.personId));
        const missing = ranked.filter(p => !existingPersonIds.has(p.id));

        if (missing.length > 0) {
          const startOrder = currentEntries.length;
          await db.insert(marketEntries).values(
            missing.map((person, idx) => ({
              marketId: existingMarket.id,
              entryType: "person" as const,
              personId: person.id,
              label: person.name,
              displayOrder: startOrder + idx,
              seedCount: 0,
              imageUrl: person.avatar,
            }))
          );
          updated++;
          log(`[MarketGenerator:Gainer] Backfilled ${missing.length} entries into ${cat} (market ${existingMarket.id})`);
        } else {
          log(`[MarketGenerator:Gainer] ${cat}: already up-to-date (${currentEntries.length} entries)`);
        }
      } catch (backfillErr: any) {
        log(`[MarketGenerator:Gainer] Backfill failed for ${cat}: ${backfillErr.message}`);
      }
      continue;
    }
    const openingScores = buildOpeningScores(ranked.map(p => p.id), snapMap);
    const gainerMeta = openingScores.length > 0 ? { openingScores } : undefined;

    const title = `Category Race: ${getMarketCategoryLabel(cat)}`;
    let slug = `gainer-${cat}-week-${weekNumber}`;

    const slugExists = await db.select({ id: predictionMarkets.id })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.slug, slug))
      .limit(1);
    if (slugExists.length > 0) {
      slug = `${slug}-${randomUUID().slice(0, 6)}`;
    }

    try {
      await db.transaction(async (tx) => {
        try {
          const [market] = await tx.insert(predictionMarkets).values({
            marketType: "gainer",
            title,
            slug,
            category: cat,
            visibility: "live",
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            closeAt: getWeeklyBettingCutoff(sunday),
            weekNumber,
            seedParticipants: 0,
            seedVolume: "0",
            metadata: gainerMeta,
            seedConfig: { enabled: true, targetParticipantsMin: 25, targetParticipantsMax: 60, targetPoolMin: 8000, targetPoolMax: 20000, distributionBias: {} },
            featured: false,
          }).returning();
          const entryValues = ranked.map((person, idx) => ({
            marketId: market.id,
            entryType: "person" as const,
            personId: person.id,
            label: person.name,
            displayOrder: idx,
            seedCount: 0,
            imageUrl: person.avatar,
          }));
          await tx.insert(marketEntries).values(entryValues);
          created++;
        } catch (slugErr: any) {
          if (slugErr.code === "23505") {
            slug = `${slug}-${randomUUID().slice(0, 6)}`;
            const [market] = await tx.insert(predictionMarkets).values({
              marketType: "gainer",
              title,
              slug,
              category: cat,
              visibility: "live",
              status: "OPEN",
              startAt: monday,
              endAt: sunday,
              closeAt: getWeeklyBettingCutoff(sunday),
              weekNumber,
              seedParticipants: 0,
              seedVolume: "0",
              metadata: gainerMeta,
              seedConfig: { enabled: true, targetParticipantsMin: 25, targetParticipantsMax: 60, targetPoolMin: 8000, targetPoolMax: 20000, distributionBias: {} },
              featured: false,
            }).returning();
            const entryValues = ranked.map((person, idx) => ({
              marketId: market.id,
              entryType: "person" as const,
              personId: person.id,
              label: person.name,
              displayOrder: idx,
              seedCount: 0,
              imageUrl: person.avatar,
            }));
            await tx.insert(marketEntries).values(entryValues);
            created++;
          } else {
            throw slugErr;
          }
        }
      });
    } catch (txErr: any) {
      log(`[MarketGenerator:Gainer] Failed for ${cat}: ${txErr.message}`);
    }
  }
  log(`[MarketGenerator:Gainer] Done: created=${created}, updated=${updated}, skippedTooFew=${skippedTooFew}, usedFallback=${usedFallback}`);
  return { created, updated };
}

export async function generateAllWeeklyMarkets(): Promise<{ updown: number; jackpot: number; h2h: number; gainer: number; gainerUpdated: number; weekNumber: number }> {
  const { weekNumber, monday } = getWeekContext();
  log(`[MarketGenerator] Generating weekly markets for week ${weekNumber}...`);

  const updown = await generateWeeklyUpDown();
  const jackpot = await generateWeeklyJackpot();
  const h2h = await generateWeeklyH2H();
  const gainerResult = await generateWeeklyGainer();

  const openCount = await countOpenNativeMarketsForWeek(weekNumber, monday);

  if (openCount === 0) {
    log(`[MarketGenerator][ALERT] No OPEN native weekly markets found for week ${weekNumber}`);
  }

  log(`[MarketGenerator] Week ${weekNumber}: created ${updown} updown, ${jackpot} jackpot, ${h2h} h2h, ${gainerResult.created} gainer (${gainerResult.updated} updated)`);
  return { updown, jackpot, h2h, gainer: gainerResult.created, gainerUpdated: gainerResult.updated, weekNumber };
}

export async function ensureWeeklyMarketsForCurrentWeek(reason: "read-self-heal" | "startup" | "scheduled" | "retry" | "cron" = "scheduled"): Promise<{
  outcome: "already-open" | "generated" | "lock-busy";
  weekNumber: number;
  openBefore: number;
  openAfter: number;
}> {
  const { weekNumber, monday } = getWeekContext();
  const openBefore = await countOpenNativeMarketsForWeek(weekNumber, monday);
  if (openBefore > 0) {
    return { outcome: "already-open", weekNumber, openBefore, openAfter: openBefore };
  }

  const locked = await withDbAdvisoryLock(
    MARKET_GENERATOR_LOCK_KEY,
    "MarketGenerator",
    async () => {
      const openInsideLock = await countOpenNativeMarketsForWeek(weekNumber, monday);
      if (openInsideLock > 0) {
        return { generated: false, openAfter: openInsideLock };
      }
      await generateAllWeeklyMarkets();
      const openAfterGenerate = await countOpenNativeMarketsForWeek(weekNumber, monday);
      return { generated: true, openAfter: openAfterGenerate };
    },
  );

  if (!locked.acquired) {
    return { outcome: "lock-busy", weekNumber, openBefore, openAfter: openBefore };
  }

  const lockResult = locked.result ?? { generated: false, openAfter: openBefore };
  const outcome = lockResult.generated ? "generated" : "already-open";
  log(`[MarketGenerator] ensureWeeklyMarkets(${reason}) outcome=${outcome} week=${weekNumber} before=${openBefore} after=${lockResult.openAfter}`);
  return { outcome, weekNumber, openBefore, openAfter: lockResult.openAfter };
}

export function getNextMondayGenerationAt(now = new Date()): Date {
  const next = new Date(now);
  const dayOfWeek = now.getUTCDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 && now.getUTCHours() < 1 ? 0 : 8 - dayOfWeek;
  next.setUTCDate(now.getUTCDate() + daysUntilMonday);
  next.setUTCHours(0, 5, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export function startMarketGeneratorScheduler() {
  log("[MarketGenerator] Starting scheduler (checks on boot, then every Monday 00:05 UTC)");

  const BOOT_DELAY_MS = 120_000;
  let retryAttempts = 0;
  log(`[MarketGenerator] Will check/generate markets in ${BOOT_DELAY_MS / 1000}s to let other services stabilize`);

  setTimeout(async () => {
    try {
      log("[MarketGenerator] Boot: ensuring all market types exist for current week");
      await ensureWeeklyMarketsForCurrentWeek("startup");
    } catch (e) {
      log(`[MarketGenerator] Boot generation error: ${e}`);
    }

    scheduleNextMonday();
  }, BOOT_DELAY_MS);

  function scheduleNextMonday() {
    const now = new Date();
    const next = getNextMondayGenerationAt(now);

    const ms = next.getTime() - now.getTime();
    const hours = Math.round(ms / 1000 / 60 / 60);
    log(`[MarketGenerator] Next generation at ${next.toISOString()} (in ~${hours}h)`);

    scheduleAt(next, "scheduled");
  }

  function scheduleAt(target: Date, mode: "scheduled" | "retry") {
    const ms = Math.max(0, target.getTime() - Date.now());
    setTimeout(async () => {
      try {
        await ensureWeeklyMarketsForCurrentWeek(mode);
        retryAttempts = 0;
      } catch (e) {
        log(`[MarketGenerator] ${mode} generation error: ${e}`);
        if (retryAttempts < MARKET_GENERATOR_MAX_RETRIES) {
          retryAttempts += 1;
          const retryAt = new Date(Date.now() + MARKET_GENERATOR_RETRY_DELAY_MS);
          log(
            `[MarketGenerator] Retry ${retryAttempts}/${MARKET_GENERATOR_MAX_RETRIES} scheduled for ${retryAt.toISOString()}`,
          );
          scheduleAt(retryAt, "retry");
          return;
        }
        log("[MarketGenerator] Retry budget exhausted; waiting for next weekly schedule");
      }
      retryAttempts = 0;
      scheduleNextMonday();
    }, ms);
  }
}
