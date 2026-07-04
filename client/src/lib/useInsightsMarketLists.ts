import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export interface InsightsNativeMarket {
  id: string;
  slug?: string;
  title: string;
  marketType: "updown" | "h2h" | "gainer" | "jackpot";
  category: string | null;
  volume: number;
  bettingCutoff: string | null;
  resolutionDeadline: string | null;
  status?: string;
  person?: { name?: string | null; avatar?: string | null } | null;
  personName?: string | null;
  entries?: Array<{
    label?: string | null;
    person?: { name?: string | null; avatar?: string | null } | null;
  }> | null;
  metadata?: unknown;
  categoryLabel?: string | null;
}

export interface InsightsOpenMarket {
  id: string;
  slug?: string;
  title?: string;
  marketType?: string;
  endAt?: string | null;
  closeAt?: string | null;
  category?: string | null;
  volume?: number;
  coverImageUrl?: string | null;
  linkedPersonAvatar?: string | null;
  relatedPeople?: unknown[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed: ${path}`);
  return res.json();
}

/** Shared native + community market lists for Insights Predict tiles. */
export function useInsightsMarketLists(openLimit = 12) {
  // Bare URL keys + default URL-keyed fetcher so these observers share the
  // cache entries PredictPage (and useCategoryRaceMap) already maintain —
  // switching Predict ⇄ Insights no longer refetches the same three lists.
  const updownQ = useQuery<InsightsNativeMarket[]>({
    queryKey: ["/api/native-markets/updown"],
    staleTime: 60_000,
  });
  const h2hQ = useQuery<InsightsNativeMarket[]>({
    queryKey: ["/api/native-markets/h2h"],
    staleTime: 60_000,
  });
  const gainerQ = useQuery<InsightsNativeMarket[]>({
    queryKey: ["/api/native-markets/gainer"],
    staleTime: 60_000,
  });
  // Keyed by limit only (the old "hottest"/"closing" suffix changed the key
  // but not the URL, so same-limit tiles fetched + cached identical data
  // twice). Keeps the array form so `["/api/open-markets"]` prefix
  // invalidations after bets still hit this entry.
  const openQ = useQuery({
    queryKey: ["/api/open-markets", openLimit],
    queryFn: () =>
      fetchJson<
        InsightsOpenMarket[] | { data?: InsightsOpenMarket[]; markets?: InsightsOpenMarket[] }
      >(`/api/open-markets?limit=${openLimit}`).then((j) =>
        Array.isArray(j) ? j : (j.data ?? j.markets ?? []),
      ),
    staleTime: 60_000,
  });

  const marketById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const m of updownQ.data ?? []) {
      map.set(m.id, { ...m, marketType: "updown" });
    }
    for (const m of h2hQ.data ?? []) {
      map.set(m.id, { ...m, marketType: "h2h" });
    }
    for (const m of gainerQ.data ?? []) {
      map.set(m.id, { ...m, marketType: "gainer" });
    }
    for (const m of openQ.data ?? []) {
      map.set(m.id, { ...m, marketType: m.marketType ?? "community" });
    }
    return map;
  }, [updownQ.data, h2hQ.data, gainerQ.data, openQ.data]);

  const isLoading =
    updownQ.isLoading || h2hQ.isLoading || gainerQ.isLoading || openQ.isLoading;

  return { updownQ, h2hQ, gainerQ, openQ, marketById, isLoading };
}
