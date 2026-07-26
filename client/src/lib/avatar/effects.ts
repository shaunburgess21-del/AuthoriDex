/**
 * Avatar post-effects — the "material" layer of the rank variants.
 *
 * Effects are plain descriptors (see AvatarEffect) so the variant
 * registry in ./colorways.ts stays pure data and only this module needs
 * a canvas. They are painted over the finished pixel field, before the
 * circular mask in ./render.ts is applied.
 *
 * Cell-based effects are laid out on a lattice that is a multiple of the
 * 10x10 pixel grid, so a motif can carry more fidelity than the avatar
 * underneath: lattice 2 halves the native cells, lattice 3 thirds them.
 */

import { AVATAR_GRID_SIZE, makeRng } from './generator';

export type AvatarEffect =
  /** Darkens the rim so the flat disc reads as a sphere. */
  | { kind: 'vignette'; strength: number }
  /** Soft upper-left blown highlight, as if lit from that side. */
  | { kind: 'specular'; strength: number }
  /** Straight sheen band across the top edge. */
  | { kind: 'sheen'; strength: number }
  /**
   * Blooms whatever is already on the canvas. Highlights are isolated by
   * multiplying the image by itself, so lit cells spread and mid-tones
   * barely move.
   */
  | { kind: 'bloom'; strength: number; radius: number; passes: 1 | 2 }
  /**
   * Additive radial band. `peak` is where it is strongest as a fraction
   * of the canvas edge, so 0 lights the centre and 0.5 lights the rim.
   */
  | { kind: 'glow'; color: string; strength: number; peak: number; spread: number }
  /** Plasma-globe arcs branching out of a hot core. */
  | {
      kind: 'plasma';
      lattice: 2 | 3 | 4;
      /** Avatar seed hash, so every user gets their own arc pattern. */
      seed: number;
      /** Main arcs radiating from the core. */
      arcs: number;
      /** Probability that an arc forks a shorter branch. */
      branch: number;
      /** 2 dilates each arc by a cell, for legibility over fidelity. */
      thickness: 1 | 2;
      /**
       * How far the pixel field is darkened before the arcs land on it.
       * Without this the bloom simply washes the avatar out, and the
       * whole point is that you can still tell whose avatar it is.
       */
      dim: number;
      /** Core radius as a fraction of the canvas edge. */
      core: number;
      /** Bloom blur radius as a fraction of the canvas edge. 0 disables. */
      bloom: number;
      /** Near-white centre of an arc. */
      arc: string;
      /** Halo and bloom tint. Carries the metal; the arc cannot. */
      glow: string;
    };

/* ------------------------------------------------------------------ */
/* Lattice cells                                                       */
/* ------------------------------------------------------------------ */

interface Cell {
  x: number;
  y: number;
}

/** Keeps a cell only if its centre sits comfortably inside the disc. */
function withinDisc(cell: Cell, latticeSize: number): boolean {
  const cx = (cell.x + 0.5) / latticeSize - 0.5;
  const cy = (cell.y + 0.5) / latticeSize - 0.5;
  return Math.hypot(cx, cy) <= 0.49;
}

/* ------------------------------------------------------------------ */
/* Plasma geometry                                                     */
/* ------------------------------------------------------------------ */

/**
 * Mixed into the seed hash before the arc RNG is opened, so the arcs do
 * not replay the sequence that placed the pixel roles.
 */
const PLASMA_SALT = 0x9e3779b9;

/** Subdivisions of each arc. 4 gives 16 segments, enough to read as forked. */
const PLASMA_DEPTH = 4;

/** Perpendicular wander of the first subdivision, as a share of segment length. */
const PLASMA_JITTER = 0.32;

/** How fast the wander decays per subdivision. Below 0.5 the arc goes straight. */
const PLASMA_JITTER_DECAY = 0.62;

/**
 * Arc lengths are dealt from a fixed spread rather than drawn
 * independently. Independent draws hand out six similar lengths often
 * enough to matter, and six even spokes read as a snowflake rather than
 * as lightning. Index 0 is always dealt, so one arc always reaches the
 * rim however the shuffle falls.
 */
const ARC_LENGTHS = [1, 0.55, 0.86, 0.45, 0.95, 0.66, 0.76, 0.5] as const;

