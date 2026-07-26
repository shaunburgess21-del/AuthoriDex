/**
 * Avatar rendering — canvas + data URL helpers.
 *
 * Only usable in browser (requires document / HTMLCanvasElement).
 * For server-side or Node rendering, see ./upload.ts for PNG encoding.
 */

import {
  AVATAR_GRID_SIZE,
  generateAvatar,
  generateAvatarRoles,
  paintRoleGrid,
  type AvatarResult,
} from './generator';
import { applyAvatarEffects, type AvatarEffect } from './effects';
import type { VariantTile } from './colorways';

/**
 * Render an AvatarResult to an HTMLCanvasElement at a given pixel scale.
 * Scale 6 -> 144x144 canvas. Scale 12 -> 288x288 (retina / storage).
 *
 * `effects` is the rank-variant material layer; it defaults to empty, so
 * every pre-variant caller renders exactly what it always did.
 */
export function renderAvatarToCanvas(
  result: AvatarResult,
  scale: number,
  effects: readonly AvatarEffect[] = [],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = AVATAR_GRID_SIZE * scale;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');

  // Step 1: draw pixel art across the ENTIRE canvas (including corners).
  // Null cells get their nearest neighbor's color so the circular mask
  // applied below never clips to transparent corners — which would
  // otherwise show the stair-stepped edge of the 24x24 design circle.
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const filled = fillOuterCells(result.grid);
  for (let y = 0; y < AVATAR_GRID_SIZE; y++) {
    for (let x = 0; x < AVATAR_GRID_SIZE; x++) {
      ctx.fillStyle = filled[y][x];
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  // Step 2: paint the variant material over the finished pixel field,
  // before masking, so vignettes and motifs are clipped with everything
  // else rather than bleeding past the circle.
  if (effects.length > 0) {
    applyAvatarEffects(ctx, size, effects);
  }

  // Step 3: trim the square of pixel art down to a mathematically
  // perfect, anti-aliased circle. `destination-in` keeps only pixels
  // covered by the next draw call; the arc is drawn with smoothing
  // enabled so the boundary is sub-pixel accurate.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

/**
 * Replace every null cell in the 24x24 grid with the color of its
 * nearest non-null neighbor (squared-distance). Pushes pixel colors
 * into the corners so the anti-aliased circular mask in
 * `renderAvatarToCanvas` has fully-covered material to clip against.
 */
function fillOuterCells(grid: (string | null)[][]): string[][] {
  const n = AVATAR_GRID_SIZE;
  const out: string[][] = Array.from({ length: n }, () => new Array<string>(n).fill('#000000'));
  const filled: Array<{ x: number; y: number; color: string }> = [];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = grid[y][x];
      if (c !== null) {
        out[y][x] = c;
        filled.push({ x, y, color: c });
      }
    }
  }

  if (filled.length === 0) return out;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] !== null) continue;
      let best = filled[0];
      let bestD = Infinity;
      for (const f of filled) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      out[y][x] = best.color;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Data URL cache — avoids re-rendering same seed across components    */
/* ------------------------------------------------------------------ */

const dataUrlCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 500;

/**
 * Generate a PNG data URL for a given seed. Cached in memory.
 * Safe to call repeatedly — second call for the same seed is free.
 *
 * Default scale of 14 produces a 140x140 PNG (10x10 grid * 14 px cells)
 * which is crisp at any display size up to ~128px with
 * `image-rendering: pixelated`.
 */
export function generateAvatarDataURL(seed: string, renderScale = 14): string {
  if (!seed) return '';
  const key = `${seed}:${renderScale}`;
  const cached = dataUrlCache.get(key);
  if (cached) return cached;

  const result = generateAvatar(seed);
  const canvas = renderAvatarToCanvas(result, renderScale);
  const dataURL = canvas.toDataURL('image/png');

  // Simple LRU-ish: when at cap, drop the oldest entry
  if (dataUrlCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = dataUrlCache.keys().next().value;
    if (firstKey) dataUrlCache.delete(firstKey);
  }
  dataUrlCache.set(key, dataURL);
  return dataURL;
}

/**
 * Render a seed directly to a PNG Blob at a specified size.
 * Used by the upload flow to produce the bytes that go to Supabase Storage.
 * Default scale of 30 produces a 300x300 PNG (10x10 grid * 30 px cells).
 */
export async function renderAvatarToBlob(seed: string, renderScale = 30): Promise<Blob> {
  const result = generateAvatar(seed);
  return canvasToBlob(renderAvatarToCanvas(result, renderScale));
}

/** Clear the cache (e.g. on test teardown or when algorithm changes). */
export function clearAvatarCache(): void {
  dataUrlCache.clear();
}

/* ------------------------------------------------------------------ */
/* Rank variants                                                       */
/* ------------------------------------------------------------------ */

/**
 * Render a seed under a rank variant. The role grid comes from the seed
 * alone, so every variant of a given seed shares an identical layout —
 * only the paint and the material differ.
 */
export function renderVariantToCanvas(
  seed: string,
  scale: number,
  tile: VariantTile,
): HTMLCanvasElement {
  const roles = generateAvatarRoles(seed);
  const grid = paintRoleGrid(roles.roleGrid, tile.buildColors(roles));
  return renderAvatarToCanvas(
    { grid, seedHash: roles.seedHash, seedString: seed },
    scale,
    tile.buildEffects(roles),
  );
}

/** Cached PNG data URL for a seed under a variant. */
export function renderVariantDataURL(
  seed: string,
  tile: VariantTile,
  renderScale = 14,
): string {
  if (!seed) return '';
  const key = `${seed}:${renderScale}:${tile.cacheKey}`;
  const cached = dataUrlCache.get(key);
  if (cached) return cached;

  const dataURL = renderVariantToCanvas(seed, renderScale, tile).toDataURL('image/png');
  if (dataUrlCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = dataUrlCache.keys().next().value;
    if (firstKey) dataUrlCache.delete(firstKey);
  }
  dataUrlCache.set(key, dataURL);
  return dataURL;
}

/** PNG bytes for a seed under a variant. */
export function renderVariantToBlob(
  seed: string,
  tile: VariantTile,
  renderScale = 30,
): Promise<Blob> {
  return canvasToBlob(renderVariantToCanvas(seed, renderScale, tile));
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob returned null'));
      },
      'image/png',
    );
  });
}
