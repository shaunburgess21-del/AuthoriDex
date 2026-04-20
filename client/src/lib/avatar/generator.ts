/**
 * VoxDex Avatar Generator - Shiny monochromatic pixel algorithm (v6).
 *
 * Pure TypeScript, zero DOM dependencies. Safe in browser or Node.
 * Given any string seed, produces the same AvatarResult every time.
 *
 * Design (Grok-inspired):
 *   - 10x10 chunky grid (retro pop-pixel look after circular clip).
 *   - Per-avatar, pick ONE primary hue family. Build a 5-stop lightness
 *     ramp within that hue (deep shadow -> dark -> identity -> bright
 *     -> near-white highlight). This is what gives the "shiny/wet"
 *     appearance: adjacent dark + light pixels of the same hue read
 *     as specular lighting.
 *   - Add a 2-stop analogous accent hue (neighbouring on the colour
 *     wheel) for harmony without breaking the dominant identity.
 *   - Add an occasional pure-white "sparkle" pop.
 *   - No pure black - dark areas are deep-coloured versions of the
 *     primary hue, which keeps the avatar feeling alive rather than
 *     punched with neutral holes.
 *
 * To render to a canvas / PNG, see ./render.ts. Upload flow: ./upload.ts.
 */

export const AVATAR_GRID_SIZE = 10;

export interface AvatarResult {
  grid: (string | null)[][];
  seedHash: number;
  seedString: string;
}

/* ------------------------------------------------------------------ */
/* Hash + RNG (xorshift32 - deterministic, seedable)                  */
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
/* Colour utilities                                                    */
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

/* ------------------------------------------------------------------ */
/* Hue families                                                        */
/* ------------------------------------------------------------------ */

/**
 * Each entry defines a primary hue and an analogous accent hue
 * (neighbouring on the colour wheel). Saturation tuned per family
 * because some hues need less sat to feel right (e.g. yellow).
 */
interface HueFamily {
  name: string;
  primary: number;
  accent: number;
  sat: number;
}

const HUE_FAMILIES: HueFamily[] = [
  { name: 'pink',    primary: 330, accent: 305, sat: 0.90 },
  { name: 'red',     primary: 355, accent: 20,  sat: 0.85 },
  { name: 'orange',  primary: 25,  accent: 45,  sat: 0.92 },
  { name: 'yellow',  primary: 50,  accent: 80,  sat: 0.88 },
  { name: 'lime',    primary: 85,  accent: 115, sat: 0.88 },
  { name: 'green',   primary: 140, accent: 165, sat: 0.82 },
  { name: 'teal',    primary: 175, accent: 200, sat: 0.82 },
  { name: 'cyan',    primary: 195, accent: 215, sat: 0.88 },
  { name: 'blue',    primary: 220, accent: 250, sat: 0.82 },
  { name: 'indigo',  primary: 255, accent: 280, sat: 0.78 },
  { name: 'violet',  primary: 285, accent: 310, sat: 0.82 },
];

/**
 * Build the per-avatar weighted palette. Duplicates in the returned
 * array are intentional - they bias per-cell random picks so the
 * identity midtone appears most often, with highlights and accents
 * used sparingly for contrast. The array length and mix is tuned so
 * roughly:
 *   ~55% primary mid-tones  (identity colour)
 *   ~20% primary dark/bright (shape and shading)
 *   ~15% accent              (analogous harmony)
 *    ~5% highlight + shadow  (depth)
 *    ~5% white sparkle       (gloss)
 */
function buildWeightedPalette(rng: () => number): string[] {
  const family = HUE_FAMILIES[Math.floor(rng() * HUE_FAMILIES.length)];

  // Small hue jitter so two users with similar family picks still
  // look distinct, not identical.
  const primaryHue = family.primary + (rng() - 0.5) * 14;
  const accentHue  = family.accent  + (rng() - 0.5) * 14;
  const s = family.sat;

  const primary = {
    shadow:    hslToHex(primaryHue, s * 0.95, 0.18), // deep coloured shadow
    dark:      hslToHex(primaryHue, s * 1.00, 0.34),
    identity:  hslToHex(primaryHue, s * 1.00, 0.52),
    bright:    hslToHex(primaryHue, s * 0.90, 0.68),
    highlight: hslToHex(primaryHue, s * 0.55, 0.86),
  };

  const accent = {
    mid:   hslToHex(accentHue, s * 0.92, 0.56),
    light: hslToHex(accentHue, s * 0.72, 0.74),
  };

  const white = '#FFFFFF';

  // Build the weighted bag. Each entry = one "ticket" for random pick.
  const bag: string[] = [];
  const push = (hex: string, n: number) => { for (let i = 0; i < n; i++) bag.push(hex); };
  push(primary.shadow,    2);
  push(primary.dark,      6);
  push(primary.identity, 14);
  push(primary.bright,    7);
  push(primary.highlight, 3);
  push(accent.mid,        5);
  push(accent.light,      3);
  push(white,             2);
  return bag;
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
  const palette = buildWeightedPalette(rng);

  const grid: (string | null)[][] = Array.from({ length: AVATAR_GRID_SIZE }, () =>
    Array.from({ length: AVATAR_GRID_SIZE }, () => palette[Math.floor(rng() * palette.length)]),
  );

  return { grid, seedHash: hash, seedString };
}

/**
 * Build the default seed for a new user. Includes a version tag so we
 * can reason about which algorithm version produced the default.
 */
export function defaultSeedFor(userId: string): string {
  return `${userId}:default:v1`;
}

/**
 * Build candidate seeds for the picker. Each modal-open produces a
 * fresh batch via the session salt, but deterministic within a session.
 */
export function buildPickerSeeds(userId: string, sessionSalt: string, count = 8): string[] {
  return Array.from({ length: count }, (_, i) => `${userId}:pick:${sessionSalt}:${i}`);
}
