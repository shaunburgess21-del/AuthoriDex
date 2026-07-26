/**
 * Contact sheets for avatar design review.
 *
 * Two views, because they answer different questions:
 *
 *   Variant sheet — one seed, every candidate, at three display sizes.
 *     "Does the ladder read as a progression, and does it survive a feed?"
 *
 *   Family sheet — one candidate, one seed per hue family.
 *     "Does this rule hold on yellow and lime, not just violet?"
 *
 * Composed onto a single canvas rather than zipped: no archive
 * dependency, and one image is easier to compare and pass around than
 * thirteen loose files.
 */

import { buildFamilySampleSeeds } from './generator';
import { canvasToBlob, renderVariantToCanvas } from './render';
import { LEVEL_RANKS, type VariantLevel, type VariantTile } from './colorways';

/** Everything below is authored in logical px then drawn at 2x. */
const SCALE = 2;

const BG = '#0a0a0f';
const PANEL = '#14141c';
const TEXT = '#f4f4f5';
const MUTED = '#8b8b98';
const LINE = '#26262f';

/** Display sizes chosen to match real render sites across the app. */
export const PREVIEW_SIZES = [96, 40, 24] as const;

/** Source render scale; downscaled to each preview size the way a browser would. */
const SOURCE_SCALE = 30;

function font(weight: number, px: number): string {
  return `${weight} ${px * SCALE}px system-ui, -apple-system, "Segoe UI", sans-serif`;
}

function createSheet(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';
  return { canvas, ctx };
}

function drawHeading(
  ctx: CanvasRenderingContext2D,
  width: number,
  title: string,
  subtitle: string,
): void {
  ctx.fillStyle = TEXT;
  ctx.font = font(700, 22);
  ctx.fillText(title, 32 * SCALE, 40 * SCALE);

  ctx.fillStyle = MUTED;
  ctx.font = font(400, 13);
  ctx.fillText(subtitle, 32 * SCALE, 68 * SCALE);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = SCALE;
  ctx.beginPath();
  ctx.moveTo(32 * SCALE, 88 * SCALE);
  ctx.lineTo((width - 32) * SCALE, 88 * SCALE);
  ctx.stroke();
}

/** Draw one already-rendered avatar canvas centred in a box. */
function drawAvatar(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  centreX: number,
  centreY: number,
  displaySize: number,
): void {
  const size = displaySize * SCALE;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    source,
    centreX * SCALE - size / 2,
    centreY * SCALE - size / 2,
    size,
    size,
  );
}

/* ------------------------------------------------------------------ */
/* Variant sheet                                                       */
/* ------------------------------------------------------------------ */

const LABEL_COL = 300;
const SIZE_COL = 124;
const ROW_H = 118;
const LEVEL_H = 46;
const HEADER_H = 108;

export function buildVariantSheetCanvas(
  seed: string,
  tiles: readonly VariantTile[],
): HTMLCanvasElement {
  const levels = [...new Set(tiles.map((t) => t.level))].sort() as VariantLevel[];
  const width = 32 + LABEL_COL + PREVIEW_SIZES.length * SIZE_COL + 32;
  const height =
    HEADER_H + levels.length * LEVEL_H + tiles.length * ROW_H + 32;

  const { canvas, ctx } = createSheet(width, height);
  drawHeading(
    ctx,
    width,
    'VoxDex avatar variants',
    `seed: ${seed || '(empty)'}`,
  );

  // Size column headings.
  ctx.fillStyle = MUTED;
  ctx.font = font(600, 11);
  ctx.textAlign = 'center';
  PREVIEW_SIZES.forEach((size, i) => {
    const x = 32 + LABEL_COL + i * SIZE_COL + SIZE_COL / 2;
    ctx.fillText(`${size}px`, x * SCALE, (HEADER_H - 16) * SCALE);
  });
  ctx.textAlign = 'left';

  let y = HEADER_H;
  let lastLevel: VariantLevel | null = null;

  for (const tile of tiles) {
    if (tile.level !== lastLevel) {
      lastLevel = tile.level;
      ctx.fillStyle = PANEL;
      ctx.fillRect(32 * SCALE, y * SCALE, (width - 64) * SCALE, LEVEL_H * SCALE);
      ctx.fillStyle = TEXT;
      ctx.font = font(700, 12);
      ctx.fillText(
        `LEVEL ${tile.level} \u2014 ${LEVEL_RANKS[tile.level].toUpperCase()}`,
        44 * SCALE,
        (y + LEVEL_H / 2) * SCALE,
      );
      y += LEVEL_H;
    }

    const source = renderVariantToCanvas(seed, SOURCE_SCALE, tile);
    const midY = y + ROW_H / 2;

    ctx.fillStyle = TEXT;
    ctx.font = font(600, 14);
    ctx.fillText(tile.label, 44 * SCALE, (midY - 26) * SCALE);

    ctx.fillStyle = MUTED;
    ctx.font = font(400, 11);
    ctx.fillText(tile.id, 44 * SCALE, (midY - 6) * SCALE);
    wrapText(ctx, tile.blurb, 44, midY + 16, LABEL_COL - 24, 14);

    PREVIEW_SIZES.forEach((size, i) => {
      const x = 32 + LABEL_COL + i * SIZE_COL + SIZE_COL / 2;
      drawAvatar(ctx, source, x, midY, size);
    });

    ctx.strokeStyle = LINE;
    ctx.lineWidth = SCALE;
    ctx.beginPath();
    ctx.moveTo(32 * SCALE, (y + ROW_H) * SCALE);
    ctx.lineTo((width - 32) * SCALE, (y + ROW_H) * SCALE);
    ctx.stroke();

    y += ROW_H;
  }

  return canvas;
}

