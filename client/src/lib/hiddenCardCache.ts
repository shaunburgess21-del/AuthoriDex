import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { CardReactionSurface } from "@shared/constants";

/** Query prefixes whose cached lists should drop a hidden card immediately. */
export const HIDDEN_CARD_FEED_PREFIXES: Record<CardReactionSurface, readonly (readonly string[])[]> = {
  sentiment_poll: [["/api/trending-polls"]],
  matchup: [["/api/matchups"]],
  opinion_poll: [["/api/opinion-polls"]],
  value_person: [["/api/vote/overall-ratings"]],
  induction_candidate: [["/api/vote/induction"]],
  // Curate cards are a view of the fame roster. Do not strip that cache.
  curate_person: [],
  market_updown: [["/api/native-markets/updown"]],
  market_h2h: [["/api/native-markets/h2h"]],
  market_gainer: [["/api/native-markets/gainer"]],
  market_world: [["/api/open-markets"]],
};

export const HIDDEN_CARDS_QUERY_KEY = ["/api/me/hidden-cards"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/**
 * Remove one card from a feed payload.
 * Arrays are card lists. `{ data: [...] }` is overall-ratings / induction.
 * A single detail object is left alone so a direct link stays cached.
 */
export function stripHiddenCardFromFeedCache(data: unknown, cardId: string): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.filter((item) => !isRecord(item) || String(item.id ?? "") !== cardId);
  }
  if (isRecord(data) && Array.isArray(data.data)) {
    const next = data.data.filter((item) => !isRecord(item) || String(item.id ?? "") !== cardId);
    if (next.length === data.data.length) return data;
    const totalCount = typeof data.totalCount === "number" ? next.length : data.totalCount;
    return { ...data, data: next, totalCount };
  }
  return data;
}

export function feedPrefixesFor(cardType: CardReactionSurface): readonly (readonly string[])[] {
  return HIDDEN_CARD_FEED_PREFIXES[cardType];
}

export interface FeedCacheSnapshot {
  queryKey: QueryKey;
  data: unknown;
}

export function snapshotFeedCaches(
  queryClient: QueryClient,
  cardType: CardReactionSurface,
): FeedCacheSnapshot[] {
  const snapshots: FeedCacheSnapshot[] = [];
  for (const prefix of feedPrefixesFor(cardType)) {
    for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: [...prefix] })) {
      snapshots.push({ queryKey, data });
    }
  }
  const hidden = queryClient.getQueryData(HIDDEN_CARDS_QUERY_KEY);
  snapshots.push({ queryKey: HIDDEN_CARDS_QUERY_KEY, data: hidden });
  return snapshots;
}

export function restoreFeedCaches(queryClient: QueryClient, snapshots: readonly FeedCacheSnapshot[]): void {
  for (const snapshot of snapshots) {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data);
  }
}

export function stripCardFromFeedCaches(
  queryClient: QueryClient,
  cardType: CardReactionSurface,
  cardId: string,
): void {
  for (const prefix of feedPrefixesFor(cardType)) {
    queryClient.setQueriesData({ queryKey: [...prefix] }, (current) =>
      stripHiddenCardFromFeedCache(current, cardId),
    );
  }
}

export function invalidateHiddenCardQueries(
  queryClient: QueryClient,
  cardType: CardReactionSurface,
): void {
  void queryClient.invalidateQueries({ queryKey: HIDDEN_CARDS_QUERY_KEY });
  for (const prefix of feedPrefixesFor(cardType)) {
    void queryClient.invalidateQueries({ queryKey: [...prefix] });
  }
}
