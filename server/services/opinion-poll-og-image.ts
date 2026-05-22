import sharp from "sharp";
import type {
  OpinionPollOgContext,
  OpinionPollOgOption,
} from "./opinion-poll-og-context";
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

const RIGHT_PAD_X = 16;
const ROW_GAP = 6;
const OPTIONS_START_Y = 100;
const ROW_HEIGHT = 52;
const THUMB_SIZE = 52;
const ROW_WIDTH = HALF_WIDTH - RIGHT_PAD_X * 2;
const CONTENT_PAD_LEFT = 10;
const CONTENT_PAD_RIGHT = 8;
const BAR_HEIGHT = 6;
const BAR_Y_OFFSET = 30;
const NAME_FONT_SIZE = 14;
const PERCENT_FONT_SIZE = 12;
const VOTES_FONT_SIZE = 10;
const OPTION_NAME_MAX_LEN = 28;

export interface OpinionPollRowLayout {
  rowWidth: number;
  rowHeight: number;
  thumbSize: number;
  contentLeft: number;
  contentWidth: number;
  barTrackWidth: number;
}

/** Exported for tests — drawer row geometry on the right panel. */
export function getOpinionPollRowLayout(): OpinionPollRowLayout {
  const contentLeft = THUMB_SIZE + CONTENT_PAD_LEFT;
  const contentWidth = ROW_WIDTH - contentLeft - CONTENT_PAD_RIGHT;
  return {
    rowWidth: ROW_WIDTH,
    rowHeight: ROW_HEIGHT,
    thumbSize: THUMB_SIZE,
    contentLeft,
    contentWidth,
    barTrackWidth: contentWidth,
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trim()}...`;
}

function formatVoteCount(votes: number): string {
  return `${votes.toLocaleString("en-US")} votes`;
}

/** Exported for tests — labels on chrome overlay and overflow footer. */
export function getOpinionPollOverlayLabels(ctx: OpinionPollOgContext) {
  return {
    brand: "VoxDex",
    category: truncate(ctx.category || "Poll", 24).toUpperCase(),
    title: truncate(ctx.title, 56),
    overflow:
      ctx.overflowCount > 0
        ? `+${ctx.overflowCount} more options`
        : null,
  };
}

function maxPercent(ctx: OpinionPollOgContext): number {
  return Math.max(...ctx.displayOptions.map((o) => o.percent), 0);
}

/** Exported for tests — single drawer row overlay (path text + bar rects). */
export function buildOptionRowOverlaySvg(
  opt: OpinionPollOgOption,
  layout: OpinionPollRowLayout,
  isLeading: boolean,
): string {
  const { rowWidth, rowHeight, contentLeft, contentWidth, barTrackWidth } =
    layout;
  const name = truncate(opt.name, OPTION_NAME_MAX_LEN);
  const percentLabel = `${opt.percent}%`;
  const percentFill = isLeading ? "#22d3ee" : "#94a3b8";
  const barFillW = Math.max(
    0,
    Math.round((barTrackWidth * opt.percent) / 100),
  );
  const barY = BAR_Y_OFFSET;
  const barX = contentLeft;
  const votesY = barY + BAR_HEIGHT + 14;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${rowWidth}" height="${rowHeight}" viewBox="0 0 ${rowWidth} ${rowHeight}">
  <rect x="0.5" y="0.5" width="${rowWidth - 1}" height="${rowHeight - 1}" rx="8" fill="#1e293b" fill-opacity="0.55" stroke="#334155" stroke-width="1"/>
  ${textPath({
    text: name,
    x: contentLeft,
    y: 18,
    fontSize: NAME_FONT_SIZE,
    weight: 600,
    fill: "#f1f5f9",
  })}
  ${textPath({
    text: percentLabel,
    x: rowWidth - CONTENT_PAD_RIGHT,
    y: 18,
    fontSize: PERCENT_FONT_SIZE,
    weight: 700,
    fill: percentFill,
    anchor: "end",
  })}
  <rect x="${barX}" y="${barY}" width="${barTrackWidth}" height="${BAR_HEIGHT}" rx="3" fill="#334155" fill-opacity="0.8"/>
  <rect x="${barX}" y="${barY}" width="${barFillW}" height="${BAR_HEIGHT}" rx="3" fill="#06b6d4"/>
  ${textPath({
    text: formatVoteCount(opt.votes),
    x: contentLeft,
    y: votesY,
    fontSize: VOTES_FONT_SIZE,
    weight: 400,
    fill: "#94a3b8",
  })}
</svg>`;
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

function buildThumbFallbackSvg(orderLabel: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_SIZE}" height="${THUMB_SIZE}">
  <rect width="${THUMB_SIZE}" height="${THUMB_SIZE}" fill="#06b6d4" fill-opacity="0.12"/>
  ${textPath({
    text: String(orderLabel),
    x: THUMB_SIZE / 2,
    y: THUMB_SIZE / 2 + 5,
    fontSize: 14,
    weight: 600,
    fill: "#22d3ee",
    anchor: "middle",
  })}
</svg>`;
}

async function buildThumbColumn(
  opt: OpinionPollOgOption,
): Promise<Buffer> {
  const buf = await fetchImageBuffer(opt.imageUrl);
  if (buf) {
    try {
      return await sharp(buf)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    } catch {
      /* fallback */
    }
  }
  return sharp(
    Buffer.from(buildThumbFallbackSvg(opt.orderIndex + 1), "utf8"),
  )
    .png()
    .toBuffer();
}

async function buildOptionRowComposite(
  opt: OpinionPollOgOption,
  isLeading: boolean,
): Promise<Buffer> {
  const layout = getOpinionPollRowLayout();
  const [thumb, overlay] = await Promise.all([
    buildThumbColumn(opt),
    sharp(Buffer.from(buildOptionRowOverlaySvg(opt, layout, isLeading), "utf8"))
      .png()
      .toBuffer(),
  ]);

  return sharp({
    create: {
      width: layout.rowWidth,
      height: layout.rowHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: thumb, left: 0, top: 0 },
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

function buildRightPanelOverflowSvg(ctx: OpinionPollOgContext): string {
  const labels = getOpinionPollOverlayLabels(ctx);
  if (!labels.overflow) return "";

  const rowCount = ctx.displayOptions.length;
  const footerY =
    OPTIONS_START_Y + rowCount * (ROW_HEIGHT + ROW_GAP) + 12;
  const centerX = HALF_WIDTH / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${HALF_WIDTH}" height="${OG_HEIGHT}">
  ${textPath({
    text: labels.overflow,
    x: centerX,
    y: footerY + 16,
    fontSize: 14,
    weight: 600,
    fill: "#22d3ee",
    anchor: "middle",
  })}
</svg>`;
}

