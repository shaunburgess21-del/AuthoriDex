/**
 * VoxDex Avatar Generator — deterministic Voronoi-patch algorithm (v4).
 *
 * Pure TypeScript, zero DOM dependencies. Safe to use in browser or Node.
 * Given any string seed, produces the same AvatarResult every time.
 *
 * Usage:
 *   import { generateAvatar } from '@/lib/avatar/generator';
 *   const result = generateAvatar('some-seed-string');
 *   // result.grid is a 24x24 array of hex color strings (or null outside the circle)
 *
 * To render to a canvas, see ./render.ts. To upload a rendered PNG, see ./upload.ts.
 */

export const AVATAR_GRID_SIZE = 24;
const GRID = AVATAR_GRID_SIZE;
const CENTER = (GRID - 1) / 2;
const RADIUS = GRID / 2 - 0.3;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type Flourish = 'plain' | 'void';

export interface Palette {
  name: string;
  rarity: Rarity;
  mainHue: number;
  mainSat: number;
  accentHue: number;
  accentSat: number;
  flourish: Flourish;
  ramp: string[];
  accent: string[];
}

export interface AvatarResult {
  grid: (string | null)[][];
  mask: boolean[][];
  palette: Palette;
  seedHash: number;
  seedString: string;
}

/* ------------------------------------------------------------------ */
/* Hash + RNG (xorshift32 — deterministic, seedable)                  */
/* ------------------------------------------------------------------ */

function hashSeed(input: string): number {
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makeRng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 0xffffffff;
  };
}

/* ------------------------------------------------------------------ */
/* Color utilities                                                     */
/* ------------------------------------------------------------------ */

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r: number, g: number, b: number;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * 5-stop palette ramp. Darkest stop is L=0.22 (dim but visibly coloured,
 * not near-black). This is the critical fix for the "empty black patches"
 * issue seen in earlier algorithm versions.
 */
function buildRamp(hue: number, sat: number): string[] {
  return [
    hslToHex(hue, sat * 0.92, 0.22),  // 0 dim (still visible)
    hslToHex(hue, sat * 1.00, 0.38),  // 1 medium
    hslToHex(hue, sat * 0.98, 0.55),  // 2 saturated (identity colour)
    hslToHex(hue, sat * 0.78, 0.75),  // 3 bright
    hslToHex(hue, sat * 0.25, 0.94),  // 4 near-white hue-tinted
  ];
}

/* ------------------------------------------------------------------ */
/* Palette table (25 palettes across 4 rarity tiers)                   */
/* ------------------------------------------------------------------ */

interface RawPalette {
  name: string;
  rarity: Rarity;
  mainHue: number;
  mainSat: number;
  accentHue: number;
  accentSat: number;
  flourish: Flourish;
}