function dealLengths(count: number, rng: () => number): number[] {
  const pool: number[] = [];
  for (let i = 0; i < count; i++) pool.push(ARC_LENGTHS[i % ARC_LENGTHS.length]);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

export interface PlasmaGeometry {
  /** Bright cells forming the arcs themselves. */
  arc: Cell[];
  /** Cells orthogonally adjacent to an arc, painted as a dim halo. */
  halo: Cell[];
}

type Point = readonly [number, number];

/**
 * Midpoint displacement: repeatedly split every segment and push the new
 * midpoint sideways by a shrinking amount. Cheaper than a proper
 * dielectric-breakdown model and, at this resolution, indistinguishable.
 */
function jaggedPath(from: Point, to: Point, rng: () => number): Point[] {
  let points: Point[] = [from, to];
  let jitter = PLASMA_JITTER;

  for (let pass = 0; pass < PLASMA_DEPTH; pass++) {
    const next: Point[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        const offset = (rng() - 0.5) * 2 * length * jitter;
        next.push([
          (x1 + x2) / 2 - (dy / length) * offset,
          (y1 + y2) / 2 + (dx / length) * offset,
        ]);
      }
      next.push(points[i + 1]);
    }
    points = next;
    jitter *= PLASMA_JITTER_DECAY;
  }

  return points;
}

/** Bresenham, bounded and clipped to the lattice. */
function rasterLine(from: Point, to: Point, latticeSize: number, out: Set<number>): void {
  let x = Math.round(from[0]);
  let y = Math.round(from[1]);
  const endX = Math.round(to[0]);
  const endY = Math.round(to[1]);
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;

  // Guarded rather than while(true): a branch tip can land far outside
  // the lattice, and an unbounded walk there would never terminate.
  const limit = latticeSize * 4;
  for (let guard = 0; guard <= limit; guard++) {
    if (x >= 0 && y >= 0 && x < latticeSize && y < latticeSize) {
      out.add(y * latticeSize + x);
    }
    if (x === endX && y === endY) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += stepX; }
    if (doubled <= dx) { error += dx; y += stepY; }
  }
}

interface PlasmaSpec {
  arcs: number;
  branch: number;
  thickness: 1 | 2;
}

function plasmaGeometry(latticeSize: number, seed: number, spec: PlasmaSpec): PlasmaGeometry {
  const rng = makeRng((seed ^ PLASMA_SALT) >>> 0);
  const mid = latticeSize / 2;
  const reach = latticeSize * 0.46;
  const struck = new Set<number>();

  const stroke = (path: Point[]) => {
    for (let i = 0; i < path.length - 1; i++) {
      rasterLine(path[i], path[i + 1], latticeSize, struck);
    }
  };

  const slot = (Math.PI * 2) / spec.arcs;
  const spin = rng() * Math.PI * 2;
  const lengths = dealLengths(spec.arcs, rng);

  for (let i = 0; i < spec.arcs; i++) {
    // Slotted so the arcs cover the disc, then jittered hard enough that
    // opposite arcs stop lining up into a single straight spoke.
    const angle = spin + i * slot + (rng() - 0.5) * slot * 0.9;
    const length = reach * lengths[i];

    // Origins wander off the exact centre so the arcs meet in a loose
    // tangle rather than a hard star point.
    const driftAngle = rng() * Math.PI * 2;
    const drift = rng() * latticeSize * 0.035;
    const origin: Point = [
      mid + Math.cos(driftAngle) * drift,
      mid + Math.sin(driftAngle) * drift,
    ];

    const path = jaggedPath(
      origin,
      [origin[0] + Math.cos(angle) * length, origin[1] + Math.sin(angle) * length],
      rng,
    );
    stroke(path);

    let chance = spec.branch;
    for (let fork = 0; fork < 2; fork++) {
      if (rng() >= chance) break;
      const from = path[Math.floor(path.length * (0.35 + rng() * 0.4))];
      const spread = (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.7);
      const forkLength = length * (0.28 + rng() * 0.3);
      stroke(
        jaggedPath(
          from,
          [
            from[0] + Math.cos(angle + spread) * forkLength,
            from[1] + Math.sin(angle + spread) * forkLength,
          ],
          rng,
        ),
      );
      chance *= 0.45;
    }
  }

  if (spec.thickness === 2) {
    for (const key of [...struck]) {
      const x = key % latticeSize;
      const y = (key - x) / latticeSize;
      if (x + 1 < latticeSize) struck.add(y * latticeSize + x + 1);
      if (y + 1 < latticeSize) struck.add((y + 1) * latticeSize + x);
    }
  }

  const arc: Cell[] = [];
  const haloKeys = new Set<number>();
  for (const key of struck) {
    const x = key % latticeSize;
    const y = (key - x) / latticeSize;
    if (withinDisc({ x, y }, latticeSize)) arc.push({ x, y });

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= latticeSize || ny >= latticeSize) continue;
      const neighbour = ny * latticeSize + nx;
      if (struck.has(neighbour)) continue;
      haloKeys.add(neighbour);
    }
  }

  const halo: Cell[] = [];
  for (const key of haloKeys) {
    const x = key % latticeSize;
    const y = (key - x) / latticeSize;
    if (withinDisc({ x, y }, latticeSize)) halo.push({ x, y });
  }

  return { arc, halo };
}

