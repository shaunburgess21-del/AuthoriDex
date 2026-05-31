import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export const HOT_MOVERS_QUERY_KEY = ["/api/trending/hot-movers"] as const;

interface HotMoverRow {
  id: string;
}

interface HotMoversResponse {
  data: HotMoverRow[];
}

export function useHotMoverIds(): Set<string> {
  const { data } = useQuery<HotMoversResponse | HotMoverRow[]>({
    queryKey: HOT_MOVERS_QUERY_KEY,
    refetchInterval: 60_000,
  });

  return useMemo(() => {
    const rows = data ? (Array.isArray(data) ? data : data.data ?? []) : [];
    return new Set(rows.map((row) => row.id));
  }, [data]);
}

export function useIsHotMover(personId: string | undefined): boolean {
  const hotMoverIds = useHotMoverIds();
  return personId ? hotMoverIds.has(personId) : false;
}
