import { createPRNG } from "../agents/prng";

/** Weighted random sample without replacement (deterministic given rng). */
export function weightedSampleWithoutReplacement(
  pool: string[],
  weights: Map<string, number>,
  count: number,
  rng: ReturnType<typeof createPRNG>,
): string[] {
  const picked: string[] = [];
  const remaining = [...pool];

  for (let draw = 0; draw < count && remaining.length > 0; draw++) {
    let total = 0;
    for (const id of remaining) {
      total += weights.get(id) ?? 0;
    }
    if (total <= 0) {
      const idx = Math.floor(rng.nextFloat() * remaining.length);
      picked.push(remaining.splice(idx, 1)[0]);
      continue;
    }

    let roll = rng.nextFloat() * total;
    let chosenIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weights.get(remaining[i]) ?? 0;
      if (roll <= 0) {
        chosenIdx = i;
        break;
      }
      chosenIdx = i;
    }
    picked.push(remaining.splice(chosenIdx, 1)[0]);
  }

  return picked;
}
