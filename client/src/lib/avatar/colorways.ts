/**
 * Rank variant catalogue — candidate avatar treatments for review.
 *
 * Four treatment levels, one per rank pair. Every variant paints the
 * SAME seed-derived role grid (see generateAvatarRoles), so an avatar
 * keeps its exact layout and dominant hue as it moves up the ladder.
 * Only the colours and the material change.
 *
 * Nothing here is wired to a user's rank yet. This is the option set the
 * Avatar Lab renders for design review; the winners get promoted into
 * the real pipeline afterwards.
 */

import {
  hslToHex,
  type AvatarRole,
  type AvatarRoleResult,
  type RoleColors,
} from './generator';
import type { AvatarEffect } from './effects';

/* ------------------------------------------------------------------ */
/* Lightness / saturation ramp                                         */
/* ------------------------------------------------------------------ */

interface RoleStop {
  /** Multiplier on the hue family's own saturation. */
  sat: number;
  l: number;
}

type Ramp = Record<Exclude<AvatarRole, 'sparkle'>, RoleStop>;

/**
 * The original v6 stops. Must stay exactly in step with
 * buildBaseRoleColors in ./generator.ts — the parity test asserts it.
 */
const BASE_RAMP: Ramp = {
  shadow: { sat: 0.95, l: 0.18 },
  dark: { sat: 1.0, l: 0.34 },
  identity: { sat: 1.0, l: 0.52 },
  bright: { sat: 0.9, l: 0.68 },
  highlight: { sat: 0.55, l: 0.86 },
  accentMid: { sat: 0.92, l: 0.56 },
  accentLight: { sat: 0.72, l: 0.74 },
};

/**
 * Saturation pinned to the ceiling for every family and the shadows
 * crushed toward black. Neon is a contrast trick more than a hue trick:
 * what sells it is lit cells sitting on something close to unlit.
 */
const NEON_RAMP: Ramp = {
  shadow: { sat: 1.3, l: 0.06 },
  dark: { sat: 1.3, l: 0.16 },
  // The mid roles sit lower than the base ramp on purpose. They cover
  // most of the grid, so leaving them at mid lightness gives the bloom a
  // bright majority to work on and the disc washes out to white.
  identity: { sat: 1.35, l: 0.4 },
  bright: { sat: 1.35, l: 0.62 },
  highlight: { sat: 1.0, l: 0.93 },
  accentMid: { sat: 1.35, l: 0.5 },
  accentLight: { sat: 1.15, l: 0.78 },
};

export interface ColorwayOptions {
  /** Hue for the accent roles. Defaults to the analogous accent. */
  secondHue?: (roles: AvatarRoleResult) => number;
  secondSatScale?: number;
  ramp?: Ramp;
  /** 0-1 desaturation applied to the two darkest roles. */
  neutralPull?: number;
}

export function buildRoleColors(
  roles: AvatarRoleResult,
  options: ColorwayOptions = {},
): RoleColors {
  const { family, primaryHue, accentHue } = roles;
  const s = family.sat;
  const ramp = options.ramp ?? BASE_RAMP;
  const secondHue = options.secondHue ? options.secondHue(roles) : accentHue;
  const secondSat = options.secondSatScale ?? 1;
  const pull = options.neutralPull ?? 0;

  // A ramp may ask for more than the family's own saturation; clamping
  // here lets the neon ramp pull every family up to the same ceiling
  // without hslToHex clipping a channel and dragging the hue with it.
  const sat = (scale: number) => Math.min(1, s * scale);

  return {
    shadow: hslToHex(primaryHue, sat(ramp.shadow.sat) * (1 - pull), ramp.shadow.l),
    dark: hslToHex(primaryHue, sat(ramp.dark.sat) * (1 - pull), ramp.dark.l),
    identity: hslToHex(primaryHue, sat(ramp.identity.sat), ramp.identity.l),
    bright: hslToHex(primaryHue, sat(ramp.bright.sat), ramp.bright.l),
    highlight: hslToHex(primaryHue, sat(ramp.highlight.sat), ramp.highlight.l),
    accentMid: hslToHex(secondHue, sat(ramp.accentMid.sat) * secondSat, ramp.accentMid.l),
    accentLight: hslToHex(secondHue, sat(ramp.accentLight.sat) * secondSat, ramp.accentLight.l),
    sparkle: '#FFFFFF',
  };
}

