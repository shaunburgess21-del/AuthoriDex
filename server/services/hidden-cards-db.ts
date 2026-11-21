import { and, eq, inArray } from "drizzle-orm";
import {
  inductionCandidates,
  matchups,
  opinionPolls,
  predictionMarkets,
  trackedPeople,
  trendingPeople,
  trendingPolls,
  userHiddenCards,
} from "@shared/schema";
import type { CardReactionSurface } from "@shared/constants";
import { db } from "../db";
import {
  hiddenCardHref,
  hiddenCardKey,
  isCardReactionSurface,
  readViewerHiddenCards,
  type HiddenCardRecord,
  type HiddenCardSource,
  type HiddenCardStore,
  type ViewerHiddenSet,
} from "./hidden-cards";

/**
 * Database access for hidden cards. Kept out of `hidden-cards.ts` so feed
 * tests can exercise fail-open filtering without opening a connection.
 * `server/db.ts` throws at import when DATABASE_URL is unset.
 */

const availability = { missingUntil: 0 };

async function loadHiddenRows(userId: string): Promise<Array<{ cardType: string; cardId: string }>> {
  return db
    .select({
      cardType: userHiddenCards.cardType,
      cardId: userHiddenCards.cardId,
    })
    .from(userHiddenCards)
    .where(eq(userHiddenCards.userId, userId));
}

export function loadViewerHiddenCards(
  userId: string | null | undefined,
): Promise<ViewerHiddenSet> {
  return readViewerHiddenCards(userId, { load: loadHiddenRows, state: availability });
}

function idsOf(rows: readonly HiddenCardRecord[], cardType: CardReactionSurface): string[] {
  return rows.filter((row) => row.cardType === cardType).map((row) => row.cardId);
}

