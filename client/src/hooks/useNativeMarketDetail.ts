import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

interface MarketsByIdResponse {
  nativeDetail?: Record<string, unknown> | null;
}

/**
 * Resolves a native market (updown / h2h / gainer) for detail pages.
 * OPEN markets come from the type-scoped list feed; resolved / past-week
 * markets fall back to GET /api/markets/:id `nativeDetail`.
 */
export function useNativeMarketDetail(
  marketId: string,
  listQueryKey: string,
  listQueryOptions?: Record<string, unknown>,
) {
  const listEnabled = Boolean(marketId);

  const {
    data: list,
    isLoading: listLoading,
    isFetched: listFetched,
  } = useQuery<any[]>({
    queryKey: [listQueryKey],
    refetchOnWindowFocus: true,
    enabled: listEnabled,
    ...(listQueryOptions as object),
  });

  const marketFromList = useMemo(() => {
    if (!list || !marketId) return null;
    return list.find((m: { id: string }) => m.id === marketId) ?? null;
  }, [list, marketId]);

  const needsFallback = Boolean(marketId && listFetched && !marketFromList);

  const {
    data: byIdPayload,
    isLoading: byIdLoading,
    isFetched: byIdFetched,
  } = useQuery<MarketsByIdResponse>({
    queryKey: ["/api/markets", marketId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${marketId}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "NOT_FOUND" : "FETCH_FAILED");
      }
      return res.json();
    },
    enabled: needsFallback,
    retry: false,
  });

  const market: any = marketFromList ?? byIdPayload?.nativeDetail ?? null;
  const isLoading =
    !marketId ? false : listLoading || (needsFallback && byIdLoading);
  const notFound =
    !marketId ||
    (listFetched &&
      !isLoading &&
      !market &&
      (!needsFallback || byIdFetched));

  return {
    market,
    isLoading,
    notFound,
    isFromList: Boolean(marketFromList),
    list,
    listFetched,
  };
}
