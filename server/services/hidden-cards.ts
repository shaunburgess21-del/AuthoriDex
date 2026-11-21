import { z } from "zod";
import {
  CARD_REACTION_SURFACES,
  type CardReactionSurface,
} from "@shared/constants";

/**
 * Personal "hide this card" list. A row removes that card from the owner's
 * feeds only. Detail pages, the fame leaderboard, and jackpot stay untouched.
 *
 * Feed reads fail open: a missing `user_hidden_cards` table (migration not
 * applied yet) or any other lookup error returns an empty set so the feed
 * responds exactly as it does today. Hide/unhide/list return 503 instead.
 */

export const HIDDEN_CARDS_UNAVAILABLE = "hidden_cards_unavailable";
export const MISSING_TABLE_RETRY_MS = 30_000;

export const HIDDEN_CARD_TYPE_LABELS: Record<CardReactionSurface, string> = {
  sentiment_poll: "Poll",
  matchup: "Matchup",
  opinion_poll: "Opinion",
  value_person: "Rating",
  induction_candidate: "Induction",
  curate_person: "Profile image",
  market_updown: "Up/Down",
  market_h2h: "Head-to-head",
  market_gainer: "Top Gainer",
  market_world: "World Market",
};

const NATIVE_MARKET_HIDE_TYPES: Record<string, CardReactionSurface> = {
  updown: "market_updown",
  h2h: "market_h2h",
  gainer: "market_gainer",
};

export interface HiddenCardRecord {
  userId: string;
  cardType: CardReactionSurface;
  cardId: string;
  createdAt: Date;
}

export interface HiddenCardStore {
  insert(record: HiddenCardRecord): Promise<"inserted" | "exists">;
  delete(userId: string, cardType: CardReactionSurface, cardId: string): Promise<boolean>;
  list(userId: string): Promise<HiddenCardRecord[]>;
}

export interface HiddenCardSource {
  title: string;
  category: string | null;
  href: string;
}

export interface HiddenCardListItem {
  cardType: CardReactionSurface;
  cardId: string;
  createdAt: string;
  title: string;
  category: string | null;
  href: string;
  typeLabel: string;
}

export interface ViewerHiddenSet {
  keys: ReadonlySet<string>;
  idsFor(cardType: CardReactionSurface): readonly string[];
}

export interface HiddenCardHttpResult {
  status: number;
  body: Record<string, unknown>;
}

const hiddenCardBodySchema = z.object({
  cardType: z.enum(CARD_REACTION_SURFACES),
  cardId: z.string().trim().min(1).max(128),
});

export const EMPTY_VIEWER_HIDDEN: ViewerHiddenSet = {
  keys: new Set<string>(),
  idsFor: () => [],
};

export function hiddenCardKey(cardType: string, cardId: string): string {
  return `${cardType}:${cardId}`;
}

export function isCardReactionSurface(value: string): value is CardReactionSurface {
  return (CARD_REACTION_SURFACES as readonly string[]).includes(value);
}

