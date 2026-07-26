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
 * Deeper shadows and brighter highlights. Contrast is the one property
 * that survives being downscaled to a 24px feed avatar, so this is the
 * gloss candidate that leans on it rather than on added geometry.
 */
const WIDE_RAMP: Ramp = {
  shadow: { sat: 0.95, l: 0.12 },
  dark: { sat: 1.0, l: 0.3 },
  identity: { sat: 1.0, l: 0.52 },
  bright: { sat: 0.9, l: 0.72 },
  highlight: { sat: 0.5, l: 0.92 },
  accentMid: { sat: 0.92, l: 0.56 },
  accentLight: { sat: 0.7, l: 0.78 },
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

  return {
    shadow: hslToHex(primaryHue, s * ramp.shadow.sat * (1 - pull), ramp.shadow.l),
    dark: hslToHex(primaryHue, s * ramp.dark.sat * (1 - pull), ramp.dark.l),
    identity: hslToHex(primaryHue, s * ramp.identity.sat, ramp.identity.l),
    bright: hslToHex(primaryHue, s * ramp.bright.sat, ramp.bright.l),
    highlight: hslToHex(primaryHue, s * ramp.highlight.sat, ramp.highlight.l),
    accentMid: hslToHex(secondHue, s * ramp.accentMid.sat * secondSat, ramp.accentMid.l),
    accentLight: hslToHex(secondHue, s * ramp.accentLight.sat * secondSat, ramp.accentLight.l),
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
/* Level 3 — glass candidates                                          */
/* ------------------------------------------------------------------ */

export type GlassId = 'glass-marble' | 'glass-gloss' | 'glass-chrome';

interface GlassSpec {
  id: GlassId;
  label: string;
  blurb: string;
  options: ColorwayOptions;
  effects: AvatarEffect[];
}

export const GLASSES: readonly GlassSpec[] = [
  {
    id: 'glass-marble',
    label: 'Marble',
    blurb: 'Rim vignette plus an upper-left specular, so the flat disc reads as a glass sphere.',
    options: {},
    effects: [
      { kind: 'vignette', strength: 0.3 },
      { kind: 'specular', strength: 0.45 },
    ],
  },
  {
    id: 'glass-gloss',
    label: 'Gloss',
    blurb: 'No vignette. Widens the lightness ramp so contrast survives a 24px feed, plus a top sheen.',
    options: { ramp: WIDE_RAMP },
    effects: [{ kind: 'sheen', strength: 0.28 }],
  },
  {
    id: 'glass-chrome',
    label: 'Chrome',
    blurb: 'Marble treatment with the darkest roles pulled toward neutral, for metal rather than candy.',
    options: { neutralPull: 0.45 },
    effects: [
      { kind: 'vignette', strength: 0.34 },
      { kind: 'specular', strength: 0.5 },
    ],
  },
] as const;

export function getGlass(id: GlassId): GlassSpec {
  return GLASSES.find((g) => g.id === id) ?? GLASSES[0];
}

/* ------------------------------------------------------------------ */
/* Level 4 — charged candidates                                        */
/* ------------------------------------------------------------------ */

export type MetalId = 'gold' | 'platinum';

interface Metal {
  id: MetalId;
  label: string;
  /** Rank whose colour this is, from shared/rank-config.ts. */
  rank: string;
  fill: string;
  shadow: string;
  /**
   * Centre of an electrical arc. Held near-white on purpose: a fully
   * saturated arc stops reading as electricity and starts reading as a
   * coloured line, so the metal has to identify itself through the glow.
   */
  arc: string;
  /** Halo and bloom around an arc. This is what makes gold look gold. */
  glow: string;
}

/**
 * Shadows are near-black rather than a darker shade of the metal. A
 * tinted shadow vanishes on the warm hue families — a gold bolt on a
 * yellow or orange avatar has almost no edge — so the contour has to be
 * dark enough to separate the motif from any background it lands on.
 */
export const METALS: readonly Metal[] = [
  {
    id: 'gold',
    label: 'Gold',
    rank: 'Hall of Famer',
    fill: '#FFD700',
    shadow: '#2B1F00',
    arc: '#FFF6D5',
    glow: '#FFC61A',
  },
  {
    id: 'platinum',
    label: 'Platinum',
    rank: 'VoxMax Legend',
    fill: '#E5E4E2',
    shadow: '#1E1E22',
    arc: '#FFFFFF',
    glow: '#9FD8FF',
  },
] as const;

export type ChargedId =
  | 'charged-plasma'
  | 'charged-plasma-bold'
  | 'charged-bolt-fine'
  | 'charged-streak';

interface ChargedSpec {
  id: ChargedId;
  label: string;
  blurb: string;
  effect: (metal: Metal, roles: AvatarRoleResult) => AvatarEffect;
}

export const CHARGED: readonly ChargedSpec[] = [
  {
    id: 'charged-plasma',
    label: 'Plasma globe',
    blurb: 'Branching arcs thrown from a hot core, seeded per user so no two patterns match. Best at profile size.',
    effect: (metal, roles) => ({
      kind: 'plasma',
      lattice: 3,
      seed: roles.seedHash,
      arcs: 6,
      branch: 0.7,
      thickness: 1,
      dim: 0.45,
      core: 0.09,
      bloom: 0.035,
      arc: metal.arc,
      glow: metal.glow,
    }),
  },
  {
    id: 'charged-plasma-bold',
    label: 'Plasma, heavy',
    blurb: 'Fewer, thicker arcs on the 2x lattice. Trades filigree for something that still reads in a feed row.',
    effect: (metal, roles) => ({
      kind: 'plasma',
      lattice: 2,
      seed: roles.seedHash,
      arcs: 5,
      branch: 0.4,
      thickness: 1,
      dim: 0.4,
      core: 0.11,
      bloom: 0.045,
      arc: metal.arc,
      glow: metal.glow,
    }),
  },
  {
    id: 'charged-bolt-fine',
    label: 'Bolt, 2x lattice',
    blurb: 'The single struck bolt, kept as the comparison. One fixed motif for everyone rather than a per-user pattern.',
    effect: (metal) => ({ kind: 'bolt', lattice: 2, fill: metal.fill, outline: metal.shadow }),
  },
  {
    id: 'charged-streak',
    label: 'Diagonal streak',
    blurb: 'A clean two-cell metal band instead of lightning. The hedge if the electrical motifs read as stickers.',
    effect: (metal) => ({ kind: 'streak', lattice: 1, fill: metal.fill, widthCells: 2 }),
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
   * Built per avatar rather than fixed, because the plasma arcs are
   * drawn from the seed hash — every user gets their own lightning.
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
  /** Material that level 4 stacks its motif on. */
  glassBase: GlassId;
}

export const DEFAULT_TILE_OPTIONS: TileOptions = {
  duotoneBase: 'duotone-curated',
  glassBase: 'glass-marble',
};

/**
 * The 15 review tiles: 1 base, 3 duotones, 3 glasses, and 4 charged
 * motifs rendered in both rank metals.
 *
 * Levels 3 and 4 inherit the chosen duotone so the ladder can be judged
 * as a progression rather than as four unrelated looks.
 */
export function buildVariantTiles(options: TileOptions = DEFAULT_TILE_OPTIONS): VariantTile[] {
  const duotone = getDuotone(options.duotoneBase);
  const glass = getGlass(options.glassBase);
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

  for (const spec of GLASSES) {
    const merged: ColorwayOptions = { ...duotone.options, ...spec.options };
    tiles.push({
      id: spec.id,
      cacheKey: `${spec.id}@${duotone.id}`,
      label: spec.label,
      level: 3,
      ranks: LEVEL_RANKS[3],
      blurb: spec.blurb,
      buildColors: (roles) => buildRoleColors(roles, merged),
      buildEffects: () => spec.effects,
    });
  }

  const chargedColors: ColorwayOptions = { ...duotone.options, ...glass.options };
  for (const spec of CHARGED) {
    for (const metal of METALS) {
      tiles.push({
        id: `${spec.id}-${metal.id}`,
        cacheKey: `${spec.id}-${metal.id}@${duotone.id}/${glass.id}`,
        label: `${spec.label} \u00B7 ${metal.label}`,
        level: 4,
        ranks: metal.rank,
        blurb: spec.blurb,
        buildColors: (roles) => buildRoleColors(roles, chargedColors),
        buildEffects: (roles) => [...glass.effects, spec.effect(metal, roles)],
      });
    }
  }

  return tiles;
}