const RAW_PALETTES: RawPalette[] = [
  /* COMMONS (55%) */
  { name: 'Stone',   rarity: 'common',   mainHue: 210, mainSat: 0.12, accentHue: 30,  accentSat: 0.18, flourish: 'plain' },
  { name: 'Water',   rarity: 'common',   mainHue: 210, mainSat: 0.70, accentHue: 185, accentSat: 0.65, flourish: 'plain' },
  { name: 'Wood',    rarity: 'common',   mainHue: 25,  mainSat: 0.65, accentHue: 40,  accentSat: 0.72, flourish: 'plain' },
  { name: 'Sand',    rarity: 'common',   mainHue: 40,  mainSat: 0.58, accentHue: 25,  accentSat: 0.55, flourish: 'plain' },
  { name: 'Forest',  rarity: 'common',   mainHue: 130, mainSat: 0.58, accentHue: 90,  accentSat: 0.62, flourish: 'plain' },
  { name: 'Slate',   rarity: 'common',   mainHue: 215, mainSat: 0.22, accentHue: 200, accentSat: 0.32, flourish: 'plain' },
  { name: 'Clay',    rarity: 'common',   mainHue: 18,  mainSat: 0.68, accentHue: 30,  accentSat: 0.60, flourish: 'plain' },
  { name: 'Moss',    rarity: 'common',   mainHue: 70,  mainSat: 0.58, accentHue: 100, accentSat: 0.52, flourish: 'plain' },
  { name: 'Ocean',   rarity: 'common',   mainHue: 218, mainSat: 0.80, accentHue: 195, accentSat: 0.70, flourish: 'plain' },
  { name: 'Earth',   rarity: 'common',   mainHue: 30,  mainSat: 0.60, accentHue: 18,  accentSat: 0.64, flourish: 'plain' },

  /* UNCOMMONS (28%) */
  { name: 'Fire',    rarity: 'uncommon', mainHue: 15,  mainSat: 0.92, accentHue: 45,  accentSat: 0.92, flourish: 'plain' },
  { name: 'Ice',     rarity: 'uncommon', mainHue: 200, mainSat: 0.50, accentHue: 180, accentSat: 0.60, flourish: 'plain' },
  { name: 'Emerald', rarity: 'uncommon', mainHue: 145, mainSat: 0.85, accentHue: 165, accentSat: 0.78, flourish: 'plain' },
  { name: 'Ruby',    rarity: 'uncommon', mainHue: 350, mainSat: 0.88, accentHue: 320, accentSat: 0.80, flourish: 'plain' },
  { name: 'Violet',  rarity: 'uncommon', mainHue: 265, mainSat: 0.80, accentHue: 200, accentSat: 0.82, flourish: 'plain' },
  { name: 'Solar',   rarity: 'uncommon', mainHue: 40,  mainSat: 0.92, accentHue: 25,  accentSat: 0.92, flourish: 'plain' },

  /* RARES (13%) */
  { name: 'Sapphire', rarity: 'rare',    mainHue: 222, mainSat: 0.88, accentHue: 260, accentSat: 0.72, flourish: 'plain' },
  { name: 'Amethyst', rarity: 'rare',    mainHue: 280, mainSat: 0.80, accentHue: 320, accentSat: 0.72, flourish: 'plain' },
  { name: 'Gold',     rarity: 'rare',    mainHue: 45,  mainSat: 0.92, accentHue: 35,  accentSat: 0.85, flourish: 'plain' },
  { name: 'Crystal',  rarity: 'rare',    mainHue: 210, mainSat: 0.35, accentHue: 290, accentSat: 0.30, flourish: 'plain' },
  { name: 'Platinum', rarity: 'rare',    mainHue: 215, mainSat: 0.12, accentHue: 30,  accentSat: 0.12, flourish: 'plain' },

  /* LEGENDARIES (4%) */
  { name: 'Nebula',    rarity: 'legendary', mainHue: 285, mainSat: 0.82, accentHue: 210, accentSat: 0.88, flourish: 'plain' },
  { name: 'Aurora',    rarity: 'legendary', mainHue: 160, mainSat: 0.80, accentHue: 320, accentSat: 0.75, flourish: 'plain' },
  { name: 'Void',      rarity: 'legendary', mainHue: 270, mainSat: 0.82, accentHue: 290, accentSat: 0.75, flourish: 'void'  },
  { name: 'Chromatic', rarity: 'legendary', mainHue: 0,   mainSat: 0.92, accentHue: 180, accentSat: 0.92, flourish: 'plain' },
];

export const PALETTES: Palette[] = RAW_PALETTES.map((p) => ({
  ...p,
  ramp:   buildRamp(p.mainHue,   p.mainSat),
  accent: buildRamp(p.accentHue, p.accentSat),
}));

const TIER_WEIGHTS: Array<{ tier: Rarity; cum: number }> = [
  { tier: 'legendary', cum: 0.04 },
  { tier: 'rare',      cum: 0.17 },
  { tier: 'uncommon',  cum: 0.45 },
  { tier: 'common',    cum: 1.00 },
];

function pickPalette(rng: () => number): Palette {
  const r = rng();
  let tier: Rarity = 'common';
  for (const t of TIER_WEIGHTS) {
    if (r < t.cum) { tier = t.tier; break; }
  }
  const pool = PALETTES.filter((p) => p.rarity === tier);
  return pool[Math.floor(rng() * pool.length)];
}

/* ------------------------------------------------------------------ */
/* Mask + noise field                                                  */
/* ------------------------------------------------------------------ */

function buildMask(): boolean[][] {
  const mask: boolean[][] = Array.from({ length: GRID }, () => new Array(GRID).fill(false));
  const r2 = RADIUS * RADIUS;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const dx = x - CENTER, dy = y - CENTER;
      mask[y][x] = (dx * dx + dy * dy) <= r2;
    }
  }
  return mask;
}

function buildNoiseField(rng: () => number, size: number): number[][] {
  const lattice: number[] = [];
  for (let i = 0; i < size * size; i++) lattice.push((rng() - 0.5) * 2);
  const field: number[][] = Array.from({ length: GRID }, () => new Array(GRID).fill(0));
  const scale = (size - 1) / (GRID - 1);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const lx = x * scale, ly = y * scale;
      const x0 = Math.floor(lx), y0 = Math.floor(ly);
      const x1 = Math.min(x0 + 1, size - 1), y1 = Math.min(y0 + 1, size - 1);
      const fx = lx - x0, fy = ly - y0;
      const v00 = lattice[y0 * size + x0];
      const v10 = lattice[y0 * size + x1];
      const v01 = lattice[y1 * size + x0];
      const v11 = lattice[y1 * size + x1];
      const top = v00 * (1 - fx) + v10 * fx;
      const bot = v01 * (1 - fx) + v11 * fx;
      field[y][x] = top * (1 - fy) + bot * fy;
    }
  }
  return field;
}

