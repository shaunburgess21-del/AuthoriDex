/**
 * Avatar post-effects — the "material" layer of the rank variants.
 *
 * Effects are plain descriptors (see AvatarEffect) so the variant
 * registry in ./colorways.ts stays pure data and only this module needs
 * a canvas. They are painted over the finished pixel field, before the
 * circular mask in ./render.ts is applied.
 *
 * Cell-based effects (bolt, streak, plasma) are laid out on a lattice
 * that is a multiple of the 10x10 pixel grid: lattice 1 keeps the chunky
 * native cells, higher multipliers subdivide them so a motif has more
 * fidelity while the avatar underneath stays coarse.
 */

import { AVATAR_GRID_SIZE, makeRng } from './generator';

export type AvatarEffect =
  /** Darkens the rim so the flat disc reads as a sphere. */
  | { kind: 'vignette'; strength: number }
  /** Soft upper-left blown highlight, as if lit from that side. */
  | { kind: 'specular'; strength: number }
  /** Straight sheen band across the top edge. */
  | { kind: 'sheen'; strength: number }
  /** Lightning bolt struck through the middle of the disc. */
  | { kind: 'bolt'; lattice: 1 | 2; fill: string; outline: string | null }
  /** Diagonal band of metal across the disc. */
  | { kind: 'streak'; lattice: 1 | 2; fill: string; widthCells: number }
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
/* Bolt geometry                                                       */
/* ------------------------------------------------------------------ */

/**
 * The lucide `zap` outline, normalised out of its 24x24 viewBox. Reused
 * rather than hand-drawn so the motif matches the icon language already
 * used by rank badges.
 */
const ZAP_POLYGON_24: ReadonlyArray<readonly [number, number]> = [
  [13, 2], [3, 14], [12, 14], [11, 22], [21, 10], [12, 10],
];

/**
 * Shrink factor applied about the centre. At full size the bolt tips sit
 * at ~84% of the disc radius, which crowds the circular mask; 0.86 pulls
 * them back to ~72% so nothing is sheared and the motif has room.
 */
const BOLT_SCALE = 0.86;

/** Sub-samples per axis when deciding whether a lattice cell is inside. */
const COVERAGE_SAMPLES = 4;
const COVERAGE_THRESHOLD = 0.35;

const BOLT_PATH: ReadonlyArray<readonly [number, number]> = ZAP_POLYGON_24.map(
  ([x, y]) => [
    0.5 + (x / 24 - 0.5) * BOLT_SCALE,
    0.5 + (y / 24 - 0.5) * BOLT_SCALE,
  ] as const,
);

function pointInPolygon(
  px: number,
  py: number,
  poly: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

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

/**
 * Rasterise the bolt onto a lattice using area coverage rather than a
 * single centre sample. On the coarse lattice a centre test drops enough
 * cells to break the bolt into disconnected blobs; coverage keeps it
 * continuous.
 */
function boltCells(latticeSize: number): Cell[] {
  const cells: Cell[] = [];
  const step = 1 / (latticeSize * COVERAGE_SAMPLES);
  const half = step / 2;

  for (let y = 0; y < latticeSize; y++) {
    for (let x = 0; x < latticeSize; x++) {
      let hits = 0;
      for (let sy = 0; sy < COVERAGE_SAMPLES; sy++) {
        for (let sx = 0; sx < COVERAGE_SAMPLES; sx++) {
          const px = x / latticeSize + sx * step + half;
          const py = y / latticeSize + sy * step + half;
          if (pointInPolygon(px, py, BOLT_PATH)) hits++;
        }
      }
      const coverage = hits / (COVERAGE_SAMPLES * COVERAGE_SAMPLES);
      if (coverage >= COVERAGE_THRESHOLD) {
        const cell = { x, y };
        if (withinDisc(cell, latticeSize)) cells.push(cell);
      }
    }
  }
  return cells;
}

/**
 * Drop-shadow cells one step down-right of the bolt. A full outline
 * closes the motif in and reads as a sticker; offsetting to one side
 * keeps it sitting in the pixel field while still separating it.
 */
function boltShadowCells(cells: Cell[], latticeSize: number): Cell[] {
  const occupied = new Set(cells.map((c) => `${c.x},${c.y}`));
  const shadow: Cell[] = [];
  for (const c of cells) {
    const cell = { x: c.x + 1, y: c.y + 1 };
    if (cell.x >= latticeSize || cell.y >= latticeSize) continue;
    if (occupied.has(`${cell.x},${cell.y}`)) continue;
    if (!withinDisc(cell, latticeSize)) continue;
    shadow.push(cell);
  }
  return shadow;
}

/** Cells within `widthCells` of the leading diagonal, running up-right. */
function streakCells(latticeSize: number, widthCells: number): Cell[] {
  const cells: Cell[] = [];
  const halfWidth = widthCells / 2;
  for (let y = 0; y < latticeSize; y++) {
    for (let x = 0; x < latticeSize; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      // Distance from the line y = x (rotated 45deg through the centre).
      const distance = Math.abs(cy - cx) / Math.SQRT2;
      if (distance > halfWidth) continue;
      const cell = { x, y };
      if (!withinDisc(cell, latticeSize)) continue;
      cells.push(cell);
    }
  }
  return cells;
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

/** How fast the wander decays per subdivision. Below 0.5 the arc goes straight. */
const PLASMA_JITTER_DECAY = 0.62;

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
  const lattice = AVATAR_GRID_SIZE * effect.lattice;
  const geometry = cachedPlasmaGeometry(lattice, effect.seed, effect);

  paintPlasmaField(ctx, size, effect.dim);

  const layer = createLayer(ctx, size);
  if (!layer) return;

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
      case 'bolt': {
        const lattice = AVATAR_GRID_SIZE * effect.lattice;
        const cells = boltCells(lattice);
        if (effect.outline) {
          paintCells(ctx, boltShadowCells(cells, lattice), lattice, size, effect.outline);
        }
        paintCells(ctx, cells, lattice, size, effect.fill);
        break;
      }
      case 'streak': {
        const lattice = AVATAR_GRID_SIZE * effect.lattice;
        paintCells(
          ctx,
          streakCells(lattice, effect.widthCells),
          lattice,
          size,
          effect.fill,
        );
        break;
      }
      case 'plasma':
        paintPlasma(ctx, size, effect);
        break;
    }
  }
}

/** Exposed for tests — geometry is pure and worth asserting without a DOM. */
export const __geometry = { boltCells, boltShadowCells, streakCells, plasmaGeometry };