/** Batch-load titles for the profile list. Missing cards are left out of the map. */
export async function resolveHiddenCardSources(
  rows: readonly HiddenCardRecord[],
): Promise<Map<string, HiddenCardSource>> {
  const found = new Map<string, HiddenCardSource>();
  if (rows.length === 0) return found;

  const sentimentIds = idsOf(rows, "sentiment_poll");
  const matchupIds = idsOf(rows, "matchup");
  const opinionIds = idsOf(rows, "opinion_poll");
  const personIds = [
    ...idsOf(rows, "value_person"),
    ...idsOf(rows, "curate_person"),
  ];
  const inductionIds = idsOf(rows, "induction_candidate");
  const marketIds = rows
    .filter((row) => row.cardType.startsWith("market_"))
    .map((row) => row.cardId);

  const [sentiment, matchupRows, opinion, trending, tracked, induction, markets] = await Promise.all([
    sentimentIds.length
      ? db
          .select({
            id: trendingPolls.id,
            title: trendingPolls.headline,
            category: trendingPolls.category,
            slug: trendingPolls.slug,
          })
          .from(trendingPolls)
          .where(inArray(trendingPolls.id, sentimentIds))
      : [],
    matchupIds.length
      ? db
          .select({
            id: matchups.id,
            title: matchups.title,
            category: matchups.category,
            slug: matchups.slug,
          })
          .from(matchups)
          .where(inArray(matchups.id, matchupIds))
      : [],
    opinionIds.length
      ? db
          .select({
            id: opinionPolls.id,
            title: opinionPolls.title,
            category: opinionPolls.category,
            slug: opinionPolls.slug,
          })
          .from(opinionPolls)
          .where(inArray(opinionPolls.id, opinionIds))
      : [],
    personIds.length
      ? db
          .select({
            id: trendingPeople.id,
            name: trendingPeople.name,
            category: trendingPeople.category,
          })
          .from(trendingPeople)
          .where(inArray(trendingPeople.id, personIds))
      : [],
    personIds.length
      ? db
          .select({
            id: trackedPeople.id,
            name: trackedPeople.name,
            category: trackedPeople.category,
          })
          .from(trackedPeople)
          .where(inArray(trackedPeople.id, personIds))
      : [],
    inductionIds.length
      ? db
          .select({
            id: inductionCandidates.id,
            title: inductionCandidates.displayName,
            category: inductionCandidates.category,
          })
          .from(inductionCandidates)
          .where(inArray(inductionCandidates.id, inductionIds))
      : [],
    marketIds.length
      ? db
          .select({
            id: predictionMarkets.id,
            title: predictionMarkets.title,
            category: predictionMarkets.category,
            slug: predictionMarkets.slug,
          })
          .from(predictionMarkets)
          .where(inArray(predictionMarkets.id, marketIds))
      : [],
  ]);

  for (const row of sentiment) {
    found.set(hiddenCardKey("sentiment_poll", row.id), {
      title: row.title,
      category: row.category,
      href: hiddenCardHref("sentiment_poll", row.id, { slug: row.slug }),
    });
  }
  for (const row of matchupRows) {
    found.set(hiddenCardKey("matchup", row.id), {
      title: row.title,
      category: row.category,
      href: hiddenCardHref("matchup", row.id, { slug: row.slug }),
    });
  }
  for (const row of opinion) {
    found.set(hiddenCardKey("opinion_poll", row.id), {
      title: row.title,
      category: row.category,
      href: hiddenCardHref("opinion_poll", row.id, { slug: row.slug }),
    });
  }

  const people = new Map<string, { name: string; category: string | null }>();
  for (const row of tracked) people.set(row.id, { name: row.name, category: row.category });
  for (const row of trending) {
    people.set(row.id, { name: row.name, category: row.category });
  }
  for (const cardType of ["value_person", "curate_person"] as const) {
    for (const id of idsOf(rows, cardType)) {
      const person = people.get(id);
      if (!person) continue;
      found.set(hiddenCardKey(cardType, id), {
        title: person.name,
        category: person.category,
        href: hiddenCardHref(cardType, id),
      });
    }
  }
  for (const row of induction) {
    found.set(hiddenCardKey("induction_candidate", row.id), {
      title: row.title,
      category: row.category,
      href: hiddenCardHref("induction_candidate", row.id),
    });
  }
  const marketsById = new Map(markets.map((row) => [row.id, row]));
  for (const row of rows) {
    if (!row.cardType.startsWith("market_")) continue;
    const market = marketsById.get(row.cardId);
    if (!market || !isCardReactionSurface(row.cardType)) continue;
    found.set(hiddenCardKey(row.cardType, row.cardId), {
      title: market.title,
      category: market.category,
      href: hiddenCardHref(row.cardType, row.cardId, { slug: market.slug }),
    });
  }
  return found;
}

export function createDbHiddenCardStore(): HiddenCardStore {
  return {
    async insert(record) {
      const inserted = await db
        .insert(userHiddenCards)
        .values({
          userId: record.userId,
          cardType: record.cardType,
          cardId: record.cardId,
          createdAt: record.createdAt,
        })
        .onConflictDoNothing({
          target: [userHiddenCards.userId, userHiddenCards.cardType, userHiddenCards.cardId],
        })
        .returning({ userId: userHiddenCards.userId });
      return inserted.length > 0 ? "inserted" : "exists";
    },
    async delete(userId, cardType, cardId) {
      const removed = await db
        .delete(userHiddenCards)
        .where(and(
          eq(userHiddenCards.userId, userId),
          eq(userHiddenCards.cardType, cardType),
          eq(userHiddenCards.cardId, cardId),
        ))
        .returning({ userId: userHiddenCards.userId });
      return removed.length > 0;
    },
    async list(userId) {
      const rows = await db
        .select({
          userId: userHiddenCards.userId,
          cardType: userHiddenCards.cardType,
          cardId: userHiddenCards.cardId,
          createdAt: userHiddenCards.createdAt,
        })
        .from(userHiddenCards)
        .where(eq(userHiddenCards.userId, userId));
      return rows
        .filter((row): row is HiddenCardRecord => isCardReactionSurface(row.cardType))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  };
}
