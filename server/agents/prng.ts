/**
 * Mulberry32 — fast, simple, good-quality 32-bit PRNG.
 * Returns a factory function. Call nextFloat() for values in [0, 1).
 */
export function createPRNG(seed: number) {
  let s = seed >>> 0;
  return {
    nextFloat(): number {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export const productionRNG = {
  nextFloat: () => Math.random(),
};

export type RNG = typeof productionRNG;
