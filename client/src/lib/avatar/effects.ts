/**
 * Avatar post-effects — the "material" layer of the rank variants.
 *
 * Effects are plain descriptors (see AvatarEffect) so the variant
 * registry in ./colorways.ts stays pure data and only this module needs
 * a canvas. They are painted over the finished pixel field, before the
 * circular mask in ./render.ts is applied.
 *
 * Cell-based effects (bolt, streak) are laid out on a lattice that is a
 * multiple of the 10x10 pixel grid: lattice 1 keeps the chunky native
 * cells, lattice 2 halves them so a motif has twice the fidelity while
 * the avatar underneath stays coarse.
 */

import { AVATAR_GRID_SIZE } from './generator';

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
  | { kind: 'streak'; lattice: 1 | 2; fill: string; widthCells: number };

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
    ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
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
    }
  }
}

/** Exposed for tests — geometry is pure and worth asserting without a DOM. */
export const __geometry = { boltCells, boltShadowCells, streakCells };
