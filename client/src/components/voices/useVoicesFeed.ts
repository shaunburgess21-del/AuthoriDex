import { useInfiniteQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import type { VoicesFeedMode, VoicesFeedResponse, VoicesFilters } from "./types";
import { stripTombstonedPosts } from "./deleteVoicesPost";
import { voicesFeedSearchParams } from "./voicesFilters";

export interface UseVoicesFeedArgs {
  mode: VoicesFeedMode;
  filters: VoicesFilters;
}

export function voicesFilterKey(filters: VoicesFilters): string {
  return JSON.stringify({
    s: [...filters.surfaces].sort(),
    p: [...filters.personIds].sort(),
    c: [...filters.categories].sort(),
  });
}

export function voicesFeedQueryKey(mode: VoicesFeedMode, filters: VoicesFilters) {
  return ["/api/voices/feed", mode, voicesFilterKey(filters)] as const;
}

/**
 * Cursor-paginated Voices feed. A custom queryFn is required because the filter
 * params are part of the key but not a valid URL path.
 */
export function useVoicesFeed({ mode, filters }: UseVoicesFeedArgs) {
  return useInfiniteQuery<VoicesFeedResponse>({
    queryKey: voicesFeedQueryKey(mode, filters),
    queryFn: async ({ pageParam }) => {
      const cursor = (pageParam as string | null) ?? null;
      const qs = voicesFeedSearchParams(mode, filters, cursor);
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/voices/feed?${qs}`, {
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error(`${res.status}: Failed to load Voices feed`);
      return stripTombstonedPosts(await res.json());
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep the previous page while filters change, but not across For You /
    // Latest / Top — otherwise Latest renders the For You list until its
    // request returns and the two tabs look identical.
    placeholderData: (previousData, previousQuery) => {
      if (previousQuery?.queryKey?.[1] !== mode) return undefined;
      return previousData;
    },
    staleTime: 30_000,
  });
}