/**
 * The lab re-renders the same seed across a dozen tiles and both contact
 * sheets, so the arc walk is worth keeping rather than repeating.
 */
const geometryCache = new Map<string, PlasmaGeometry>();
const MAX_GEOMETRY_ENTRIES = 240;

function cachedPlasmaGeometry(
  latticeSize: number,
  seed: number,
  spec: PlasmaSpec,
): PlasmaGeometry {
  const key = `${latticeSize}:${seed}:${spec.arcs}:${spec.branch}:${spec.thickness}`;
  const hit = geometryCache.get(key);
  if (hit) return hit;

  const geometry = plasmaGeometry(latticeSize, seed, spec);
  if (geometryCache.size >= MAX_GEOMETRY_ENTRIES) {
    const oldest = geometryCache.keys().next().value;
    if (oldest !== undefined) geometryCache.delete(oldest);
  }
  geometryCache.set(key, geometry);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */

function paintCells(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  latticeSize: number,
  size: number,
  fill: string,
): void {
  const cell = size / latticeSize;
  ctx.fillStyle = fill;
  for (const c of cells) {
    // Snapped to whole pixels. On a lattice that does not divide the
    // canvas evenly, fractional rects anti-alias their shared edges and
    // leave seams down the middle of what should be one solid arc.
    const x = Math.round(c.x * cell);
    const y = Math.round(c.y * cell);
    ctx.fillRect(x, y, Math.round((c.x + 1) * cell) - x, Math.round((c.y + 1) * cell) - y);
  }
}

function paintVignette(ctx: CanvasRenderingContext2D, size: number, strength: number): void {
  const mid = size / 2;
  const shade = Math.round(255 * (1 - Math.max(0, Math.min(1, strength))));
  const rim = `rgb(${shade}, ${shade}, ${shade})`;
  const gradient = ctx.createRadialGradient(mid, mid, size * 0.12, mid, mid, size * 0.54);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.58, '#ffffff');
  gradient.addColorStop(1, rim);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

function paintSpecular(ctx: CanvasRenderingContext2D, size: number, strength: number): void {
  const cx = size * 0.34;
  const cy = size * 0.29;
  const rx = size * 0.34;
  const ry = size * 0.25;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${strength})`);
  gradient.addColorStop(0.55, `rgba(255, 255, 255, ${strength * 0.35})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintSheen(ctx: CanvasRenderingContext2D, size: number, strength: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, size * 0.45);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${strength})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size * 0.45);
  ctx.restore();
}

/**
 * Squaring an image is a cheap highlight pass: a cell at 0.4 luminance
 * falls to 0.16 while one at 0.95 barely moves, so blurring the result
 * blooms the lit cells and leaves the mid-tones alone.
 */
