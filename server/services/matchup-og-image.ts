import sharp from "sharp";
import type { MatchupOgContext } from "./matchup-og-context";
import {
  matchupOgDescription,
  matchupOgPromptTitle,
} from "./matchup-og-meta";
import { textPath } from "./og-svg-text-paths";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const HALF_WIDTH = OG_WIDTH / 2;

/** Target max bytes for social crawlers (WhatsApp, Facebook). */
const JPEG_MAX_BYTES = 550_000;
const JPEG_QUALITY_START = 82;
const JPEG_QUALITY_MIN = 65;
const PANEL_JPEG_QUALITY = 85;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trim()}...`;
}

/** Exported for tests — labels rendered on the matchup overlay. */
export function getMatchupOverlayLabels(ctx: MatchupOgContext) {
  return {
    brand: "VoxDex",
    category: truncate(ctx.category || "Matchup", 24).toUpperCase(),
    vs: "VS",
    prompt: truncate(matchupOgPromptTitle(ctx), 72),
    vsLine: truncate(matchupOgDescription(ctx), 80),
    cta: "Vote on VoxDex",
  };
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

function buildPlaceholderPanelSvg(
  label: string,
  width: number,
  height: number,
  accent: string,
): string {
  const initial = (label.trim().charAt(0) || "?").toUpperCase();
  const safeLabel = truncate(label, 28);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="ph" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="${accent}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#ph)"/>
  ${textPath({
    text: initial,
    x: width / 2,
    y: height / 2 + 30,
    fontSize: 120,
    weight: 700,
    fill: "#ffffff",
    anchor: "middle",
    opacity: 0.35,
  })}
  ${textPath({
    text: safeLabel,
    x: width / 2,
    y: height / 2 + 80,
    fontSize: 28,
    weight: 600,
    fill: "#e2e8f0",
    anchor: "middle",
  })}
</svg>`;
}

async function coverPanelPng(
  imageBuf: Buffer | null,
  label: string,
  width: number,
  height: number,
  accent: string,
): Promise<Buffer> {
  if (imageBuf) {
    try {
      return await sharp(imageBuf)
        .resize(width, height, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    } catch {
      /* fall through to placeholder */
    }
  }

  const svg = buildPlaceholderPanelSvg(label, width, height, accent);
  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}

/** Photo panel encoded as JPEG to keep compositing lean for social output. */
async function coverPanelJpeg(
  imageBuf: Buffer | null,
  label: string,
  width: number,
  height: number,
  accent: string,
): Promise<Buffer> {
  if (imageBuf) {
    try {
      return await sharp(imageBuf)
        .resize(width, height, { fit: "cover", position: "centre" })
        .jpeg({ quality: PANEL_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch {
      /* fall through to placeholder */
    }
  }
  return coverPanelPng(imageBuf, label, width, height, accent);
}

/** Exported for tests — overlay SVG with path-outlined text (no librsvg fonts). */
export function buildMatchupOverlaySvg(ctx: MatchupOgContext): string {
  const labels = getMatchupOverlayLabels(ctx);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0"/>
      <stop offset="55%" stop-color="#0f172a" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
    </linearGradient>
  </defs>

  <rect width="${OG_WIDTH}" height="140" fill="url(#topFade)"/>
  <rect y="330" width="${OG_WIDTH}" height="300" fill="url(#bottomFade)"/>

  ${textPath({
    text: labels.brand,
    x: 48,
    y: 58,
    fontSize: 34,
    weight: 700,
    fill: "#ffffff",
  })}
  <rect x="920" y="32" width="232" height="40" rx="20" fill="#1e293b" fill-opacity="0.85" stroke="#38bdf8" stroke-opacity="0.45"/>
  ${textPath({
    text: labels.category,
    x: 1036,
    y: 60,
    fontSize: 18,
    weight: 600,
    fill: "#7dd3fc",
    anchor: "middle",
    letterSpacing: 1,
  })}

  <circle cx="${HALF_WIDTH}" cy="315" r="52" fill="#0f172a" fill-opacity="0.92" stroke="#38bdf8" stroke-width="4"/>
  ${textPath({
    text: labels.vs,
    x: HALF_WIDTH,
    y: 328,
    fontSize: 32,
    weight: 700,
    fill: "#ffffff",
    anchor: "middle",
    letterSpacing: 2,
  })}

  ${textPath({
    text: labels.prompt,
    x: 48,
    y: 520,
    fontSize: 46,
    weight: 700,
    fill: "#ffffff",
  })}
  ${textPath({
    text: labels.vsLine,
    x: 48,
    y: 568,
    fontSize: 26,
    weight: 500,
    fill: "#cbd5e1",
  })}
  ${textPath({
    text: labels.cta,
    x: 48,
    y: 608,
    fontSize: 22,
    weight: 600,
    fill: "#22d3ee",
  })}
</svg>`;
}

async function buildOverlayPng(ctx: MatchupOgContext): Promise<Buffer> {
  return sharp(Buffer.from(buildMatchupOverlaySvg(ctx), "utf8")).png().toBuffer();
}

async function compositeMatchupBase(
  ctx: MatchupOgContext,
  panelMode: "png" | "jpeg",
): Promise<sharp.Sharp> {
  const [bufA, bufB] = await Promise.all([
    fetchImageBuffer(ctx.optionAImageUrl),
    fetchImageBuffer(ctx.optionBImageUrl),
  ]);

  const cover =
    panelMode === "jpeg" ? coverPanelJpeg : coverPanelPng;

  const [panelA, panelB, overlayPng] = await Promise.all([
    cover(bufA, ctx.optionAText, HALF_WIDTH, OG_HEIGHT, "#1e3a5f"),
    cover(bufB, ctx.optionBText, HALF_WIDTH, OG_HEIGHT, "#312e81"),
    buildOverlayPng(ctx),
  ]);

  return sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  }).composite([
    { input: panelA, left: 0, top: 0 },
    { input: panelB, left: HALF_WIDTH, top: 0 },
    { input: overlayPng, left: 0, top: 0 },
  ]);
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

/**
 * Render a 1200×630 PNG for a matchup share preview (legacy / debugging).
 */
export async function renderMatchupOgImage(
  ctx: MatchupOgContext,
): Promise<Buffer> {
  const composite = await compositeMatchupBase(ctx, "png");
  return composite.png().toBuffer();
}

/**
 * Render a 1200×630 JPEG optimised for WhatsApp / Facebook / X large cards.
 */
export async function renderMatchupOgImageJpeg(
  ctx: MatchupOgContext,
): Promise<Buffer> {
  const composite = await compositeMatchupBase(ctx, "jpeg");
  return encodeJpegUnderBudget(composite);
}
