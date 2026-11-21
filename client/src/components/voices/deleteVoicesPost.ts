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
  if (!data || typeof data !== "object") return data;
  if ("items" in data && !("pages" in data)) {
    const typed = data as { items: unknown[]; total?: number };
    if (!Array.isArray(typed.items)) return data;
    const items = typed.items.filter((item) => !isIdItem(item) || item.id !== postId);
    if (items.length === typed.items.length) return data;
    const removed = typed.items.length - items.length;
    const total = typeof typed.total === "number" ? Math.max(0, typed.total - removed) : undefined;
    return { ...typed, items, ...(total !== undefined ? { total } : {}) } as T;
  }
  if (!("pages" in data)) return data;
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
 * Ids the server has confirmed deleted. A refetch can still return them for
 * up to the API's 60s Voices feed cache (and from another Railway instance
 * that has not seen the invalidation), so they must not be written back.
 */
const tombstones = new Set<string>();
const tombstoneFilters = new WeakSet<QueryClient>();

export function resetVoicesPostTombstonesForTests(): void {
  tombstones.clear();
}

export function isVoicesPostTombstoned(postId: string): boolean {
  return tombstones.has(postId);
}

function isVoicesPostListKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  if (head === "/api/voices/feed" || head === "/api/me/comments") return true;
  return head === "/api/comments" && queryKey[1] === "community_insight";
}

export function stripTombstonedPosts<T>(data: T): T {
  let next = data;
  for (const id of tombstones) next = stripDeletedPost(next, id);
  return next;
}

function attachVoicesPostTombstones(queryClient: QueryClient): void {
  if (tombstoneFilters.has(queryClient)) return;
  tombstoneFilters.add(queryClient);
  let applying = false;
  queryClient.getQueryCache().subscribe((event) => {
    if (applying || event.type !== "updated") return;
    if (!isVoicesPostListKey(event.query.queryKey)) return;
    const current = event.query.state.data;
    const next = stripTombstonedPosts(current);
    if (next === current) return;
    applying = true;
    try {
      queryClient.setQueryData(event.query.queryKey, next);
    } finally {
      applying = false;
    }
  });
}

export interface DismissLock {
  current: number;
}

/** Same-tick overlay clicks still see the previous React state, so the lock is a ref. */
export function acquireDismissLock(lock: DismissLock): void {
  lock.current += 1;
}

export function releaseDismissLock(lock: DismissLock): void {
  lock.current = Math.max(0, lock.current - 1);
}

export function overlayBackdropShouldClose(lock: DismissLock, pending: boolean): boolean {
  return lock.current === 0 && !pending;
}

export interface DeleteAttempt {
  current: boolean;
}

/** Ignore a second confirm before `isPending` flips. */
export function claimDeleteAttempt(attempt: DeleteAttempt): boolean {
  if (attempt.current) return false;
  attempt.current = true;
  return true;
}

export function releaseDeleteAttempt(attempt: DeleteAttempt): void {
  attempt.current = false;
}

/**
 * Remove the post from every cached Voices feed, the signed-in comment
 * history, and profile discussion threads, then mark those queries stale.
 */
export function removeDeletedVoicesPost(queryClient: QueryClient, postId: string): void {
  tombstones.add(postId);
  attachVoicesPostTombstones(queryClient);
  void queryClient.cancelQueries({ queryKey: ["/api/voices/feed"] });
  void queryClient.cancelQueries({ queryKey: ["/api/me/comments"] });
  void queryClient.cancelQueries({ queryKey: ["/api/comments", "community_insight"] });
  for (const queryKey of POST_LIST_KEYS) {
    queryClient.setQueriesData({ queryKey }, (current) => stripTombstonedPosts(current));
  }
  void queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/voices/post", postId] });
  void queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/comments", "community_insight"] });
}