/* ------------------------------------------------------------------ */
/* Level 2 — duotone candidates                                        */
/* ------------------------------------------------------------------ */

export type DuotoneId = 'base' | 'duotone-split' | 'duotone-triad' | 'duotone-curated';

/**
 * All three duotones swap the SAME cells (the two accent roles, ~19% of
 * the grid) and differ only in which hue lands there. Holding coverage
 * constant keeps the comparison honest — otherwise you are judging two
 * variables at once.
 */
const DUOTONE_SAT_SCALE = 0.85;

interface DuotoneSpec {
  id: DuotoneId;
  label: string;
  blurb: string;
  options: ColorwayOptions;
}

export const DUOTONES: readonly DuotoneSpec[] = [
  {
    id: 'base',
    label: 'Base',
    blurb: 'Today\u2019s algorithm. Single hue family with an analogous accent.',
    options: {},
  },
  {
    id: 'duotone-split',
    label: 'Split complement',
    blurb: 'Second hue 165\u00B0 away. Maximum contrast without the vibration of a true 180\u00B0 opposite.',
    options: {
      secondHue: (r) => r.primaryHue + 165,
      secondSatScale: DUOTONE_SAT_SCALE,
    },
  },
  {
    id: 'duotone-triad',
    label: 'Triadic',
    blurb: 'Second hue 120\u00B0 away. Softer and more harmonious, less punch at small sizes.',
    options: {
      secondHue: (r) => r.primaryHue + 120,
      secondSatScale: DUOTONE_SAT_SCALE,
    },
  },
  {
    id: 'duotone-curated',
    label: 'Curated partner',
    blurb: 'Hand-picked partner per hue family, dodging the pairs that pure maths gets wrong.',
    options: {
      // Carry the same jitter the accent hue received so two avatars in
      // one family still differ, without drawing from the RNG stream.
      secondHue: (r) => r.family.partner + (r.accentHue - r.family.accent),
      secondSatScale: DUOTONE_SAT_SCALE,
    },
  },
] as const;

export function getDuotone(id: DuotoneId): DuotoneSpec {
  return DUOTONES.find((d) => d.id === id) ?? DUOTONES[0];
}

/* ------------------------------------------------------------------ */
/* Level 3 — surface candidates                                        */
/* ------------------------------------------------------------------ */

/**
 * Level 3 has to feel like a rank up, not a polish pass. Marble, gloss
 * and chrome all differed only in how the light fell, which is invisible
 * once an avatar is 40px in a comment row — measured across every hue
 * family they landed within a couple of points of the level 2 tiles on
 * both mean brightness and contrast. The two that replaced gloss and
 * chrome each change the palette itself, not just the lighting.
 */
export type SurfaceId = 'surface-marble' | 'surface-neon' | 'surface-aurora';

interface SurfaceSpec {
  id: SurfaceId;
  label: string;
  blurb: string;
  options: ColorwayOptions;
  buildEffects: (roles: AvatarRoleResult) => AvatarEffect[];
}

export const SURFACES: readonly SurfaceSpec[] = [
  {
    id: 'surface-marble',
    label: 'Marble',
    blurb: 'The incumbent. Rim vignette plus an upper-left specular, so the flat disc reads as a glass sphere.',
    options: {},
    buildEffects: () => [
      { kind: 'vignette', strength: 0.3 },
      { kind: 'specular', strength: 0.45 },
    ],
  },
  {
    id: 'surface-neon',
    label: 'Neon',
    blurb: 'Every family pushed to full saturation with the shadows crushed, then the lit cells bloom and the rim catches the light.',
    options: { ramp: NEON_RAMP },
    buildEffects: (roles) => [
      // Darken first: neon is lit cells against unlit ones, so without
      // somewhere dark to sit the bloom just raises the whole disc.
      { kind: 'vignette', strength: 0.3 },
      // Two multiply passes rather than one: cubing the image leaves only
      // the genuinely lit cells above the noise floor, so the bloom picks
      // out highlights instead of raising the whole disc.
      { kind: 'bloom', strength: 0.8, radius: 0.055, passes: 2 },
      // A tight rim rather than a diffuse halo. Spread this out and it
      // stops being a ring and becomes a general brightening, which is
      // exactly the "looks like level 2" problem.
      {
        kind: 'glow',
        color: hslToHex(roles.primaryHue, 1, 0.66),
        strength: 0.95,
        peak: 0.465,
        spread: 0.055,
      },
    ],
  },
  {
    id: 'surface-aurora',
    label: 'Aurora',
    blurb: 'Lit from inside rather than above: a coloured core bleeds outward into a darkened rim. The quiet step before level 4 electrifies it.',
    options: {},
    buildEffects: (roles) => [
      { kind: 'vignette', strength: 0.52 },
      // Held at mid lightness: screen blending walks any bright colour
      // toward white, and a white core loses the hue that makes this
      // read as the avatar's own light rather than a lamp behind it.
      {
        kind: 'glow',
        color: hslToHex(roles.accentHue, 1, 0.5),
        strength: 0.58,
        peak: 0.03,
        spread: 0.32,
      },
      { kind: 'bloom', strength: 0.3, radius: 0.05, passes: 2 },
    ],
  },
] as const;

