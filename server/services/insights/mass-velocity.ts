import { getCachedTrendingPeople } from "./insights-people-cache";
import { loadLatestSnapshotsByPerson } from "./snapshot-batch";

export type MassVelocityQuadrant =
  | "dominant_hot"
  | "established_cooling"
  | "breakout_watch"
  | "under_radar";

export interface MassVelocityPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  massScore: number;
  velocityScore: number;
  fameIndex: number | null;
  quadrant: MassVelocityQuadrant;
}

export interface MassVelocityResponse {
  quadrants: Record<MassVelocityQuadrant, MassVelocityPerson[]>;
  medians: { mass: number; velocity: number };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function classifyQuadrant(
  mass: number,
  velocity: number,
  medianMass: number,
  medianVelocity: number,
): MassVelocityQuadrant {
  const highMass = mass >= medianMass;
  const highVelocity = velocity >= medianVelocity;
  if (highMass && highVelocity) return "dominant_hot";
  if (highMass && !highVelocity) return "established_cooling";
  if (!highMass && highVelocity) return "breakout_watch";
  return "under_radar";
}

export async function loadMassVelocityQuadrant(): Promise<MassVelocityResponse> {
  const [people, snapshots] = await Promise.all([
    getCachedTrendingPeople(),
    loadLatestSnapshotsByPerson(),
  ]);

  const enriched: MassVelocityPerson[] = [];
  const masses: number[] = [];
  const velocities: number[] = [];

  for (const person of people) {
    const snap = snapshots.get(person.id);
    if (!snap) continue;
    masses.push(snap.massScore);
    velocities.push(snap.velocityScore);
    enriched.push({
      id: person.id,
      name: person.name,
      avatar: person.avatar ?? null,
      category: person.category ?? null,
      rank: person.rank,
      massScore: snap.massScore,
      velocityScore: snap.velocityScore,
      fameIndex: snap.fameIndex,
      quadrant: "under_radar",
    });
  }

  const medianMass = median(masses);
  const medianVelocity = median(velocities);

  const quadrants: Record<MassVelocityQuadrant, MassVelocityPerson[]> = {
    dominant_hot: [],
    established_cooling: [],
    breakout_watch: [],
    under_radar: [],
  };

  for (const row of enriched) {
    const quadrant = classifyQuadrant(
      row.massScore,
      row.velocityScore,
      medianMass,
      medianVelocity,
    );
    row.quadrant = quadrant;
    quadrants[quadrant].push(row);
  }

  for (const key of Object.keys(quadrants) as MassVelocityQuadrant[]) {
    quadrants[key].sort((a, b) => a.rank - b.rank);
  }

  return { quadrants, medians: { mass: medianMass, velocity: medianVelocity } };
}
