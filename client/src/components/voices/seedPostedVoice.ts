import type { VoicesFeedItem, VoicesFeedResponse } from "./types";

export interface VoicesFeedPages {
  pages: VoicesFeedResponse[];
  pageParams: unknown[];
}

/**
 * Put the author's just-created post into a cached feed if the refetch
 * didn't include it yet (the server list is cached for ~60s per process).
 * If the post is already present, leave the server's order alone so
 * Latest stays chronological and For You stays ranked.
 */
export function withPostedVoice<T extends VoicesFeedPages>(
  data: T | undefined,
  item: VoicesFeedItem | null | undefined,
): T | undefined {
  if (!item) return data;
  if (!data || data.pages.length === 0) {
    return {
      pages: [{ items: [item], nextCursor: null, total: 1 }],
      pageParams: [null],
    } as T;
  }

  const already = data.pages.some((page) =>
    page.items.some((existing) => existing.id === item.id && existing.source === item.source),
  );
  if (already) return data;

  const [first, ...rest] = data.pages;
  return {
    ...data,
    pages: [
      {
        ...first,
        items: [item, ...first.items],
        total: (first.total ?? first.items.length) + 1,
      },
      ...rest,
    ],
  };
}
