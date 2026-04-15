import { useQuery } from "@tanstack/react-query";
import { useDeferredValue } from "react";

export type SearchablePerson = {
  id: string;
  name: string;
  avatar: string | null;
  status: string;
  category: string;
};

type SearchResponse = {
  data: SearchablePerson[];
  totalCount: number;
};

export function usePeopleSearch(query: string, limit = 10) {
  const deferred = useDeferredValue(query.trim());
  const enabled = deferred.length >= 2;

  return useQuery<SearchResponse>({
    queryKey: ["/api/people/search", deferred, limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/people/search?q=${encodeURIComponent(deferred)}&limit=${limit}`,
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });
}
