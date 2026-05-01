import { useCallback } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import type {
  NotificationCategory,
  NotificationCountsResponse,
  NotificationListResponse,
  NotificationPreferences,
  NotificationRow,
} from "@/lib/notifications/types";

/**
 * TanStack Query hooks for the in-app notifications system.
 *
 * Three concerns:
 *   1. Unread count for the bell badge (`useNotificationCounts`).
 *   2. Paginated inbox list (`useNotificationsList`).
 *   3. Per-user preferences for the Settings page (`useNotificationPreferences`).
 *
 * Realtime subscription lives separately in `useNotificationsRealtime` —
 * it invalidates the queries below on every insert. We deliberately
 * keep the refetch + subscription logic in two files so a) the badge
 * works even when Realtime fails, and b) we can throttle one without
 * the other.
 */

const COUNTS_QUERY_KEY = ["notifications", "unread-count"] as const;
const LIST_QUERY_KEY = ["notifications", "list"] as const;
const PREFS_QUERY_KEY = ["notifications", "preferences"] as const;

export interface NotificationsListOptions {
  category?: NotificationCategory;
  unreadOnly?: boolean;
}

/**
 * Bell badge counts. Pulls every 60s in the background as a safety
 * net for missed Realtime events; pauses when the tab is hidden.
 */
export function useNotificationCounts() {
  const { isLoggedIn } = useAuth();

  return useQuery<NotificationCountsResponse>({
    queryKey: COUNTS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/notifications/unread-count");
      return res.json();
    },
    enabled: isLoggedIn,
    staleTime: 30_000,
    refetchInterval: (query) => {
      // Pause polling when the tab is hidden; we'll refetch on focus anyway.
      if (typeof document !== "undefined" && document.hidden) return false;
      return 60_000;
    },
    refetchOnWindowFocus: true,
  });
}

/**
 * Cursor-paginated inbox list. Use `useInfiniteQuery` so the panel can
 * fetch additional pages on scroll without losing already-loaded data.
 *
 * IMPORTANT: We dedupe rows by id when flattening pages; Realtime can
 * sometimes deliver an item that's already in the cached first page,
 * which would otherwise render twice.
 */
