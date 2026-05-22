import sharp from "sharp";
import type { OpinionPollOgContext } from "./opinion-poll-og-context";
import { textPath } from "./og-svg-text-paths";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const HALF_WIDTH = OG_WIDTH / 2;

const JPEG_MAX_BYTES = 550_000;
const JPEG_QUALITY_START = 82;
const JPEG_QUALITY_MIN = 65;
const PANEL_JPEG_QUALITY = 85;

const TITLE_FONT_SIZE = 36;
const TITLE_WEIGHT = 700;
const TITLE_BASELINE_Y = 520;

const OPTION_ROW_HEIGHT = 40;
const OPTIONS_START_Y = 130;
const OPTION_NAME_MAX_LEN = 32;
const OPTION_NAME_FONT_SIZE = 20;
const OPTION_NAME_WEIGHT = 600;
const BADGE_FONT_SIZE = 18;
const BADGE_WEIGHT = 700;
const BADGE_SIZE = 28;
const RIGHT_NAME_X = HALF_WIDTH + 72;
const RIGHT_BADGE_X = HALF_WIDTH + 40;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trim()}...`;
}

/** Exported for tests — labels rendered on the opinion poll overlay. */
export function getOpinionPollOverlayLabels(ctx: OpinionPollOgContext) {
  return {
    brand: "VoxDex",
    category: truncate(ctx.category || "Poll", 24).toUpperCase(),
    title: truncate(ctx.title, 56),
    overflow:
      ctx.overflowCount > 0 ? `+${ctx.overflowCount} more` : null,
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
      /* placeholder */
    }
  }
  const svg = buildPlaceholderPanelSvg(label, width, height, accent);
  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}

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
      /* placeholder */
    }
  }
  return coverPanelPng(imageBuf, label, width, height, accent);
}

function buildOptionRowsSvg(ctx: OpinionPollOgContext): string {
  const labels = getOpinionPollOverlayLabels(ctx);
  const parts: string[] = [];

  for (let i = 0; i < ctx.displayOptions.length; i++) {
    const opt = ctx.displayOptions[i]!;
    const rowY = OPTIONS_START_Y + i * OPTION_ROW_HEIGHT;
    const badgeCenterY = rowY + OPTION_ROW_HEIGHT / 2;
    const badgeX = RIGHT_BADGE_X - BADGE_SIZE / 2;
    const badgeY = badgeCenterY - BADGE_SIZE / 2;
    const number = String(opt.orderIndex + 1);

    parts.push(
      `<rect x="${badgeX}" y="${badgeY}" width="${BADGE_SIZE}" height="${BADGE_SIZE}" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-opacity="0.5" stroke-width="1"/>`,
      textPath({
        text: number,
        x: RIGHT_BADGE_X,
        y: badgeCenterY + 6,
        fontSize: BADGE_FONT_SIZE,
        weight: BADGE_WEIGHT,
        fill: "#7dd3fc",
        anchor: "middle",
      }),
      textPath({
        text: truncate(opt.name, OPTION_NAME_MAX_LEN),
        x: RIGHT_NAME_X,
        y: badgeCenterY + 6,
        fontSize: OPTION_NAME_FONT_SIZE,
        weight: OPTION_NAME_WEIGHT,
        fill: "#f1f5f9",
      }),
    );
  }

  if (labels.overflow) {
    const overflowY =
      OPTIONS_START_Y + ctx.displayOptions.length * OPTION_ROW_HEIGHT + 8;
    parts.push(
      textPath({
        text: labels.overflow,
        x: RIGHT_NAME_X,
        y: overflowY + 20,
        fontSize: 18,
        weight: 600,
        fill: "#94a3b8",
      }),
    );
  }

  return parts.join("\n  ");
}

/** Exported for tests — overlay SVG with path-outlined text (no librsvg fonts). */
export function buildOpinionPollOverlaySvg(ctx: OpinionPollOgContext): string {
  const labels = getOpinionPollOverlayLabels(ctx);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="leftBottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0"/>
      <stop offset="50%" stop-color="#0f172a" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
    </linearGradient>
  </defs>

  <rect width="${OG_WIDTH}" height="140" fill="url(#topFade)"/>
  <rect y="280" width="${HALF_WIDTH}" height="350" fill="url(#leftBottomFade)"/>
  <line x1="${HALF_WIDTH}" y1="0" x2="${HALF_WIDTH}" y2="${OG_HEIGHT}" stroke="#334155" stroke-opacity="0.35" stroke-width="1"/>

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
  ${textPath({
    text: labels.title,
    x: 48,
    y: TITLE_BASELINE_Y,
    fontSize: TITLE_FONT_SIZE,
    weight: TITLE_WEIGHT,
    fill: "#ffffff",
  })}
  ${buildOptionRowsSvg(ctx)}
</svg>`;
}

async function buildOverlayPng(ctx: OpinionPollOgContext): Promise<Buffer> {
  return sharp(Buffer.from(buildOpinionPollOverlaySvg(ctx), "utf8"))
    .png()
    .toBuffer();
}

async function compositeOpinionPollBase(
  ctx: OpinionPollOgContext,
  panelMode: "png" | "jpeg",
): Promise<sharp.Sharp> {
  const heroBuf = await fetchImageBuffer(ctx.imageUrl);
  const cover = panelMode === "jpeg" ? coverPanelJpeg : coverPanelPng;

  const [leftPanel, rightPanel, overlayPng] = await Promise.all([
    cover(heroBuf, ctx.title, HALF_WIDTH, OG_HEIGHT, "#164e63"),
    sharp({
      create: {
        width: HALF_WIDTH,
        height: OG_HEIGHT,
        channels: 3,
        background: { r: 15, g: 23, b: 42 },
      },
    })
      .jpeg({ quality: PANEL_JPEG_QUALITY, mozjpeg: true })
      .toBuffer(),
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
    { input: leftPanel, left: 0, top: 0 },
    { input: rightPanel, left: HALF_WIDTH, top: 0 },
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

export async function renderOpinionPollOgImage(
  ctx: OpinionPollOgContext,
): Promise<Buffer> {
  const composite = await compositeOpinionPollBase(ctx, "png");
  return composite.png().toBuffer();
}

export async function renderOpinionPollOgImageJpeg(
  ctx: OpinionPollOgContext,
): Promise<Buffer> {
  const composite = await compositeOpinionPollBase(ctx, "jpeg");
  return encodeJpegUnderBudget(composite);
}
