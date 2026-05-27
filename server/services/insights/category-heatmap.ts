import { storage } from "../../storage";

export interface CategoryHeatmapRow {
  category: string;
  median24h: number;
  median7d: number;
  hottest: {
    id: string;
    name: string;
    avatar: string | null;
    change24h: number | null;
    change7d: number | null;
    rank: number;
  } | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export async function loadCategoryHeatmap(): Promise<{ rows: CategoryHeatmapRow[] }> {
  const people = await storage.getTrendingPeople();
  const byCategory = new Map<
    string,
    { changes24: number[]; changes7: number[]; members: typeof people }
  >();

  for (const person of people) {
    const cat = person.category?.trim() || "Other";
    const bucket = byCategory.get(cat) ?? { changes24: [], changes7: [], members: [] };
    if (person.change24h != null) bucket.changes24.push(person.change24h);
    if (person.change7d != null) bucket.changes7.push(person.change7d);
    bucket.members.push(person);
    byCategory.set(cat, bucket);
  }

  const rows: CategoryHeatmapRow[] = Array.from(byCategory.entries())
    .map(([category, bucket]) => {
      const hottest = [...bucket.members].sort(
        (a, b) => (b.change7d ?? 0) - (a.change7d ?? 0),
      )[0];

      return {
        category,
        median24h: median(bucket.changes24),
        median7d: median(bucket.changes7),
        hottest: hottest
          ? {
              id: hottest.id,
              name: hottest.name,
              avatar: hottest.avatar ?? null,
              change24h: hottest.change24h ?? null,
              change7d: hottest.change7d ?? null,
              rank: hottest.rank,
            }
          : null,
      };
    })
    .sort((a, b) => b.median7d - a.median7d);

  return { rows };
}