/* ------------------------------------------------------------------ */
/* Voronoi patches                                                     */
/* ------------------------------------------------------------------ */

interface PatchSeed {
  x: number;
  y: number;
  stop: number;
  useAccent: boolean;
}

function pickWeightedStop(rng: () => number): number {
  const r = rng();
  if (r < 0.18) return 0;   // dim
  if (r < 0.46) return 1;   // medium
  if (r < 0.74) return 2;   // saturated
  if (r < 0.90) return 3;   // bright
  return 4;                 // near-white
}

function generatePatchSeeds(rng: () => number): PatchSeed[] {
  const nSeeds = 11 + Math.floor(rng() * 4);
  const seeds: PatchSeed[] = [];
  const minSpacingSq = 2.4 * 2.4;
  let attempts = 0;
  while (seeds.length < nSeeds && attempts++ < 400) {
    const r = Math.sqrt(rng()) * (RADIUS * 0.92);
    const a = rng() * Math.PI * 2;
    const x = CENTER + r * Math.cos(a);
    const y = CENTER + r * Math.sin(a);
    let tooClose = false;
    for (const s of seeds) {
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy < minSpacingSq) { tooClose = true; break; }
    }
    if (tooClose) continue;
    seeds.push({ x, y, stop: pickWeightedStop(rng), useAccent: rng() < 0.32 });
  }
  return seeds;
}

function fillPatches(
  mask: boolean[][],
  seeds: PatchSeed[],
  palette: Palette,
  edgeNoise: number[][],
): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: GRID }, () => new Array(GRID).fill(null));
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!mask[y][x]) continue;
      let nearest = seeds[0];
      let minDist = Infinity;
      const jitter = edgeNoise[y][x] * 3.0;
      for (const s of seeds) {
        const dx = s.x - x, dy = s.y - y;
        const d = dx * dx + dy * dy + jitter;
        if (d < minDist) { minDist = d; nearest = s; }
      }
      const ramp = nearest.useAccent ? palette.accent : palette.ramp;
      grid[y][x] = ramp[nearest.stop];
    }
  }
  return grid;
}

function applyCenterBright(
  grid: (string | null)[][],
  mask: boolean[][],
  palette: Palette,
  rng: () => number,
): void {
  const offX = (rng() - 0.5) * 1.2;
  const offY = (rng() - 0.5) * 1.2;
  const cx = CENTER + offX;
  const cy = CENTER + offY;
  const N = palette.ramp.length;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!mask[y][x]) continue;
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1.2 * 1.2) {
        grid[y][x] = palette.ramp[N - 1];
      } else if (d2 < 2.2 * 2.2) {
        grid[y][x] = palette.ramp[N - 2];
      }
    }
  }
}

function applyFlourish(
  grid: (string | null)[][],
  mask: boolean[][],
  palette: Palette,
  rng: () => number,
): void {
  if (palette.flourish !== 'void') return;
  const n = 4 + Math.floor(rng() * 4);
  let placed = 0, tries = 0;
  const bright = palette.ramp[palette.ramp.length - 1];
  while (placed < n && tries++ < 80) {
    const x = Math.floor(rng() * GRID);
    const y = Math.floor(rng() * GRID);
    if (!mask[y][x]) continue;
    const dx = x - CENTER, dy = y - CENTER;
    const radial = Math.sqrt(dx * dx + dy * dy) / RADIUS;
    if (radial < 0.45) continue;
    grid[y][x] = rng() < 0.4 ? '#ffffff' : bright;
    placed++;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Generate an avatar from a seed string. Deterministic: the same seed
 * always produces the same result.
 */
export function generateAvatar(seedString: string): AvatarResult {
  const hash = hashSeed(seedString);
  const rng = makeRng(hash);
  const palette = pickPalette(rng);
  const mask = buildMask();
  const edgeNoise = buildNoiseField(rng, 8);
  const seeds = generatePatchSeeds(rng);
  const grid = fillPatches(mask, seeds, palette, edgeNoise);
  applyCenterBright(grid, mask, palette, rng);
  applyFlourish(grid, mask, palette, rng);
  return { grid, mask, palette, seedHash: hash, seedString };
}

/**
 * Build the default seed for a new user. Uses user id + a version tag
 * so we can reason about which algorithm version produced the default.
 */
export function defaultSeedFor(userId: string): string {
  return `${userId}:default:v1`;
}

/**
 * Build 8 candidate seeds for the picker. Each modal-open produces a
 * fresh batch via the timestamp, but deterministic within the session.
 */
export function buildPickerSeeds(userId: string, sessionSalt: string, count = 8): string[] {
  return Array.from({ length: count }, (_, i) => `${userId}:pick:${sessionSalt}:${i}`);
}