/**
 * Wrap into at most `maxLines`, truncating with an ellipsis. The row
 * height is fixed, so an unbounded wrap would let a long blurb spill
 * over the separator into the tile below.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
): void {
  ctx.fillStyle = MUTED;
  ctx.font = font(400, 11);

  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth * SCALE && line) {
      lines.push(line);
      if (lines.length === maxLines) break;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  const overflowed = lines.length === maxLines && line && lines[maxLines - 1] !== line;
  if (overflowed) lines[maxLines - 1] = `${lines[maxLines - 1]}\u2026`;

  lines.forEach((entry, i) => {
    ctx.fillText(entry, x * SCALE, (y + i * lineHeight) * SCALE);
  });
}

/* ------------------------------------------------------------------ */
/* Family sheet                                                        */
/* ------------------------------------------------------------------ */

const FAMILY_COLS = 4;
const FAMILY_CELL_W = 172;
const FAMILY_CELL_H = 156;

export function buildFamilySheetCanvas(tile: VariantTile): HTMLCanvasElement {
  const samples = buildFamilySampleSeeds();
  const rows = Math.ceil(samples.length / FAMILY_COLS);
  const width = 32 + FAMILY_COLS * FAMILY_CELL_W + 32;
  const height = HEADER_H + rows * FAMILY_CELL_H + 32;

  const { canvas, ctx } = createSheet(width, height);
  drawHeading(
    ctx,
    width,
    `Hue families \u2014 ${tile.label}`,
    `${tile.id} \u00B7 ${tile.ranks}`,
  );

  samples.forEach((sample, i) => {
    const col = i % FAMILY_COLS;
    const row = Math.floor(i / FAMILY_COLS);
    const cellX = 32 + col * FAMILY_CELL_W;
    const cellY = HEADER_H + row * FAMILY_CELL_H;
    const source = renderVariantToCanvas(sample.seed, SOURCE_SCALE, tile);

    drawAvatar(ctx, source, cellX + 62, cellY + 60, 96);
    drawAvatar(ctx, source, cellX + 132, cellY + 60, 24);

    ctx.fillStyle = TEXT;
    ctx.font = font(600, 12);
    ctx.textAlign = 'center';
    ctx.fillText(sample.family, (cellX + FAMILY_CELL_W / 2) * SCALE, (cellY + 130) * SCALE);
    ctx.textAlign = 'left';
  });

  return canvas;
}

/* ------------------------------------------------------------------ */
/* Blob helpers                                                        */
/* ------------------------------------------------------------------ */

export function buildVariantSheetBlob(
  seed: string,
  tiles: readonly VariantTile[],
): Promise<Blob> {
  return canvasToBlob(buildVariantSheetCanvas(seed, tiles));
}

export function buildFamilySheetBlob(tile: VariantTile): Promise<Blob> {
  return canvasToBlob(buildFamilySheetCanvas(tile));
}

/** Filesystem-safe fragment of a seed, for download filenames. */
export function seedSlug(seed: string): string {
  const cleaned = seed.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'seed').slice(0, 32).toLowerCase();
}