/** Postgres undefined_table, including Drizzle's wrapped cause chain. */
export function isUndefinedTableError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current !== "object") break;
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === "42P01") return true;
    if (
      typeof record.message === "string" &&
      /user_hidden_cards/i.test(record.message) &&
      /does not exist/i.test(record.message)
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export function nativeHideCardType(marketType: string): CardReactionSurface | null {
  return NATIVE_MARKET_HIDE_TYPES[marketType] ?? null;
}

export function hiddenCardHref(
  cardType: CardReactionSurface,
  cardId: string,
  source: { slug?: string | null } = {},
): string {
  const slug = source.slug?.trim();
  switch (cardType) {
    case "sentiment_poll":
      return slug ? `/polls/${encodeURIComponent(slug)}` : "/vote";
    case "matchup":
      return slug ? `/vote/matchups/${encodeURIComponent(slug)}` : "/vote";
    case "opinion_poll":
      return slug ? `/vote/opinion-polls/${encodeURIComponent(slug)}` : "/vote";
    case "value_person":
      return `/vote/all-ratings?focus=${encodeURIComponent(cardId)}`;
    case "induction_candidate":
      return "/vote/induction";
    case "curate_person":
      return `/person/${encodeURIComponent(cardId)}`;
    case "market_updown":
      return `/predict/updown/${encodeURIComponent(cardId)}`;
    case "market_h2h":
      return `/predict/h2h/${encodeURIComponent(cardId)}`;
    case "market_gainer":
      return `/predict/race/${encodeURIComponent(cardId)}`;
    case "market_world":
      return slug ? `/markets/${encodeURIComponent(slug)}` : "/predict";
    default: {
      const _exhaustive: never = cardType;
      return _exhaustive;
    }
  }
}

export function omitHiddenCards<T>(
  items: readonly T[],
  hidden: ReadonlySet<string>,
  keyOf: (item: T) => string,
): T[] {
  if (hidden.size === 0) return items as T[];
  if (!items.some((item) => hidden.has(keyOf(item)))) return items as T[];
  return items.filter((item) => !hidden.has(keyOf(item)));
}

export function filterFeedByHidden<T>(
  items: readonly T[],
  hidden: ViewerHiddenSet,
  cardType: CardReactionSurface,
  idOf: (item: T) => string = (item) => String((item as { id?: unknown }).id ?? ""),
): T[] {
  return omitHiddenCards(items, hidden.keys, (item) => hiddenCardKey(cardType, idOf(item)));
}

/** Jackpot is intentionally not a hide surface. Other native types are. */
export function filterNativeMarkets<T>(
  marketType: string,
  markets: readonly T[],
  hidden: ViewerHiddenSet,
): T[] {
  const cardType = nativeHideCardType(marketType);
  if (!cardType) return markets as T[];
  return filterFeedByHidden(markets, hidden, cardType);
}

export function filterWrappedFeed<T>(
  payload: { data: T[]; totalCount?: number },
  hidden: ViewerHiddenSet,
  cardType: CardReactionSurface,
): { data: T[]; totalCount: number } {
  const data = filterFeedByHidden(payload.data, hidden, cardType);
  return { ...payload, data, totalCount: data.length };
}

function viewerSetFromRows(
  rows: ReadonlyArray<{ cardType: string; cardId: string }>,
): ViewerHiddenSet {
  const byType = new Map<string, string[]>();
  const keys = new Set<string>();
  for (const row of rows) {
    if (!isCardReactionSurface(row.cardType) || !row.cardId) continue;
    keys.add(hiddenCardKey(row.cardType, row.cardId));
    const list = byType.get(row.cardType) ?? [];
    list.push(row.cardId);
    byType.set(row.cardType, list);
  }
  return {
    keys,
    idsFor(cardType) {
      return byType.get(cardType) ?? [];
    },
  };
}

export interface HiddenCardReadDeps {
  load: (userId: string) => Promise<Array<{ cardType: string; cardId: string }>>;
  now?: () => number;
  state?: { missingUntil: number };
}

/**
 * Ids this viewer has hidden. Anonymous callers and a missing table both
 * return an empty set and never throw. A missing table is remembered for
 * MISSING_TABLE_RETRY_MS so a feed storm does not re-query every request,
 * then checked again so a just-applied migration starts working.
 */
export async function readViewerHiddenCards(
  userId: string | null | undefined,
  deps: HiddenCardReadDeps,
): Promise<ViewerHiddenSet> {
  if (!userId) return EMPTY_VIEWER_HIDDEN;
  const state = deps.state ?? { missingUntil: 0 };
  const now = deps.now?.() ?? Date.now();
  if (now < state.missingUntil) return EMPTY_VIEWER_HIDDEN;
  try {
    const rows = await deps.load(userId);
    return viewerSetFromRows(rows);
  } catch (error) {
    if (isUndefinedTableError(error)) {
      state.missingUntil = now + MISSING_TABLE_RETRY_MS;
      console.warn(
        "[hidden-cards] user_hidden_cards is missing; feeds stay unfiltered until the migration is applied",
      );
      return EMPTY_VIEWER_HIDDEN;
    }
    console.error("[hidden-cards] lookup failed; serving the unfiltered feed", error);
    return EMPTY_VIEWER_HIDDEN;
  }
}

export async function hideCard(
  store: HiddenCardStore,
  userId: string,
  cardType: CardReactionSurface,
  cardId: string,
  now: Date = new Date(),
): Promise<"inserted" | "exists"> {
  return store.insert({ userId, cardType, cardId, createdAt: now });
}

export async function unhideCard(
  store: HiddenCardStore,
  userId: string,
  cardType: CardReactionSurface,
  cardId: string,
): Promise<boolean> {
  return store.delete(userId, cardType, cardId);
}

function unavailableResult(): HiddenCardHttpResult {
  return {
    status: 503,
    body: {
      error: "Hidden cards aren't available yet",
      code: HIDDEN_CARDS_UNAVAILABLE,
    },
  };
}

function invalidCardResult(): HiddenCardHttpResult {
  return { status: 400, body: { error: "Invalid card" } };
}

function parseBody(body: unknown): { cardType: CardReactionSurface; cardId: string } | null {
  const parsed = hiddenCardBodySchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data;
}

export async function executeHideCard(
  store: HiddenCardStore,
  userId: string,
  body: unknown,
): Promise<HiddenCardHttpResult> {
  const parsed = parseBody(body);
  if (!parsed) return invalidCardResult();
  try {
    const outcome = await hideCard(store, userId, parsed.cardType, parsed.cardId);
    return {
      status: 200,
      body: {
        data: {
          cardType: parsed.cardType,
          cardId: parsed.cardId,
          alreadyHidden: outcome === "exists",
        },
      },
    };
  } catch (error) {
    if (isUndefinedTableError(error)) return unavailableResult();
    console.error("[hidden-cards] hide failed:", error);
    return { status: 500, body: { error: "Failed to hide card" } };
  }
}

export async function executeUnhideCard(
  store: HiddenCardStore,
  userId: string,
  body: unknown,
): Promise<HiddenCardHttpResult> {
  const parsed = parseBody(body);
  if (!parsed) return invalidCardResult();
  try {
    const unhidden = await unhideCard(store, userId, parsed.cardType, parsed.cardId);
    return {
      status: 200,
      body: {
        data: {
          cardType: parsed.cardType,
          cardId: parsed.cardId,
          unhidden,
        },
      },
    };
  } catch (error) {
    if (isUndefinedTableError(error)) return unavailableResult();
    console.error("[hidden-cards] unhide failed:", error);
    return { status: 500, body: { error: "Failed to unhide card" } };
  }
}

export async function presentHiddenCards(
  rows: readonly HiddenCardRecord[],
  lookup: (rows: readonly HiddenCardRecord[]) => Promise<Map<string, HiddenCardSource>>,
): Promise<HiddenCardListItem[]> {
  if (rows.length === 0) return [];
  const sources = await lookup(rows);
  const items: HiddenCardListItem[] = [];
  for (const row of rows) {
    const source = sources.get(hiddenCardKey(row.cardType, row.cardId));
    if (!source?.title) continue;
    items.push({
      cardType: row.cardType,
      cardId: row.cardId,
      createdAt: row.createdAt.toISOString(),
      title: source.title,
      category: source.category,
      href: source.href,
      typeLabel: HIDDEN_CARD_TYPE_LABELS[row.cardType],
    });
  }
  return items;
}

export async function executeListHiddenCards(
  store: HiddenCardStore,
  userId: string,
  lookup: (rows: readonly HiddenCardRecord[]) => Promise<Map<string, HiddenCardSource>>,
): Promise<HiddenCardHttpResult> {
  try {
    const rows = await store.list(userId);
    const data = await presentHiddenCards(rows, lookup);
    return { status: 200, body: { data } };
  } catch (error) {
    if (isUndefinedTableError(error)) return unavailableResult();
    console.error("[hidden-cards] list failed:", error);
    return { status: 500, body: { error: "Failed to load hidden cards" } };
  }
}