async function buildRightPanel(ctx: OpinionPollOgContext): Promise<Buffer> {
  const layout = getOpinionPollRowLayout();
  const leadingPercent = maxPercent(ctx);
  const rowComposites = await Promise.all(
    ctx.displayOptions.map((opt) =>
      buildOptionRowComposite(
        opt,
        opt.percent === leadingPercent && leadingPercent > 0,
      ),
    ),
  );

  const composites: sharp.OverlayOptions[] = rowComposites.map((row, i) => ({
    input: row,
    left: RIGHT_PAD_X,
    top: OPTIONS_START_Y + i * (ROW_HEIGHT + ROW_GAP),
  }));

  const overflowSvg = buildRightPanelOverflowSvg(ctx);
  if (overflowSvg) {
    composites.push({
      input: await sharp(Buffer.from(overflowSvg, "utf8")).png().toBuffer(),
      left: 0,
      top: 0,
    });
  }

  return sharp({
    create: {
      width: HALF_WIDTH,
      height: OG_HEIGHT,
      channels: 3,
      background: { r: 15, g: 23, b: 42 },
    },
  })
    .composite(composites)
    .jpeg({ quality: PANEL_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
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

/** Exported for tests — chrome-only overlay (brand, category, title). */
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
    buildRightPanel(ctx),
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
