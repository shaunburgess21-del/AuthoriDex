import { useQuery } from "@tanstack/react-query";

export interface WikiSummary {
  /** Short Wikidata tagline, e.g. "American singer". */
  description: string | null;
  /** Lead-paragraph plain text. Null for disambiguation pages. */
  extract: string | null;
  pageUrl: string;
}

interface WikiSummaryResponse {
  type?: string;
  description?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } };
}

/**
 * Wikipedia's public REST summary (CORS-enabled, no key). Used for the
 * Induction Queue spotlight instead of /api/celebrity-profile, which runs
 * LLM generation for shadow rows on a cache miss.
 */
export function wikiSummaryQueryOptions(wikiSlug: string | null | undefined) {
  return {
    queryKey: ["wikipedia-summary", wikiSlug ?? ""] as const,
    queryFn: async (): Promise<WikiSummary> => {
      const slug = encodeURIComponent(wikiSlug!);
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
      if (!res.ok) throw new Error(`Wikipedia summary ${res.status}`);
      const body = (await res.json()) as WikiSummaryResponse;
      return {
        description: body.description?.trim() || null,
        extract: body.type === "disambiguation" ? null : body.extract?.trim() || null,
        pageUrl: body.content_urls?.mobile?.page ?? `https://en.wikipedia.org/wiki/${slug}`,
      };
    },
    enabled: !!wikiSlug,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  };
}

export function useWikiSummary(wikiSlug: string | null | undefined) {
  return useQuery(wikiSummaryQueryOptions(wikiSlug));
}