export function getSurface(id: SurfaceId): SurfaceSpec {
  return SURFACES.find((s) => s.id === id) ?? SURFACES[0];
}

/* ------------------------------------------------------------------ */
/* Level 4 — charged candidates                                        */
/* ------------------------------------------------------------------ */

export type FinishId = 'gold' | 'spectrum' | 'platinum';

interface Finish {
  id: FinishId;
  label: string;
  /** Rank this finish is proposed for, from shared/rank-config.ts. */
  rank: string;
  /**
   * Centre of an electrical arc. Held near-white on purpose: a
   * saturated arc stops reading as electricity and starts reading as a
   * coloured line, so the finish has to identify itself by its glow.
   */
  arc: string;
  /** Halo and bloom around an arc. This is what makes gold look gold. */
  glow: (roles: AvatarRoleResult) => string;
}

/**
 * Gold reads worst of the three on the warm hue families, where an amber
 * glow lands on an amber avatar and the arcs stop separating. `spectrum`
 * is the answer to that: it takes each family's curated contrast partner,
 * so a blue avatar throws amber lightning and an orange one throws blue,
 * and the glow always separates from the hue the body is painted in.
 *
 * It does not separate from the *accent* cells under the curated duotone,
 * which draw from that same partner hue — but those are a fifth of the
 * grid against four fifths of body, and the bloom spreads the glow over
 * the whole disc rather than tracking individual cells. Reading it the
 * other way round, the lightning ends up sharing the avatar's own second
 * colour instead of importing a foreign one, which is the better trade.
 */
export const FINISHES: readonly Finish[] = [
  {
    id: 'gold',
    label: 'Gold',
    rank: 'Hall of Famer',
    arc: '#FFFDF0',
    glow: () => '#FFB300',
  },
  {
    id: 'spectrum',
    label: 'Spectrum',
    rank: 'Hall of Famer (alt)',
    arc: '#FFFFFF',
    glow: (roles) => hslToHex(roles.family.partner, 1, 0.6),
  },
  {
    id: 'platinum',
    label: 'Platinum',
    rank: 'VoxMax Legend',
    arc: '#FFFFFF',
    glow: () => '#9FD8FF',
  },
] as const;

export type ChargedId = 'charged-plasma' | 'charged-plasma-bold';

interface ChargedSpec {
  id: ChargedId;
  label: string;
  blurb: string;
  effect: (finish: Finish, roles: AvatarRoleResult) => AvatarEffect;
}

export const CHARGED: readonly ChargedSpec[] = [
  {
    id: 'charged-plasma',
    label: 'Plasma globe',
    blurb: 'Branching arcs thrown from a hot core, seeded per user so no two patterns match. Best at profile size.',
    effect: (finish, roles) => ({
      kind: 'plasma',
      lattice: 3,
      seed: roles.seedHash,
      arcs: 6,
      branch: 0.7,
      thickness: 1,
      dim: 0.24,
      core: 0.09,
      bloom: 0.035,
      arc: finish.arc,
      glow: finish.glow(roles),
    }),
  },
  {
    id: 'charged-plasma-bold',
    label: 'Plasma, heavy',
    blurb: 'Fewer, thicker arcs on the 2x lattice. Trades filigree for something that still reads in a feed row.',
    effect: (finish, roles) => ({
      kind: 'plasma',
      lattice: 2,
      seed: roles.seedHash,
      arcs: 5,
      branch: 0.4,
      thickness: 1,
      dim: 0.22,
      core: 0.11,
      bloom: 0.045,
      arc: finish.arc,
      glow: finish.glow(roles),
    }),
  },
] as const;