function paintBloom(
  ctx: CanvasRenderingContext2D,
  size: number,
  effect: Extract<AvatarEffect, { kind: 'bloom' }>,
): void {
  if (typeof ctx.filter !== 'string') return;
  const layer = createLayer(ctx, size);
  if (!layer) return;

  layer.drawImage(ctx.canvas, 0, 0);
  layer.globalCompositeOperation = 'multiply';
  for (let pass = 0; pass < effect.passes; pass++) {
    layer.drawImage(ctx.canvas, 0, 0);
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = effect.strength;
  ctx.filter = `blur(${(size * effect.radius).toFixed(2)}px)`;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

/** Stops sampled along the radius; enough to read as smooth at any size. */
const GLOW_STOPS = 14;

function paintGlow(
  ctx: CanvasRenderingContext2D,
  size: number,
  effect: Extract<AvatarEffect, { kind: 'glow' }>,
): void {
  const mid = size / 2;
  const outer = size * Math.min(0.5, effect.peak + effect.spread);
  if (outer <= 0 || effect.spread <= 0) return;

  const gradient = ctx.createRadialGradient(mid, mid, 0, mid, mid, outer);
  for (let i = 0; i <= GLOW_STOPS; i++) {
    const t = i / GLOW_STOPS;
    const distance = Math.abs((t * outer) / size - effect.peak);
    const alpha = effect.strength * Math.max(0, 1 - distance / effect.spread);
    gradient.addColorStop(t, withAlpha(effect.color, alpha));
  }

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(mid, mid, outer, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Scratch canvas matching the target, for effects that need two passes. */
function createLayer(
  ctx: CanvasRenderingContext2D,
  size: number,
): CanvasRenderingContext2D | null {
  const doc = ctx.canvas.ownerDocument ?? (typeof document === 'undefined' ? null : document);
  if (!doc) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const layer = canvas.getContext('2d');
  if (layer) layer.imageSmoothingEnabled = false;
  return layer;
}

/**
 * Sinks the pixel field into shadow so the arcs have something to be
 * bright against, keeping the rim darker than the middle so the disc
 * still reads as a sphere lit from inside.
 */
function paintPlasmaField(ctx: CanvasRenderingContext2D, size: number, strength: number): void {
  if (strength <= 0) return;
  const mid = size / 2;
  const level = (amount: number) => {
    const v = Math.round(255 * (1 - Math.max(0, Math.min(1, amount))));
    return `rgb(${v}, ${v}, ${v})`;
  };

  const gradient = ctx.createRadialGradient(mid, mid, 0, mid, mid, size * 0.52);
  gradient.addColorStop(0, level(strength * 0.45));
  gradient.addColorStop(0.5, level(strength));
  gradient.addColorStop(1, level(Math.min(1, strength * 1.35)));

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

/** Blown-out white centre the arcs appear to be thrown from. */
function paintCore(
  ctx: CanvasRenderingContext2D,
  size: number,
  radius: number,
  arc: string,
  glow: string,
): void {
  const mid = size / 2;
  const gradient = ctx.createRadialGradient(mid, mid, 0, mid, mid, radius);
  gradient.addColorStop(0, arc);
  gradient.addColorStop(0.4, withAlpha(arc, 0.7));
  gradient.addColorStop(0.75, withAlpha(glow, 0.3));
  gradient.addColorStop(1, withAlpha(glow, 0));

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(mid, mid, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Arcs are drawn once to a scratch layer, then composited twice: blurred
 * and additive for the bloom, then crisp on top. Painting straight onto
 * the avatar cannot do this — blurring in place would smear the pixel
 * field underneath along with the lightning.
 */
function paintPlasma(
  ctx: CanvasRenderingContext2D,
  size: number,
  effect: Extract<AvatarEffect, { kind: 'plasma' }>,
): void {
  // Claimed before anything is painted: bailing after the field has been
  // dimmed would leave a darkened avatar with no lightning on it.
  const layer = createLayer(ctx, size);
  if (!layer) return;

  const lattice = AVATAR_GRID_SIZE * effect.lattice;
  const geometry = cachedPlasmaGeometry(lattice, effect.seed, effect);

  paintPlasmaField(ctx, size, effect.dim);

  // Halo first; the arcs overwrite it wherever the two meet. Kept faint
  // on purpose — at full strength it reads as arc rather than as glow,
  // and a one-cell arc turns into a three-cell smear.
  layer.globalAlpha = 0.3;
  paintCells(layer, geometry.halo, lattice, size, effect.glow);
  layer.globalAlpha = 1;
  paintCells(layer, geometry.arc, lattice, size, effect.arc);
  paintCore(layer, size, size * effect.core, effect.arc, effect.glow);

  const blur = size * effect.bloom;
  ctx.save();
  if (blur > 0 && typeof ctx.filter === 'string') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = `blur(${blur.toFixed(2)}px)`;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.filter = 'none';
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

/**
 * Paint a variant's effects onto an already-drawn pixel field. `size` is
 * the canvas edge in px; the caller applies the circular mask afterwards.
 */
export function applyAvatarEffects(
  ctx: CanvasRenderingContext2D,
  size: number,
  effects: readonly AvatarEffect[],
): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'vignette':
        paintVignette(ctx, size, effect.strength);
        break;
      case 'specular':
        paintSpecular(ctx, size, effect.strength);
        break;
      case 'sheen':
        paintSheen(ctx, size, effect.strength);
        break;
      case 'bloom':
        paintBloom(ctx, size, effect);
        break;
      case 'glow':
        paintGlow(ctx, size, effect);
        break;
      case 'plasma':
        paintPlasma(ctx, size, effect);
        break;
    }
  }
}

/** Exposed for tests — geometry is pure and worth asserting without a DOM. */
export const __geometry = { plasmaGeometry };
