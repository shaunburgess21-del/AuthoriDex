/**
 * Avatar rendering — canvas + data URL helpers.
 *
 * Only usable in browser (requires document / HTMLCanvasElement).
 * For server-side or Node rendering, see ./upload.ts for PNG encoding.
 */

import { AVATAR_GRID_SIZE, generateAvatar, type AvatarResult } from './generator';

/**
 * Render an AvatarResult to an HTMLCanvasElement at a given pixel scale.
 * Scale 6 -> 144x144 canvas. Scale 12 -> 288x288 (retina / storage).
 */
export function renderAvatarToCanvas(result: AvatarResult, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = AVATAR_GRID_SIZE * scale;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const { grid } = result;
  for (let y = 0; y < AVATAR_GRID_SIZE; y++) {
    for (let x = 0; x < AVATAR_GRID_SIZE; x++) {
      const c = grid[y][x];
      if (c === null) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
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
 * Render scale of 6 gives a 144x144 PNG which is crisp at any display
 * size up to ~96px with `image-rendering: pixelated`.
 */
export function generateAvatarDataURL(seed: string, renderScale = 6): string {
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
 */
export async function renderAvatarToBlob(seed: string, renderScale = 12): Promise<Blob> {
  const result = generateAvatar(seed);
  const canvas = renderAvatarToCanvas(result, renderScale);
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

/** Clear the cache (e.g. on test teardown or when algorithm changes). */
export function clearAvatarCache(): void {
  dataUrlCache.clear();
}
