/**
 * Community (World Market) OG image — real card image + path-outlined text.
 *
 * WhatsApp/iMessage previews for /markets/:slug used to come from the
 * generic query-param SVG (`/api/og/image/market.png?...`), whose `<text>`
 * elements need fontconfig fonts that don't exist in the production Linux
 * container — librsvg rendered them as empty tofu rectangles on the brand
 * gradient ("random blank blue screen"). This renderer mirrors the proven
 * sentiment-poll OG pipeline instead: the market's actual card image
 * (coverImageUrl, else the linked person's avatar — same resolution order
 * as the card UI, see client predictMarketImage.ts) is cover-fitted to
 * 1200x630 and every label is drawn as SVG path outlines via opentype.js
 * + the bundled Inter TTFs, which librsvg fills like any vector shape.
 */
import sharp from "sharp";
import type { AmmPriceChip } from "./og-page-payload";
import { measureOutlinedTextWidth, textPath } from "./og-svg-text-paths";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const JPEG_MAX_BYTES = 550_000;
const JPEG_QUALITY_START = 82;
const JPEG_QUALITY_MIN = 65;
const HERO_JPEG_QUALITY = 85;

const MARGIN_X = 48;
const TITLE_FONT_SIZE = 52;
const TITLE_WEIGHT = 700;
const TITLE_LINE_STEP = 64;
const TITLE_MAX_WIDTH = OG_WIDTH - MARGIN_X * 2;
/** Baseline of the LAST title line — chips row hangs below it. */
const TITLE_LAST_BASELINE_Y = 506;

const CHIP_ROW_Y = 542;
const CHIP_HEIGHT = 48;
const CHIP_FONT_SIZE = 24;
const CHIP_WEIGHT = 600;
const CHIP_PAD_X = 20;
const CHIP_GAP = 14;
/** Chips stop here so they can't run under the bottom-right domain tag. */
const CHIP_MAX_X = 960;

const PRICE_CHIP_FILL: Record<AmmPriceChip["accent"], string> = {
  up: "#10B981",
  down: "#F43F5E",
  other: "#A855F7",
};

export interface MarketOgImageContext {
  title: string;
  /** Uppercased into the top-right pill (e.g. "TECH", "WORLD MARKET"). */
  categoryLabel: string;
  /** Resolved card image: coverImageUrl ?? linked person avatar ?? null. */
  imageUrl: string | null;
  /** Pre-fetched card-image bytes (tests). Takes precedence over imageUrl. */
  imageBuffer?: Buffer | null;
  /** Live LMSR chips (already sorted by price desc); empty = no row. */
  chips: AmmPriceChip[];
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trim()}...`;
}

async function fetchImageBuffer(url: string | null): Promise<Buffer | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "image/*" },
    });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Brand-gradient stand-in when a market has no card image at all. */
function buildPlaceholderHeroSvg(title: string): string {
  const initial = (title.trim().charAt(0) || "?").toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  <defs>
    <linearGradient id="ph" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#ph)"/>
  ${textPath({
    text: initial,
    x: OG_WIDTH / 2,
    y: OG_HEIGHT / 2 + 60,
    fontSize: 220,
    weight: 700,
    fill: "#ffffff",
    anchor: "middle",
    opacity: 0.16,
  })}
</svg>`;
}

