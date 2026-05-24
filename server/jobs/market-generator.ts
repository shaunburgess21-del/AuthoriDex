import { randomUUID } from "crypto";
import { db, withDbAdvisoryLock } from "../db";
import { predictionMarkets, marketEntries, trackedPeople, trendingPeople } from "@shared/schema";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { eq, and, desc, inArray, sql, gte } from "drizzle-orm";
import { buildOpeningScores, loadOpeningScoreMap } from "../native-markets/openingScores";
import {
  getMarketBettingCutoff,
  getWeeklyBettingCutoff as getWeeklyBettingCutoffForEndAt,
  type MarketEngine,
} from "../native-markets/lifecycle";
import { getWeekContext as getUtcWeekContext } from "../native-markets/week-context";
import { seedAmmMarket } from "../services/amm-house";
import { applyWarmStartPrior } from "../services/amm-warmstart";
import { log } from "../log";

const MARKET_GENERATOR_LOCK_KEY = 5_204;
const MARKET_GENERATOR_RETRY_DELAY_MS = 15 * 60 * 1000;
const MARKET_GENERATOR_MAX_RETRIES = 4;

/**
 * Parimutuel sunset (Phase 1.5): every non-jackpot weekly market is
 * created as AMM. The previous `AMM_NATIVE_FLIP_ENABLED` and
 * `AMM_GAINER_FLIP_ENABLED` env-var rollback handles were deleted
 * along with the parimutuel resolver paths — there's no parimutuel
 * arm left for them to point at.
 *
 * Jackpot is the only market type still on parimutuel. Its creation
 * path sets `engine: 'parimutuel'` explicitly (see
 * `generateWeeklyJackpot`) so the AMM-by-default schema default
 * doesn't accidentally turn it into an AMM market.
 */
function nativeEngineFor(marketType: "updown" | "h2h" | "gainer" | "jackpot"): MarketEngine {
  if (marketType === "jackpot") return "parimutuel";
  return "amm";
}

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

/**
 * Per-market-type OPEN counts for the current week. Used by
 * `ensureWeeklyMarketsForCurrentWeek` to backfill ONLY the missing
 * product(s) when an earlier generation pass partially failed —
 * previously, the early-return on `countOpenNativeMarketsForWeek > 0`
 * meant a successful UpDown could prevent a subsequent H2H/gainer
 * backfill from ever happening, leaving the week incomplete until
 * the next Monday.
 */
export type WeeklyNativeCounts = { updown: number; h2h: number; gainer: number; jackpot: number };

async function countOpenNativeMarketsByTypeForWeek(
  weekNumber: number,
  monday: Date,
): Promise<WeeklyNativeCounts> {
  const rows = await db
    .select({
      marketType: predictionMarkets.marketType,
      count: sql<number>`count(*)`,
    })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.status, "OPEN"),
      inArray(predictionMarkets.marketType, ["updown", "h2h", "gainer", "jackpot"]),
      eq(predictionMarkets.weekNumber, weekNumber),
      gte(predictionMarkets.endAt, monday),
    ))
    .groupBy(predictionMarkets.marketType);

  const counts: WeeklyNativeCounts = { updown: 0, h2h: 0, gainer: 0, jackpot: 0 };
  for (const row of rows) {
    const key = row.marketType as keyof WeeklyNativeCounts;
    if (key in counts) counts[key] = Number(row.count) || 0;
  }
  return counts;
}

/**
 * Pure helper: given per-type OPEN counts for the current week, return
 * the list of market types that still need to be generated. Extracted
 * for testability — the actual DB query is a thin wrapper around this.
 */
