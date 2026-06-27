import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import type { VoicesFeedMode, VoicesFeedResponse, VoicesFilters } from "./types";

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

function buildQueryString(mode: VoicesFeedMode, filters: VoicesFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", "20");
  if (filters.surfaces.length > 0) params.set("surfaces", filters.surfaces.join(","));
  if (filters.personIds.length > 0) params.set("personIds", filters.personIds.join(","));
  if (filters.categories.length > 0) params.set("categories", filters.categories.join(","));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
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
      const qs = buildQueryString(mode, filters, cursor);
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/voices/feed?${qs}`, {
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error(`${res.status}: Failed to load Voices feed`);
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
