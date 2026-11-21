import type { QueryClient } from "@tanstack/react-query";

/** DELETE the unified comment row behind a Voices timeline or profile post. */
export function voicesPostDeleteRequest(postId: string): { method: "DELETE"; path: string } {
  return { method: "DELETE", path: `/api/comments/${encodeURIComponent(postId)}` };
}

export function voicesPostDeleteErrorCopy(input: {
  status?: number;
  description?: string;
}): { title: string; description: string } {
  if (input.status === 403) {
    return {
      title: "Couldn't delete post",
      description: "You can only delete your own posts.",
    };
  }
  if (input.status === 404) {
    return {
      title: "Couldn't delete post",
      description: "That post is no longer available.",
    };
  }
  return {
    title: "Couldn't delete post",
    description: input.description?.trim() || "Something went wrong. Please try again.",
  };
}

type IdItem = { id?: string };

function isIdItem(value: unknown): value is IdItem {
  return Boolean(value) && typeof value === "object" && "id" in (value as object);
}

/** Drop one post from a list or from infinite-query pages (`{ pages: [{ items }] }`). */
export function stripDeletedPost<T>(data: T, postId: string): T {
  if (Array.isArray(data)) {
    const next = data.filter((item) => !isIdItem(item) || item.id !== postId);
    return (next.length === data.length ? data : next) as T;
  }
  if (!data || typeof data !== "object" || !("pages" in data)) return data;
  const record = data as { pages: unknown[] };
  if (!Array.isArray(record.pages)) return data;

  let changed = false;
  const pages = record.pages.map((page) => {
    if (!page || typeof page !== "object" || !("items" in page)) return page;
    const typed = page as { items: unknown[]; total?: number };
    if (!Array.isArray(typed.items)) return page;
    const items = typed.items.filter((item) => !isIdItem(item) || item.id !== postId);
    if (items.length === typed.items.length) return page;
    changed = true;
    const removed = typed.items.length - items.length;
    const total = typeof typed.total === "number" ? Math.max(0, typed.total - removed) : undefined;
    return {
      ...typed,
      items,
      ...(total !== undefined ? { total } : {}),
    };
  });
  if (!changed) return data;
  return { ...record, pages } as T;
}

const POST_LIST_KEYS = [
  ["/api/voices/feed"],
  ["/api/me/comments"],
  ["/api/comments", "community_insight"],
] as const;

/**
 * Remove the post from every cached Voices feed, the signed-in comment
 * history, and profile discussion threads, then mark those queries stale.
 */
export function removeDeletedVoicesPost(queryClient: QueryClient, postId: string): void {
  for (const queryKey of POST_LIST_KEYS) {
    queryClient.setQueriesData({ queryKey }, (current) => stripDeletedPost(current, postId));
  }
  void queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/voices/post", postId] });
  void queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/comments", "community_insight"] });
}