export function decideMissingMarketTypes(
  counts: WeeklyNativeCounts,
): Array<keyof WeeklyNativeCounts> {
  const order: Array<keyof WeeklyNativeCounts> = ["updown", "h2h", "gainer", "jackpot"];
  return order.filter((t) => counts[t] === 0);
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
      googleTrendsTopicId: null as string | null,
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
  const openingScoreMap = await loadOpeningScoreMap(personIdList, db);

  const engine = nativeEngineFor("updown");
  let created = 0;
  for (const person of people) {
    if (existingPersonIds.has(person.id)) continue;
    const baseSlug = `updown-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;
    const openScore = openingScoreMap.get(person.id);

    const baseValues = {
      marketType: "updown" as const,
      engine,
      title: `${person.name}: Up or Down?`,
      personId: person.id,
      category: normalizeMarketCategory(person.category),
      visibility: "live" as const,
      status: "OPEN" as const,
      startAt: monday,
      endAt: sunday,
      closeAt: getMarketBettingCutoff(sunday, engine),
      weekNumber,
      metadata: openScore
        ? {
            openingScore: {
              personId: person.id,
              score: openScore.score,
              snapshotAt: openScore.snapshotAt,
              ...(openScore.sampleCount != null ? { sampleCount: openScore.sampleCount } : {}),
            },
          }
        : undefined,
      featured: false,
    };

    let attempt = 0;
    while (attempt < 2) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomUUID().slice(0, 6)}`;
      try {
        await db.transaction(async (tx) => {
          const [market] = await tx
            .insert(predictionMarkets)
            .values({ ...baseValues, slug })
            .returning({ id: predictionMarkets.id });
          const entries = await tx
            .insert(marketEntries)
            .values([
              { marketId: market.id, entryType: "custom", label: "Up", displayOrder: 0 },
              { marketId: market.id, entryType: "custom", label: "Down", displayOrder: 1 },
            ])
            .returning({ id: marketEntries.id, displayOrder: marketEntries.displayOrder });
          if (engine === "amm") {
            const entryIdsInOrder = entries
              .slice()
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((e) => e.id);
            await seedAmmMarket(
              { marketId: market.id, marketType: "updown", entryIdsInOrder },
              tx,
            );
            // Warm-start prior — closes the 50/50 cold-start gap when the
            // person's 7-day trend is clearly directional. Idempotent on
            // marketId, no-op when WARM_START_PRIORS_ENABLED is false.
            // Runs inside the same tx as seeding so the open state is
            // atomic: either (seeded + warmed) or (neither).
            await applyWarmStartPrior(
              {
                marketId: market.id,
                outcomeOrder: [entryIdsInOrder[0], entryIdsInOrder[1]],
                personId: person.id,
              },
              tx,
            );
          }
        });
        created++;
        break;
      } catch (slugErr: any) {
        if (slugErr?.code === "23505" && attempt === 0) {
          attempt++;
          continue;
        }
        log(`[MarketGenerator] updown error for ${person.name}: ${slugErr?.message ?? slugErr}`);
        break;
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

  const engine = nativeEngineFor("updown");
  const baseSlug = `updown-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-week-${weekNumber}`;
  const baseValues = {
    marketType: "updown" as const,
    engine,
    title: `${person.name}: Up or Down?`,
    personId: person.id,
    category: normalizeMarketCategory(person.category),
    visibility: "live" as const,
    status: "OPEN" as const,
    startAt: monday,
    endAt: sunday,
    closeAt: getMarketBettingCutoff(sunday, engine),
    weekNumber,
    metadata: openScore
      ? {
          openingScore: {
            personId: person.id,
            score: openScore.score,
            snapshotAt: openScore.snapshotAt,
          },
        }
      : undefined,
    featured: false,
  };

  let attempt = 0;
  while (attempt < 2) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomUUID().slice(0, 6)}`;
    try {
      await db.transaction(async (tx) => {
        const [market] = await tx
          .insert(predictionMarkets)
          .values({ ...baseValues, slug })
          .returning({ id: predictionMarkets.id });
        const entries = await tx
          .insert(marketEntries)
          .values([
            { marketId: market.id, entryType: "custom", label: "Up", displayOrder: 0 },
            { marketId: market.id, entryType: "custom", label: "Down", displayOrder: 1 },
          ])
          .returning({ id: marketEntries.id, displayOrder: marketEntries.displayOrder });
        if (engine === "amm") {
          const entryIdsInOrder = entries
            .slice()
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((e) => e.id);
          await seedAmmMarket(
            { marketId: market.id, marketType: "updown", entryIdsInOrder },
            tx,
          );
          // Warm-start prior — see weekly-generator path above for full
          // rationale. Idempotent on marketId so a retried inductee
          // ensure call won't double-warm.
          await applyWarmStartPrior(
            {
              marketId: market.id,
              outcomeOrder: [entryIdsInOrder[0], entryIdsInOrder[1]],
              personId: person.id,
            },
            tx,
          );
        }
      });
      return "created";
    } catch (slugErr: any) {
      if (slugErr?.code === "23505" && attempt === 0) {
        attempt++;
        continue;
      }
      log(`[MarketGenerator] ensureUpDown error for ${person.name}: ${slugErr?.message ?? slugErr}`);
      return "failed";
    }
  }
  return "failed";
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
    imageUrl: person.avatar ?? null,
  });
  return "added";
}

export async function generateWeeklyJackpot(): Promise<number> {
  const { monday, sunday, weekNumber } = getWeekContext();

  // Cap jackpot eligibility at the top N most-famous people. We previously
  // generated one market for every main_leaderboard person (~150), which
  // diluted pari-mutuel pools to ~900 credits of real bets each — too thin
  // to feel like a meaningful prize. Concentrating to top 20 lifts the
  // average headline pool ~7x without changing total betting volume.
  // Override with JACKPOT_TOP_N env var (set to a very large number to
  // restore the legacy behaviour).
  const JACKPOT_TOP_N = (() => {
    const raw = parseInt(process.env.JACKPOT_TOP_N || "20", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 20;
  })();

  type JackpotCandidate = {
    id: string;
    name: string;
    category: string | null;
    avatar: string | null;
  };

  // Inner-join trackedPeople against trendingPeople so we can rank by
  // fame_index. People without a fame index are excluded — they couldn't be
  // ranked anyway. Order DESC + LIMIT N gives the top N. Secondary sort by
  // id breaks fame_index ties deterministically.
  let people: JackpotCandidate[] = await db
    .select({
      id: trackedPeople.id,
      name: trackedPeople.name,
      category: trackedPeople.category,
      avatar: trackedPeople.avatar,
    })
    .from(trackedPeople)
    .innerJoin(trendingPeople, eq(trendingPeople.id, trackedPeople.id))
    .where(eq(trackedPeople.status, "main_leaderboard"))
    .orderBy(desc(trendingPeople.fameIndex), trackedPeople.id)
    .limit(JACKPOT_TOP_N);

  if (people.length === 0) {
    log(`[MarketGenerator:Jackpot] No trackedPeople matched, falling back to trendingPeople top ${JACKPOT_TOP_N}`);
    people = await db
      .select({
        id: trendingPeople.id,
        name: trendingPeople.name,
        category: trendingPeople.category,
        avatar: trendingPeople.avatar,
      })
      .from(trendingPeople)
      .orderBy(desc(trendingPeople.fameIndex), trendingPeople.id)
      .limit(JACKPOT_TOP_N);
    log(`[MarketGenerator:Jackpot] Fallback: ${people.length} people from trendingPeople`);
  }

  log(`[MarketGenerator:Jackpot] Week ${weekNumber}: generating up to ${people.length} jackpot markets (top ${JACKPOT_TOP_N})`);

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
      // Explicit — the schema default is now 'amm' since the parimutuel
      // sunset, but jackpot stays on the pool-split engine.
      engine: "parimutuel" as const,
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

type H2HCandidate = {
  id: string;
  name: string;
  category: string | null;
  fameIndex: number | null;
};

/**
 * New H2H pairing model (week 19 onwards).
 *
 * For each category that has ≥ 2 people on the leaderboard:
 *   - take the top 4 by fame
 *   - if the category has 4+ people, emit interleaved pairs:
 *       Card A: #1 vs #3   ("can the strong third upset the favourite?")
 *       Card B: #2 vs #4   ("two contenders fighting for relevance")
 *     Interleaving (rather than #1-vs-#2 + #3-vs-#4) gives a clearer
 *     favourite-vs-underdog narrative and refreshes more often, since #3
 *     and #4 churn faster than #1 and #2.
 *   - if the category has exactly 3 people, fall back to:
 *       Card A: #1 vs #2 (preserves the marquee fight)
 *       #3 → wildcard seat (needs a cross-category partner)
 *     Comedy is the only category in this branch today.
 *
 * Wildcard seats then get paired with the closest-fame leftover person from
 * any other category (rank 5+ in their own category, not yet used). This
 * keeps the matchup tight rather than producing a fame blowout, and the
 * resulting card is tagged `category: 'trending'` to flag it as cross-cat.
 *
 * Properties:
 *   - deterministic: identical pairings on repeat runs (no random shuffle).
 *     Even without the idempotency fast-path, double-runs would be no-ops.
 *   - no person appears in more than one card.
 *   - every category that has ≥ 2 people gets at least one card.
 *   - card count grows linearly with categories (today ≈ 20).
 */
function buildTop4PerCategoryPairings(
  allPeople: H2HCandidate[],
): [H2HCandidate, H2HCandidate][] {
  const byCategory = new Map<string, H2HCandidate[]>();
  for (const person of allPeople) {
    const cat = normalizeMarketCategory(person.category);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const group = byCategory.get(cat)!;
    if (group.length < 4) group.push(person);
  }

  const pairings: [H2HCandidate, H2HCandidate][] = [];
  const usedIds = new Set<string>();
  const wildcardSeats: H2HCandidate[] = [];

  // Sort categories alphabetically so output is order-stable across runs.
  const sortedCats = Array.from(byCategory.keys()).sort();
  for (const cat of sortedCats) {
    const top4 = byCategory.get(cat)!;
    if (top4.length >= 4) {
      // Interleaved pairing: #1-vs-#3 + #2-vs-#4.
      pairings.push([top4[0], top4[2]]);
      pairings.push([top4[1], top4[3]]);
      usedIds.add(top4[0].id);
      usedIds.add(top4[1].id);
      usedIds.add(top4[2].id);
      usedIds.add(top4[3].id);
    } else if (top4.length === 3) {
      // Three people: keep the marquee #1-vs-#2 fight, send #3 to the
      // wildcard pool for a cross-category partner.
      pairings.push([top4[0], top4[1]]);
      usedIds.add(top4[0].id);
      usedIds.add(top4[1].id);
      wildcardSeats.push(top4[2]);
      usedIds.add(top4[2].id);
    } else if (top4.length === 2) {
      pairings.push([top4[0], top4[1]]);
      usedIds.add(top4[0].id);
      usedIds.add(top4[1].id);
    }
  }

  if (wildcardSeats.length > 0) {
    const leftoverPool = allPeople.filter((p) => !usedIds.has(p.id));
    for (const seat of wildcardSeats) {
      if (leftoverPool.length === 0) break;
      const seatFame = seat.fameIndex ?? 0;
      // Pick the leftover whose fame is closest to the seat's fame so the
      // matchup feels intentional rather than a blowout. Stable on ties by
      // falling back to the leftover's existing fame ordering.
      let bestIdx = 0;
      let bestDelta = Math.abs((leftoverPool[0].fameIndex ?? 0) - seatFame);
      for (let i = 1; i < leftoverPool.length; i++) {
        const delta = Math.abs((leftoverPool[i].fameIndex ?? 0) - seatFame);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i;
        }
      }
      const partner = leftoverPool.splice(bestIdx, 1)[0];
      pairings.push([seat, partner]);
      usedIds.add(partner.id);
    }
  }

  return pairings;
}

/**
 * Legacy pairing model — preserved behind the H2H_TOP4_PER_CATEGORY_ENABLED
 * feature flag so we can fall back without redeploying. Pulled top-30 by
 * fame globally, paired consecutive fame ranks within each category, and
 * filled to 15 with a randomly shuffled cross-category remainder.
 */
function buildLegacyTop30Pairings(
  top: H2HCandidate[],
): [H2HCandidate, H2HCandidate][] {
  const byCategory = new Map<string, H2HCandidate[]>();
  for (const person of top) {
    const cat = (person.category || "misc").toLowerCase();
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(person);
  }

  const pairings: [H2HCandidate, H2HCandidate][] = [];
  const paired = new Set<string>();
  for (const [, group] of Array.from(byCategory)) {
    for (let i = 0; i < group.length - 1 && pairings.length < 15; i += 2) {
      pairings.push([group[i], group[i + 1]]);
      paired.add(group[i].id);
      paired.add(group[i + 1].id);
    }
  }
  if (pairings.length < 15) {
    const unpaired = top.filter((p) => !paired.has(p.id));
    for (let i = unpaired.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unpaired[i], unpaired[j]] = [unpaired[j], unpaired[i]];
    }
    for (let i = 0; i < unpaired.length - 1 && pairings.length < 15; i += 2) {
      pairings.push([unpaired[i], unpaired[i + 1]]);
    }
  }
  return pairings;
}

export async function generateWeeklyH2H(): Promise<number> {
  const { monday, sunday, weekNumber } = getWeekContext();

  // IDEMPOTENT FAST-PATH: if any OPEN/live (or inactive) H2H markets already
  // exist for this week, skip generation entirely. This previously archived
  // all existing OPEN H2H markets and recreated them from scratch on every
  // call — silently wiping every user/agent bet (bets stay in the DB but
  // the UI only surfaces "live"/"inactive" markets, so pools appeared to
  // reset to 0). Up/Down and Gainer are already idempotent in the same way;
  // H2H now matches. The check is outside the transaction to avoid the
  // expensive `top` query on the no-op path; the cron call sites are
  // serialised by the advisory lock around `ensureWeeklyMarketsForCurrentWeek`.
  const existingOpenH2H = await db
    .select({ id: predictionMarkets.id })
    .from(predictionMarkets)
    .where(and(
      eq(predictionMarkets.marketType, "h2h"),
      eq(predictionMarkets.weekNumber, weekNumber),
      eq(predictionMarkets.status, "OPEN"),
      inArray(predictionMarkets.visibility, ["live", "inactive"]),
    ));

  if (existingOpenH2H.length > 0) {
    log(`[MarketGenerator:H2H] Week ${weekNumber}: ${existingOpenH2H.length} markets already open — skipping generation (idempotent).`);
    return 0;
  }

  // Pull every leaderboard person ordered by fame so we can take a true top-4
  // per category. Previously we capped at top-30 globally, which let one heavy
  // category (politics) hog 5–6 cards and starved thin categories. The new
  // model — top 4 per category, paired as (#1 vs #2) and (#3 vs #4) — is
  // deterministic, gives every category equal billing, and guarantees no
  // person appears in more than one card.
  //
  // Secondary sort by id breaks fame_index ties deterministically — without
  // it, two people with identical fame would swap positions across runs and
  // produce non-deterministic pairings. Rare in practice but free to fix.
  const allPeople = await db
    .select({ id: trendingPeople.id, name: trendingPeople.name, category: trendingPeople.category, fameIndex: trendingPeople.fameIndex })
    .from(trendingPeople)
    .orderBy(desc(trendingPeople.fameIndex), trendingPeople.id);

  if (allPeople.length < 2) return 0;

  const useTop4PerCategory =
    (process.env.H2H_TOP4_PER_CATEGORY_ENABLED || "").toLowerCase() !== "false";

  const created: number = await db.transaction(async (tx) => {
    // Re-check inside the transaction in case a concurrent caller raced past
    // the fast-path check above (cron endpoint is not behind the advisory lock).
    const racedOpenH2H = await tx
      .select({ id: predictionMarkets.id })
      .from(predictionMarkets)
      .where(and(
        eq(predictionMarkets.marketType, "h2h"),
        eq(predictionMarkets.weekNumber, weekNumber),
        eq(predictionMarkets.status, "OPEN"),
        inArray(predictionMarkets.visibility, ["live", "inactive"]),
      ));
    if (racedOpenH2H.length > 0) {
      log(`[MarketGenerator:H2H] Week ${weekNumber}: race detected (${racedOpenH2H.length} markets created concurrently) — aborting.`);
      return 0;
    }

    // First run for this week (or all prior runs are archived/resolved):
    // collect existing slugs across all visibilities so we dodge any unique-
    // constraint collisions with archived markets from earlier runs.
    const existingH2H = await tx
      .select({ slug: predictionMarkets.slug })
      .from(predictionMarkets)
      .where(and(eq(predictionMarkets.marketType, "h2h"), eq(predictionMarkets.weekNumber, weekNumber)));
    const existingSlugs = new Set(existingH2H.map(e => e.slug));

    const pairings: [typeof allPeople[0], typeof allPeople[0]][] = useTop4PerCategory
      ? buildTop4PerCategoryPairings(allPeople)
      : buildLegacyTop30Pairings(allPeople.slice(0, 30));

    log(`[MarketGenerator:H2H] Week ${weekNumber}: built ${pairings.length} pairings (mode=${useTop4PerCategory ? "top4-per-category" : "legacy-top30"})`);

    const allPersonIds = Array.from(new Set(pairings.flatMap(([a, b]) => [a.id, b.id])));
    const snapMap = await loadOpeningScoreMap(allPersonIds, tx);

    const engine = nativeEngineFor("h2h");
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
        engine,
        title: `${personA.name} vs ${personB.name}`,
        slug,
        category: h2hCategory,
        visibility: "live",
        status: "OPEN",
        startAt: monday,
        endAt: sunday,
        closeAt: getMarketBettingCutoff(sunday, engine),
        weekNumber,
        metadata: h2hMeta,
        featured: false,
      }).returning();

      const entries = await tx
        .insert(marketEntries)
        .values([
          { marketId: market.id, entryType: "person", personId: personA.id, label: personA.name, displayOrder: 0, imageUrl: null },
          { marketId: market.id, entryType: "person", personId: personB.id, label: personB.name, displayOrder: 1, imageUrl: null },
        ])
        .returning({ id: marketEntries.id, displayOrder: marketEntries.displayOrder });

      if (engine === "amm") {
        const entryIdsInOrder = entries
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((e) => e.id);
        await seedAmmMarket(
          { marketId: market.id, marketType: "h2h", entryIdsInOrder },
          tx,
        );
      }

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
      googleTrendsTopicId: null as string | null,
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

  const snapMap = await loadOpeningScoreMap(allIds, db);

  const engine = nativeEngineFor("gainer");
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
        const [existingMarket] = await db.select({
          id: predictionMarkets.id,
          engine: predictionMarkets.engine,
        })
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
          // AMM markets seed their LMSR state with a fixed `outcomeOrder`
          // at creation time. Inserting new `market_entries` rows after
          // the fact would leave them in the DB but absent from the AMM
          // state, so any buy on those entries would fail with
          // "not in this market's AMM outcomeOrder". Refuse to backfill
          // and surface a loud log so operators can void + recreate the
          // market if a missing candidate is critical.
          if (existingMarket.engine === "amm") {
            log(
              `[MarketGenerator:Gainer][WARN] Skipping backfill of ${missing.length} entries ` +
              `into AMM market ${existingMarket.id} (${cat}). New candidates this week: ` +
              `${missing.map((p) => p.name).join(", ")}. AMM markets have a fixed outcome ` +
              `set — void and recreate if these need to participate.`,
            );
          } else {
            const startOrder = currentEntries.length;
            await db.insert(marketEntries).values(
              missing.map((person, idx) => ({
                marketId: existingMarket.id,
                entryType: "person" as const,
                personId: person.id,
                label: person.name,
                displayOrder: startOrder + idx,
                imageUrl: person.avatar,
              }))
            );
            updated++;
            log(`[MarketGenerator:Gainer] Backfilled ${missing.length} entries into ${cat} (market ${existingMarket.id})`);
          }
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
        const insertMarketAndEntries = async (finalSlug: string) => {
          const [market] = await tx.insert(predictionMarkets).values({
            marketType: "gainer",
            engine,
            title,
            slug: finalSlug,
            category: cat,
            visibility: "live",
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            closeAt: getMarketBettingCutoff(sunday, engine),
            weekNumber,
            metadata: gainerMeta,
            featured: false,
          }).returning();
          const entryValues = ranked.map((person, idx) => ({
            marketId: market.id,
            entryType: "person" as const,
            personId: person.id,
            label: person.name,
            displayOrder: idx,
            imageUrl: person.avatar,
          }));
          const insertedEntries = await tx
            .insert(marketEntries)
            .values(entryValues)
            .returning({ id: marketEntries.id, displayOrder: marketEntries.displayOrder });
          if (engine === "amm") {
            const entryIdsInOrder = insertedEntries
              .slice()
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((e) => e.id);
            await seedAmmMarket(
              { marketId: market.id, marketType: "gainer", entryIdsInOrder },
              tx,
            );
          }
          return market;
        };

        try {
          await insertMarketAndEntries(slug);
          created++;
        } catch (slugErr: any) {
          if (slugErr.code === "23505") {
            slug = `${slug}-${randomUUID().slice(0, 6)}`;
            await insertMarketAndEntries(slug);
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
  log(`[MarketGenerator:Gainer] Done: engine=${engine}, created=${created}, updated=${updated}, skippedTooFew=${skippedTooFew}, usedFallback=${usedFallback}`);
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

function sumCounts(c: WeeklyNativeCounts): number {
  return c.updown + c.h2h + c.gainer + c.jackpot;
}

export async function ensureWeeklyMarketsForCurrentWeek(reason: "read-self-heal" | "startup" | "scheduled" | "retry" | "cron" = "scheduled"): Promise<{
  outcome: "already-open" | "generated" | "lock-busy";
  weekNumber: number;
  openBefore: number;
  openAfter: number;
  /** Market types newly generated this call (empty when nothing was missing). */
  generatedTypes: Array<keyof WeeklyNativeCounts>;
}> {
  const { weekNumber, monday } = getWeekContext();
  const beforeByType = await countOpenNativeMarketsByTypeForWeek(weekNumber, monday);
  const openBefore = sumCounts(beforeByType);
  const initiallyMissing = decideMissingMarketTypes(beforeByType);

  // Full week already in place — nothing to do. We only short-circuit
  // when EVERY type has at least one open market; partial weeks fall
  // through into the lock so the missing product(s) get backfilled.
  if (initiallyMissing.length === 0) {
    return {
      outcome: "already-open",
      weekNumber,
      openBefore,
      openAfter: openBefore,
      generatedTypes: [],
    };
  }

  const locked = await withDbAdvisoryLock(
    MARKET_GENERATOR_LOCK_KEY,
    "MarketGenerator",
    async () => {
      // Re-check inside the lock — another runner may have just
      // finished generating while we were waiting for the lock.
      const insideByType = await countOpenNativeMarketsByTypeForWeek(weekNumber, monday);
      const missing = decideMissingMarketTypes(insideByType);
      if (missing.length === 0) {
        return { generatedTypes: [] as Array<keyof WeeklyNativeCounts>, openAfter: sumCounts(insideByType) };
      }

      // Run only the generators for the missing types. Each generator
      // is internally idempotent (e.g. H2H short-circuits if any open
      // H2H exists, UpDown skips per-person duplicates) so calling
      // them is safe even if a race put the type in place; but
      // skipping the call up-front saves wasted work.
      const generatedTypes: Array<keyof WeeklyNativeCounts> = [];
      for (const type of missing) {
        try {
          if (type === "updown") {
            const n = await generateWeeklyUpDown();
            if (n > 0) generatedTypes.push("updown");
          } else if (type === "h2h") {
            const n = await generateWeeklyH2H();
            if (n > 0) generatedTypes.push("h2h");
          } else if (type === "gainer") {
            const r = await generateWeeklyGainer();
            if (r.created > 0) generatedTypes.push("gainer");
          } else if (type === "jackpot") {
            const n = await generateWeeklyJackpot();
            if (n > 0) generatedTypes.push("jackpot");
          }
        } catch (err) {
          // Swallow per-type errors so a failed jackpot generator
          // doesn't block UpDown/H2H/gainer from being persisted.
          // The retry scheduler will re-enter and pick up whatever's
          // still missing on its next tick.
          log(
            `[MarketGenerator] ensureWeeklyMarkets(${reason}) generator ${type} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      const afterByType = await countOpenNativeMarketsByTypeForWeek(weekNumber, monday);
      return { generatedTypes, openAfter: sumCounts(afterByType) };
    },
  );

  if (!locked.acquired) {
    return {
      outcome: "lock-busy",
      weekNumber,
      openBefore,
      openAfter: openBefore,
      generatedTypes: [],
    };
  }

  const lockResult = locked.result ?? { generatedTypes: [] as Array<keyof WeeklyNativeCounts>, openAfter: openBefore };
  const outcome: "already-open" | "generated" | "lock-busy" =
    lockResult.generatedTypes.length > 0 ? "generated" : "already-open";
  log(
    `[MarketGenerator] ensureWeeklyMarkets(${reason}) outcome=${outcome} ` +
      `week=${weekNumber} before=${openBefore} after=${lockResult.openAfter} ` +
      `missingBefore=[${initiallyMissing.join(",")}] generated=[${lockResult.generatedTypes.join(",")}]`,
  );
  return {
    outcome,
    weekNumber,
    openBefore,
    openAfter: lockResult.openAfter,
    generatedTypes: lockResult.generatedTypes,
  };
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
