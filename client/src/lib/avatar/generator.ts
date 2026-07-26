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
 * The grid is generated as semantic ROLES (identity, bright, accent,
 * sparkle...) rather than hex, and a colourway maps roles to colours at
 * the end. That split is what lets rank variants recolour an avatar
 * while keeping its layout pixel-identical — see ./colorways.ts.
 *
 * To render to a canvas / PNG, see ./render.ts. Upload flow: ./upload.ts.
 */

export const AVATAR_GRID_SIZE = 10;

export interface AvatarResult {
  grid: (string | null)[][];
  seedHash: number;
  seedString: string;
}

/**
 * Semantic slot a cell occupies. The concrete colour a role resolves to
 * depends on the colourway; the role itself depends only on the seed.
 */
export type AvatarRole =
  | 'shadow'
  | 'dark'
  | 'identity'
  | 'bright'
  | 'highlight'
  | 'accentMid'
  | 'accentLight'
  | 'sparkle';

export type RoleColors = Record<AvatarRole, string>;

export interface AvatarRoleResult {
  roleGrid: AvatarRole[][];
  family: HueFamily;
  /** Primary hue after per-avatar jitter. */
  primaryHue: number;
  /** Analogous accent hue after per-avatar jitter. */
  accentHue: number;
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

/**
 * Exported so effects can open their own stream off the same seed hash.
 * Anything drawing from this must salt the seed, or it replays the exact
 * sequence the role grid used and the result visibly tracks the pixels.
 */
export function makeRng(seed: number): () => number {
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

export function hslToHex(h: number, s: number, l: number): string {
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
 *
 * `partner` is the hand-picked contrast hue used by the curated duotone
 * colourway. Chosen by eye rather than by a fixed offset: a pure
 * complement puts red next to green (reads as Christmas) and pink next
 * to lime (harsh), while orange/blue and violet/gold are worth keeping.
 */
export interface HueFamily {
  name: string;
  primary: number;
  accent: number;
  partner: number;
  sat: number;
}

export const HUE_FAMILIES: HueFamily[] = [
  { name: 'pink',    primary: 330, accent: 305, partner: 190, sat: 0.90 },
  { name: 'red',     primary: 355, accent: 20,  partner: 205, sat: 0.85 },
  { name: 'orange',  primary: 25,  accent: 45,  partner: 215, sat: 0.92 },
  { name: 'yellow',  primary: 50,  accent: 80,  partner: 255, sat: 0.88 },
  { name: 'lime',    primary: 85,  accent: 115, partner: 285, sat: 0.88 },
  { name: 'green',   primary: 140, accent: 165, partner: 320, sat: 0.82 },
  { name: 'teal',    primary: 175, accent: 200, partner: 30,  sat: 0.82 },
  { name: 'cyan',    primary: 195, accent: 215, partner: 35,  sat: 0.88 },
  { name: 'blue',    primary: 220, accent: 250, partner: 40,  sat: 0.82 },
  { name: 'indigo',  primary: 255, accent: 280, partner: 45,  sat: 0.78 },
  { name: 'violet',  primary: 285, accent: 310, partner: 50,  sat: 0.82 },
];

/**
 * The weighted role bag. Duplicates are intentional - they bias
 * per-cell random picks so the identity midtone appears most often,
 * with highlights and accents used sparingly for contrast. The length
 * and mix is tuned so roughly:
 *   ~55% primary mid-tones  (identity colour)
 *   ~20% primary dark/bright (shape and shading)
 *   ~15% accent              (analogous harmony)
 *    ~5% highlight + shadow  (depth)
 *    ~5% sparkle             (gloss)
 *
 * Order and length are load-bearing: a cell picks an index into this
 * bag, so reordering or resizing it repaints every existing avatar.
 */
const ROLE_BAG: readonly AvatarRole[] = (() => {
  const bag: AvatarRole[] = [];
  const push = (role: AvatarRole, n: number) => { for (let i = 0; i < n; i++) bag.push(role); };
  push('shadow',       2);
  push('dark',         6);
  push('identity',    14);
  push('bright',       7);
  push('highlight',    3);
  push('accentMid',    5);
  push('accentLight',  3);
  push('sparkle',      2);
  return bag;
})();

/**
 * The original v6 colourway - a single hue family with an analogous
 * accent and a white sparkle. This is what every avatar rendered
 * before rank variants existed, and it stays the Tier 1-2 look.
 */
export function buildBaseRoleColors(result: AvatarRoleResult): RoleColors {
  const { primaryHue, accentHue, family } = result;
  const s = family.sat;
  return {
    shadow:      hslToHex(primaryHue, s * 0.95, 0.18), // deep coloured shadow
    dark:        hslToHex(primaryHue, s * 1.00, 0.34),
    identity:    hslToHex(primaryHue, s * 1.00, 0.52),
    bright:      hslToHex(primaryHue, s * 0.90, 0.68),
    highlight:   hslToHex(primaryHue, s * 0.55, 0.86),
    accentMid:   hslToHex(accentHue,  s * 0.92, 0.56),
    accentLight: hslToHex(accentHue,  s * 0.72, 0.74),
    sparkle:     '#FFFFFF',
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Generate the seed-derived layout: which role each cell holds, plus
 * the hue metadata a colourway needs. Deterministic per seed.
 *
 * The RNG call order below is load-bearing. One family pick, two hue
 * jitters, then exactly one call per cell. Inserting any extra call
 * before the grid loop shifts all 100 cells and hands every existing
 * user a different avatar - so variant-specific randomness must never
 * be drawn from this stream.
 */
export function generateAvatarRoles(seedString: string): AvatarRoleResult {
  const hash = hashSeed(seedString);
  const rng = makeRng(hash);

  const family = HUE_FAMILIES[Math.floor(rng() * HUE_FAMILIES.length)];

  // Small hue jitter so two users with similar family picks still
  // look distinct, not identical.
  const primaryHue = family.primary + (rng() - 0.5) * 14;
  const accentHue  = family.accent  + (rng() - 0.5) * 14;

  const roleGrid: AvatarRole[][] = Array.from({ length: AVATAR_GRID_SIZE }, () =>
    Array.from({ length: AVATAR_GRID_SIZE }, () => ROLE_BAG[Math.floor(rng() * ROLE_BAG.length)]),
  );

  return { roleGrid, family, primaryHue, accentHue, seedHash: hash, seedString };
}

/** Paint a role grid with a resolved set of colours. */
export function paintRoleGrid(roleGrid: AvatarRole[][], colors: RoleColors): string[][] {
  return roleGrid.map((row) => row.map((role) => colors[role]));
}

/**
 * Generate an avatar from a seed string. Deterministic: the same seed
 * always produces the same result.
 */
export function generateAvatar(seedString: string): AvatarResult {
  const roles = generateAvatarRoles(seedString);
  return {
    grid: paintRoleGrid(roles.roleGrid, buildBaseRoleColors(roles)),
    seedHash: roles.seedHash,
    seedString,
  };
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

export interface FamilySample {
  family: string;
  seed: string;
}

/**
 * One seed per hue family, found by scanning a deterministic sequence.
 *
 * A colourway rule that flatters violet can be ugly on yellow, so design
 * review needs every hue on screen rather than whichever one a random
 * seed happened to land on. Order follows HUE_FAMILIES.
 */
const familySampleCache = new Map<string, FamilySample[]>();

export function buildFamilySampleSeeds(prefix = 'voxdex-family-probe'): FamilySample[] {
  const cached = familySampleCache.get(prefix);
  if (cached) return cached;

  const found = new Map<string, string>();
  for (let i = 0; found.size < HUE_FAMILIES.length && i < 10000; i++) {
    const seed = `${prefix}-${i}`;
    const { family } = generateAvatarRoles(seed);
    if (!found.has(family.name)) found.set(family.name, seed);
  }

  const samples = HUE_FAMILIES.flatMap((family) => {
    const seed = found.get(family.name);
    return seed ? [{ family: family.name, seed }] : [];
  });
  familySampleCache.set(prefix, samples);
  return samples;
}
