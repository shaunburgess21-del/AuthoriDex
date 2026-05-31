import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

interface HotMoverRow {
  id: string;
}

interface HotMoversResponse {
  data: HotMoverRow[];
}

export function useHotMoverIds(): Set<string> {
  const { data } = useQuery<HotMoversResponse | HotMoverRow[]>({
    queryKey: ["/api/trending/hot-movers"],
    refetchInterval: 60_000,
  });

  return useMemo(() => {
    const rows = data ? (Array.isArray(data) ? data : data.data ?? []) : [];
    return new Set(rows.map((row) => row.id));
  }, [data]);
}