export function useNotificationsList(options: NotificationsListOptions = {}) {
  const { isLoggedIn } = useAuth();
  const { category, unreadOnly } = options;

  return useInfiniteQuery<NotificationListResponse>({
    queryKey: [...LIST_QUERY_KEY, { category: category ?? null, unreadOnly: !!unreadOnly }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", String(pageParam));
      if (category) params.set("category", category);
      if (unreadOnly) params.set("unreadOnly", "1");
      const url = `/api/me/notifications${params.toString() ? `?${params}` : ""}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: isLoggedIn,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

/**
 * Convenience: flat array view of the paginated list, with id-dedupe.
 */
export function flattenNotifications(
  pages: NotificationListResponse[] | undefined,
): NotificationRow[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: NotificationRow[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await apiRequest("POST", `/api/me/notifications/${notificationId}/read`);
      return res.json();
    },
    onMutate: async (notificationId) => {
      // Optimistic: flip the row's readAt and decrement the bell count.
      // Lets the user click a notification and see it un-bold instantly,
      // even before the round-trip lands. We don't snapshot lists here —
      // the row id is enough to roll back precisely on error.
      await queryClient.cancelQueries({ queryKey: COUNTS_QUERY_KEY });
      const previousCounts = queryClient.getQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY);
      if (previousCounts) {
        queryClient.setQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY, {
          ...previousCounts,
          unread: Math.max(0, previousCounts.unread - 1),
        });
      }

      const now = new Date().toISOString();
      const previousLists = queryClient.getQueriesData<{ pages?: NotificationListResponse[] }>({ queryKey: LIST_QUERY_KEY });
      for (const [key, data] of previousLists) {
        if (!data?.pages) continue;
        queryClient.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) =>
              row.id === notificationId && !row.readAt
                ? { ...row, readAt: now }
                : row,
            ),
          })),
        });
      }
      return { previousCounts, previousLists };
    },
    onError: (_err, _id, context) => {
      if (context?.previousCounts) {
        queryClient.setQueryData(COUNTS_QUERY_KEY, context.previousCounts);
      }
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/me/notifications/read-all");
      return res.json();
    },
    onMutate: async () => {
      // Optimistic: clear the unread badge + bold styling on every visible
      // row immediately. Keeps the bell feeling instant on slow mobile
      // networks. Snapshots both caches so onError can roll back.
      await queryClient.cancelQueries({ queryKey: COUNTS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: LIST_QUERY_KEY });

      const previousCounts = queryClient.getQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY);
      if (previousCounts) {
        queryClient.setQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY, {
          ...previousCounts,
          unread: 0,
          // Leave `unseen` alone — opening the bell already cleared it.
        });
      }

      const now = new Date().toISOString();
      const previousLists = queryClient.getQueriesData<{ pages?: NotificationListResponse[] }>({ queryKey: LIST_QUERY_KEY });
      for (const [key, data] of previousLists) {
        if (!data?.pages) continue;
        queryClient.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) =>
              row.readAt ? row : { ...row, readAt: now },
            ),
          })),
        });
      }

      return { previousCounts, previousLists };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousCounts) {
        queryClient.setQueryData(COUNTS_QUERY_KEY, context.previousCounts);
      }
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
    },
  });
}

/**
 * Mark every visible notification as `seenAt`. Called when the bell
 * panel opens. Does NOT mark them read — the user might just be
 * peeking. The badge clears immediately because the unread count is
 * derived from `seenAt` (we treat seen-but-not-read as "no badge,
 * still bold in list").
 */
export function useMarkNotificationsSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/me/notifications/seen");
      return res.json();
    },
    onMutate: async () => {
      // Clear the bell pulse the instant the panel opens — the round-trip
      // would otherwise let the "new arrival" pulse linger on slow nets.
      await queryClient.cancelQueries({ queryKey: COUNTS_QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY, {
          ...previous,
          unseen: 0,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(COUNTS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
    },
  });
}

export function useDismissNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await apiRequest("DELETE", `/api/me/notifications/${notificationId}`);
      return res.json();
    },
    onMutate: async (notificationId) => {
      // Optimistic: drop the row from every cached page so the swipe-to-
      // dismiss feels instant. Also decrement the unread badge if this
      // row was unread (otherwise the badge would briefly stay too high).
      await queryClient.cancelQueries({ queryKey: COUNTS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: LIST_QUERY_KEY });

      let wasUnread = false;
      const previousLists = queryClient.getQueriesData<{ pages?: NotificationListResponse[] }>({ queryKey: LIST_QUERY_KEY });
      for (const [key, data] of previousLists) {
        if (!data?.pages) continue;
        const newPages = data.pages.map((page) => {
          const filtered = page.items.filter((row) => {
            if (row.id !== notificationId) return true;
            if (!row.readAt) wasUnread = true;
            return false;
          });
          return { ...page, items: filtered };
        });
        queryClient.setQueryData(key, { ...data, pages: newPages });
      }

      const previousCounts = queryClient.getQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY);
      if (previousCounts && wasUnread) {
        queryClient.setQueryData<NotificationCountsResponse>(COUNTS_QUERY_KEY, {
          ...previousCounts,
          unread: Math.max(0, previousCounts.unread - 1),
        });
      }

      return { previousLists, previousCounts };
    },
    onError: (_err, _id, context) => {
      if (context?.previousCounts) {
        queryClient.setQueryData(COUNTS_QUERY_KEY, context.previousCounts);
      }
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
    },
  });
}

export function useNotificationPreferences() {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<NotificationPreferences>({
    queryKey: PREFS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/notification-preferences");
      return res.json();
    },
    enabled: isLoggedIn,
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (patch: Partial<NotificationPreferences>) => {
      // updatedAt is server-managed; never send it from the client.
      const { userId: _userId, updatedAt: _updatedAt, ...rest } = patch;
      const res = await apiRequest("PATCH", "/api/me/notification-preferences", rest);
      return res.json();
    },
    onMutate: async (patch) => {
      // Optimistic update — the preference toggles need to feel snappy
      // even on slow networks. We snapshot the previous value so we can
      // roll back on error.
      await queryClient.cancelQueries({ queryKey: PREFS_QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationPreferences>(PREFS_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(PREFS_QUERY_KEY, {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(PREFS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PREFS_QUERY_KEY });
    },
  });

  const update = useCallback(
    (patch: Partial<NotificationPreferences>) => mutation.mutate(patch),
    [mutation],
  );

  return {
    ...query,
    update,
    isUpdating: mutation.isPending,
  };
}

/**
 * Used by the Realtime hook to surface "the count went up by N" so the
 * bell can pulse and the toaster can fire on high-priority kinds.
 */
export function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
  }, [queryClient]);
}

export const NOTIFICATIONS_QUERY_KEYS = {
  counts: COUNTS_QUERY_KEY,
  list: LIST_QUERY_KEY,
  preferences: PREFS_QUERY_KEY,
};