async function coverHeroJpeg(
  imageBuf: Buffer | null,
  title: string,
): Promise<Buffer> {
  if (imageBuf) {
    try {
      return await sharp(imageBuf)
        .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
        .jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch {
      /* fall through to placeholder */
    }
  }
  return sharp(Buffer.from(buildPlaceholderHeroSvg(title), "utf8"))
    .jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * Width-measured word wrap, capped at `maxLines` with an ellipsis. Every
 * returned line is guaranteed to fit maxWidth (hard-truncated if a single
 * word overflows on its own).
 */
function wrapTitleLines(title: string, maxLines: number): string[] {
  const fits = (s: string) =>
    measureOutlinedTextWidth(s, TITLE_FONT_SIZE, TITLE_WEIGHT) <= TITLE_MAX_WIDTH;

  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (!fits(candidate) && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const truncated = lines.length > maxLines;
  const kept = lines.slice(0, maxLines);
  for (let i = 0; i < kept.length; i++) {
    let line = kept[i];
    const needsEllipsis = (i === kept.length - 1 && truncated) || !fits(line);
    if (!needsEllipsis) continue;
    line = `${line}…`;
    while (!fits(line) && line.length > 2) {
      line = `${line.slice(0, -2).trimEnd()}…`;
    }
    kept[i] = line;
  }
  return kept;
}

function priceChipsSvg(chips: AmmPriceChip[]): string {
  const parts: string[] = [];
  let cursorX = MARGIN_X;
  for (const chip of chips.slice(0, 3)) {
    const text = `${truncate(chip.label, 20)} ${Math.round(chip.pct)}%`;
    const width =
      CHIP_PAD_X * 2 +
      Math.ceil(measureOutlinedTextWidth(text, CHIP_FONT_SIZE, CHIP_WEIGHT));
    if (cursorX + width > CHIP_MAX_X) break;
    const fill = PRICE_CHIP_FILL[chip.accent];
    parts.push(
      `<rect x="${cursorX}" y="${CHIP_ROW_Y}" width="${width}" height="${CHIP_HEIGHT}" rx="${CHIP_HEIGHT / 2}" fill="${fill}" fill-opacity="0.22" stroke="${fill}" stroke-opacity="0.65" stroke-width="1.5"/>`,
      textPath({
        text,
        x: cursorX + CHIP_PAD_X,
        y: CHIP_ROW_Y + CHIP_HEIGHT / 2 + CHIP_FONT_SIZE / 3,
        fontSize: CHIP_FONT_SIZE,
        weight: CHIP_WEIGHT,
        fill: "#ffffff",
      }),
    );
    cursorX += width + CHIP_GAP;
  }
  return parts.join("\n  ");
}

export function buildMarketOgOverlaySvg(ctx: MarketOgImageContext): string {
  const titleLines = wrapTitleLines(truncate(ctx.title, 120), 2);
  const firstBaseline =
    TITLE_LAST_BASELINE_Y - (titleLines.length - 1) * TITLE_LINE_STEP;
  const titleSvg = titleLines
    .map((line, i) =>
      textPath({
        text: line,
        x: MARGIN_X,
        y: firstBaseline + i * TITLE_LINE_STEP,
        fontSize: TITLE_FONT_SIZE,
        weight: TITLE_WEIGHT,
        fill: "#ffffff",
      }),
    )
    .join("\n  ");

  const category = truncate(ctx.categoryLabel || "World market", 24).toUpperCase();
  const categoryTextW = measureOutlinedTextWidth(category, 18, 600, 1);
  const pillW = Math.max(120, Math.ceil(categoryTextW) + 48);
  const pillX = OG_WIDTH - MARGIN_X - pillW;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0"/>
      <stop offset="45%" stop-color="#0f172a" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="url(#accent)"/>
  <rect width="${OG_WIDTH}" height="140" fill="url(#topFade)"/>
  <rect y="280" width="${OG_WIDTH}" height="350" fill="url(#bottomFade)"/>

  ${textPath({
    text: "VoxDex",
    x: MARGIN_X,
    y: 58,
    fontSize: 34,
    weight: 700,
    fill: "#ffffff",
  })}
  <rect x="${pillX}" y="32" width="${pillW}" height="40" rx="20" fill="#1e293b" fill-opacity="0.85" stroke="#38bdf8" stroke-opacity="0.45"/>
  ${textPath({
    text: category,
    x: pillX + pillW / 2,
    y: 60,
    fontSize: 18,
    weight: 600,
    fill: "#7dd3fc",
    anchor: "middle",
    letterSpacing: 1,
  })}

  ${titleSvg}

  ${priceChipsSvg(ctx.chips)}

  ${textPath({
    text: "voxdex.com",
    x: OG_WIDTH - MARGIN_X,
    y: CHIP_ROW_Y + CHIP_HEIGHT / 2 + CHIP_FONT_SIZE / 3,
    fontSize: 22,
    weight: 500,
    fill: "#cbd5e1",
    anchor: "end",
  })}
</svg>`;
}

async function buildOverlayPng(ctx: MarketOgImageContext): Promise<Buffer> {
  return sharp(Buffer.from(buildMarketOgOverlaySvg(ctx), "utf8"))
    .png()
    .toBuffer();
}

async function composeMarketOg(ctx: MarketOgImageContext): Promise<sharp.Sharp> {
  const heroBuf =
    ctx.imageBuffer && ctx.imageBuffer.length > 0
      ? ctx.imageBuffer
      : await fetchImageBuffer(ctx.imageUrl);
  const heroJpeg = await coverHeroJpeg(heroBuf, ctx.title);
  const overlayPng = await buildOverlayPng(ctx);
  return sharp(heroJpeg).composite([{ input: overlayPng, left: 0, top: 0 }]);
}

async function encodeJpegUnderBudget(composite: sharp.Sharp): Promise<Buffer> {
  let quality = JPEG_QUALITY_START;
  let buf = await composite
    .clone()
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (buf.length > JPEG_MAX_BYTES && quality > JPEG_QUALITY_MIN) {
    quality -= 5;
    buf = await composite
      .clone()
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  return buf;
}

export async function renderMarketOgImage(
  ctx: MarketOgImageContext,
): Promise<Buffer> {
  const composite = await composeMarketOg(ctx);
  return composite.png().toBuffer();
}

export async function renderMarketOgImageJpeg(
  ctx: MarketOgImageContext,
): Promise<Buffer> {
  const composite = await composeMarketOg(ctx);
  return encodeJpegUnderBudget(composite);
}