/* ------------------------------------------------------------------ */
/* Tile assembly                                                       */
/* ------------------------------------------------------------------ */

export type VariantLevel = 1 | 2 | 3 | 4;

export interface VariantTile {
  id: string;
  /**
   * Identity for render caching. Levels 3 and 4 keep a stable `id` (used
   * for filenames and test ids) while their colours change with the
   * re-base dropdowns, so anything memoising a render must key on this
   * instead or it will serve the previous base's pixels.
   */
  cacheKey: string;
  label: string;
  level: VariantLevel;
  /** Rank pair this level would apply to. */
  ranks: string;
  blurb: string;
  buildColors: (roles: AvatarRoleResult) => RoleColors;
  /**
   * Built per avatar rather than fixed: the plasma arcs are drawn from
   * the seed hash and the level 3 glows are tinted from the avatar's own
   * hue, so both need the roles that a fixed effect list cannot see.
   */
  buildEffects: (roles: AvatarRoleResult) => readonly AvatarEffect[];
}

export const LEVEL_RANKS: Record<VariantLevel, string> = {
  1: 'Citizen / Aspirant',
  2: 'Insider / Analyst',
  3: 'Expert / Maven',
  4: 'Hall of Famer / VoxMax Legend',
};

export interface TileOptions {
  /** Colourway that levels 3 and 4 inherit. */
  duotoneBase: DuotoneId;
  /** Surface that level 4 stacks its arcs on. */
  surfaceBase: SurfaceId;
}

export const DEFAULT_TILE_OPTIONS: TileOptions = {
  duotoneBase: 'duotone-curated',
  surfaceBase: 'surface-marble',
};

/**
 * The 13 review tiles: 1 base, 3 duotones, 3 surfaces, and 2 plasma
 * densities in each of the 3 finishes.
 *
 * Levels 3 and 4 inherit the chosen duotone so the ladder can be judged
 * as a progression rather than as four unrelated looks.
 */
export function buildVariantTiles(options: TileOptions = DEFAULT_TILE_OPTIONS): VariantTile[] {
  const duotone = getDuotone(options.duotoneBase);
  const surface = getSurface(options.surfaceBase);
  const tiles: VariantTile[] = [];

  for (const spec of DUOTONES) {
    tiles.push({
      id: spec.id,
      // Levels 1 and 2 define their own colours outright, so the id is
      // already a complete description of what gets painted.
      cacheKey: spec.id,
      label: spec.label,
      level: spec.id === 'base' ? 1 : 2,
      ranks: spec.id === 'base' ? LEVEL_RANKS[1] : LEVEL_RANKS[2],
      blurb: spec.blurb,
      buildColors: (roles) => buildRoleColors(roles, spec.options),
      buildEffects: () => [],
    });
  }

  for (const spec of SURFACES) {
    const merged: ColorwayOptions = { ...duotone.options, ...spec.options };
    tiles.push({
      id: spec.id,
      cacheKey: `${spec.id}@${duotone.id}`,
      label: spec.label,
      level: 3,
      ranks: LEVEL_RANKS[3],
      blurb: spec.blurb,
      buildColors: (roles) => buildRoleColors(roles, merged),
      buildEffects: spec.buildEffects,
    });
  }

  const chargedColors: ColorwayOptions = { ...duotone.options, ...surface.options };
  for (const spec of CHARGED) {
    for (const finish of FINISHES) {
      tiles.push({
        id: `${spec.id}-${finish.id}`,
        cacheKey: `${spec.id}-${finish.id}@${duotone.id}/${surface.id}`,
        label: `${spec.label} \u00B7 ${finish.label}`,
        level: 4,
        ranks: finish.rank,
        blurb: spec.blurb,
        buildColors: (roles) => buildRoleColors(roles, chargedColors),
        buildEffects: (roles) => [...surface.buildEffects(roles), spec.effect(finish, roles)],
      });
    }
  }

  return tiles;
}
