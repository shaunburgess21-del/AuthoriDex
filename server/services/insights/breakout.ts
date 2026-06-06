import { getCachedTrendingPeople } from "./insights-people-cache";
import { loadLatestSnapshotsByPerson } from "./snapshot-batch";
import { loadSnapshotRankMap24hAgo } from "./snapshot-rank-24h";

export interface BreakoutPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  change7d: number | null;
  velocityScore: number;
  massScore: number;
  highlight: string;
}

export interface BreakoutResponse {
  lowRank: BreakoutPerson[];
  newEntrants: BreakoutPerson[];
  quietGiants: BreakoutPerson[];
  coolingTop: BreakoutPerson[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export async function loadBreakoutRadar(): Promise<BreakoutResponse> {
  const [people, snapshots, prevRanks] = await Promise.all([
    getCachedTrendingPeople(),
    loadLatestSnapshotsByPerson(),
    loadSnapshotRankMap24hAgo(),
  ]);

  const velocities = people
    .map((p) => snapshots.get(p.id)?.velocityScore ?? 0)
    .filter((v) => v > 0);
  const medianVelocity = median(velocities);
  const velocityThreshold = medianVelocity * 1.25;

  const masses = people
    .map((p) => snapshots.get(p.id)?.massScore ?? 0)
    .filter((m) => m > 0);
  const medianMass = median(masses);
  const haveSignals = velocities.length >= 5 && masses.length >= 5;

  const lowRank: BreakoutPerson[] = [];
  const newEntrants: BreakoutPerson[] = [];
  const quietGiants: BreakoutPerson[] = [];
  const coolingTop: BreakoutPerson[] = [];

  const currentTop50 = new Set(
    [...people].sort((a, b) => a.rank - b.rank).slice(0, 50).map((p) => p.id),
  );
  const prevTop50 = new Set(
    [...prevRanks.entries()]
      .filter(([, rank]) => rank <= 50)
      .map(([id]) => id),
  );

  for (const person of people) {
    const snap = snapshots.get(person.id);
    const velocity = snap?.velocityScore ?? 0;
    const mass = snap?.massScore ?? 0;
    const change7d = person.change7d ?? null;

    const base: BreakoutPerson = {
      id: person.id,
      name: person.name,
      avatar: person.avatar ?? null,
      category: person.category ?? null,
      rank: person.rank,
      change7d,
      velocityScore: velocity,
      massScore: mass,
      highlight: "",
    };

    if (haveSignals && person.rank > 50 && velocity > velocityThreshold) {
      lowRank.push({
        ...base,
        highlight: `Rank #${person.rank} · fast momentum (${velocity.toFixed(1)}, above median)`,
      });
    }

    if (currentTop50.has(person.id) && !prevTop50.has(person.id) && person.rank <= 50) {
      const prevRank = prevRanks.get(person.id);
      newEntrants.push({
        ...base,
        highlight:
          prevRank != null
            ? `Entered top 50 (was #${prevRank} 24h ago)`
            : "New to top 50 vs 24h ago",
      });
    }

    if (
      haveSignals &&
      person.rank <= 20 &&
      mass > medianMass &&
      (change7d ?? 0) > 3
    ) {
      quietGiants.push({
        ...base,
        highlight: `Top 20 · broad attention · +${(change7d ?? 0).toFixed(1)}% 7d`,
      });
    }

    if (person.rank <= 10 && (change7d ?? 0) < -3) {
      coolingTop.push({
        ...base,
        highlight: `Top 10 cooling ${(change7d ?? 0).toFixed(1)}% over 7d`,
      });
    }
  }

  const sortByRank = (a: BreakoutPerson, b: BreakoutPerson) => a.rank - b.rank;
  const cap = (arr: BreakoutPerson[]) => arr.sort(sortByRank).slice(0, 10);

  // Fallback: if the threshold-based list came up empty (common — high velocity
  // outside the top 50 is rare), surface the highest-momentum people ranked
  // outside the top 50 so the card always has content. Ordered by momentum
  // (not rank) so the "fastest movers" framing reads correctly.
  let lowRankFinal: BreakoutPerson[];
  if (lowRank.length > 0) {
    lowRankFinal = cap(lowRank);
  } else if (haveSignals) {
    lowRankFinal = people
      .filter((p) => p.rank > 50 && (snapshots.get(p.id)?.velocityScore ?? 0) > 0)
      .map((person) => {
        const snap = snapshots.get(person.id);
        return {
          id: person.id,
          name: person.name,
          avatar: person.avatar ?? null,
          category: person.category ?? null,
          rank: person.rank,
          change7d: person.change7d ?? null,
          velocityScore: snap?.velocityScore ?? 0,
          massScore: snap?.massScore ?? 0,
          highlight: `Rank #${person.rank} · highest momentum outside the top 50`,
        };
      })
      .sort((a, b) => b.velocityScore - a.velocityScore)
      .slice(0, 10);
  } else {
    lowRankFinal = [];
  }

  return {
    lowRank: lowRankFinal,
    newEntrants: cap(newEntrants),
    quietGiants: cap(quietGiants),
    coolingTop: cap(coolingTop),
  };
}
