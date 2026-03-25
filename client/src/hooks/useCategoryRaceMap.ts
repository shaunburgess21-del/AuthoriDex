import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeMarketCategory } from "@shared/constants";

export function useCategoryRaceMap(): Map<string, string> {
  const { data } = useQuery<any[]>({ queryKey: ["/api/native-markets/gainer"] });

  return useMemo(() => {
    const map = new Map<string, string>();
    if (!Array.isArray(data)) return map;
    for (const m of data) {
      const cat = normalizeMarketCategory(m.category);
      if (!map.has(cat)) map.set(cat, String(m.id));
    }
    return map;
  }, [data]);
}
