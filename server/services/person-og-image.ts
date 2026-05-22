import sharp from "sharp";
import type { PersonOgContext } from "./person-og-context";
import { textPath } from "./og-svg-text-paths";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const JPEG_MAX_BYTES = 550_000;
const JPEG_QUALITY_START = 82;
const JPEG_QUALITY_MIN = 65;

const AVATAR_SIZE = 200;
const AVATAR_X = 48;
const AVATAR_Y = 118;

const NAME_X = 280;
const NAME_BASELINE_Y = 200;
const RANK_BASELINE_Y = 248;

const WIDGET_PAD_X = 24;
const WIDGET_GAP = 12;
const WIDGET_ROW_Y = 458;
const WIDGET_ROW_H = 132;
const WIDGET_COUNT = 4;

const CHANGE_UP_COLOR = "#00C853";
const CHANGE_DOWN_COLOR = "#FF0000";
const CHANGE_NEUTRAL_COLOR = "#94a3b8";

export interface PersonOgWidgetLayout {
  widgetWidth: number;
  widgetHeight: number;
  widgetRowY: number;
  widgetPadX: number;
  widgetGap: number;
}

/** Exported for tests — bottom stat row geometry. */
export function getPersonOgWidgetLayout(): PersonOgWidgetLayout {
  const innerWidth = OG_WIDTH - WIDGET_PAD_X * 2;
  const widgetWidth = Math.floor(
    (innerWidth - WIDGET_GAP * (WIDGET_COUNT - 1)) / WIDGET_COUNT,
  );
  return {
    widgetWidth,
    widgetHeight: WIDGET_ROW_H,
    widgetRowY: WIDGET_ROW_Y,
    widgetPadX: WIDGET_PAD_X,
    widgetGap: WIDGET_GAP,
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trim()}...`;
}

function formatChangePercent(value: number | null): {
  label: string;
  fill: string;
} {
  if (value == null || Number.isNaN(value)) {
    return { label: "N/A", fill: CHANGE_NEUTRAL_COLOR };
  }
  if (value === 0) {
    return { label: "0%", fill: CHANGE_NEUTRAL_COLOR };
  }
  const sign = value > 0 ? "+" : "";
  return {
    label: `${sign}${value.toFixed(1)}%`,
    fill: value > 0 ? CHANGE_UP_COLOR : CHANGE_DOWN_COLOR,
  };
}

function rankLabel(rank: number | null): string | null {
  if (rank == null || rank <= 0) return null;
  return `Overall #${rank}`;
}

/** Exported for tests — overlay labels derived from context. */
export function getPersonOgOverlayLabels(ctx: PersonOgContext) {
  return {
    brand: "VoxDex",
    category: truncate(ctx.category || "Celebrity", 24).toUpperCase(),
    name: truncate(ctx.name, 48),
    rank: rankLabel(ctx.rank),
    change24h: formatChangePercent(ctx.change24h),
    change7d: formatChangePercent(ctx.change7d),
  };
}

function buildWidgetCell(
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  value: string,
  valueFill: string,
): string {
  const titleY = y + 36;
  const valueY = y + 88;

  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#1e293b" fill-opacity="0.65" stroke="#334155" stroke-width="1"/>
  ${textPath({
    text: title,
    x: x + w / 2,
    y: titleY,
    fontSize: 13,
    weight: 600,
    fill: "#94a3b8",
    anchor: "middle",
    letterSpacing: 0.8,
  })}
  ${textPath({
    text: value,
    x: x + w / 2,
    y: valueY,
    fontSize: 28,
    weight: 700,
    fill: valueFill,
    anchor: "middle",
  })}`;
}

/** Exported for tests — full overlay SVG (path text only). */
export function buildPersonOgOverlaySvg(ctx: PersonOgContext): string {
  const labels = getPersonOgOverlayLabels(ctx);
  const layout = getPersonOgWidgetLayout();
  const { widgetWidth, widgetHeight, widgetRowY, widgetPadX, widgetGap } =
    layout;

  const change24 = labels.change24h;
  const change7d = labels.change7d;

  const widgets: string[] = [];
  for (let i = 0; i < WIDGET_COUNT; i++) {
    const x = widgetPadX + i * (widgetWidth + widgetGap);
    if (i === 0) {
      widgets.push(
        buildWidgetCell(
          x,
          widgetRowY,
          widgetWidth,
          widgetHeight,
          "TREND SCORE",
          ctx.trendScoreDisplay,
          "#f1f5f9",
        ),
      );
    } else if (i === 1) {
      widgets.push(
        buildWidgetCell(
          x,
          widgetRowY,
          widgetWidth,
          widgetHeight,
          "24H CHANGE",
          change24.label,
          change24.fill,
        ),
      );
    } else if (i === 2) {
      widgets.push(
        buildWidgetCell(
          x,
          widgetRowY,
          widgetWidth,
          widgetHeight,
          "7D CHANGE",
          change7d.label,
          change7d.fill,
        ),
      );
    } else {
      widgets.push(
        buildWidgetCell(
          x,
          widgetRowY,
          widgetWidth,
          widgetHeight,
          "APPROVAL",
          ctx.approvalDisplay,
          "#f1f5f9",
        ),
      );
    }
  }

  const rankPath = labels.rank
    ? textPath({
        text: labels.rank,
        x: NAME_X,
        y: RANK_BASELINE_Y,
        fontSize: 18,
        weight: 600,
        fill: "#fbbf24",
      })
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="avatarFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0"/>
      <stop offset="85%" stop-color="#0f172a" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.85"/>
    </linearGradient>
  </defs>

  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f172a"/>
  <rect width="${OG_WIDTH}" height="140" fill="url(#topFade)"/>
  <rect x="${AVATAR_X + AVATAR_SIZE - 40}" y="${AVATAR_Y}" width="320" height="${AVATAR_SIZE}" fill="url(#avatarFade)"/>

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
    text: labels.name,
    x: NAME_X,
    y: NAME_BASELINE_Y,
    fontSize: 44,
    weight: 700,
    fill: "#ffffff",
  })}
  ${rankPath}
  ${widgets.join("\n  ")}
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

function buildAvatarPlaceholderSvg(name: string): string {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}">
  <defs>
    <linearGradient id="av" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#164e63"/>
    </linearGradient>
  </defs>
  <rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" rx="12" fill="url(#av)"/>
  ${textPath({
    text: initial,
    x: AVATAR_SIZE / 2,
    y: AVATAR_SIZE / 2 + 18,
    fontSize: 96,
    weight: 700,
    fill: "#ffffff",
    anchor: "middle",
    opacity: 0.35,
  })}
</svg>`;
}

async function buildAvatarPanel(ctx: PersonOgContext): Promise<Buffer> {
  const buf = await fetchImageBuffer(ctx.avatarUrl);
  if (buf) {
    try {
      return await sharp(buf)
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    } catch {
      /* placeholder */
    }
  }
  return sharp(Buffer.from(buildAvatarPlaceholderSvg(ctx.name), "utf8"))
    .png()
    .toBuffer();
}

async function buildOverlayPng(ctx: PersonOgContext): Promise<Buffer> {
  return sharp(Buffer.from(buildPersonOgOverlaySvg(ctx), "utf8"))
    .png()
    .toBuffer();
}

async function compositePersonBase(ctx: PersonOgContext): Promise<sharp.Sharp> {
  const [avatar, overlay] = await Promise.all([
    buildAvatarPanel(ctx),
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
    { input: avatar, left: AVATAR_X, top: AVATAR_Y },
    { input: overlay, left: 0, top: 0 },
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

export async function renderPersonOgImage(ctx: PersonOgContext): Promise<Buffer> {
  const composite = await compositePersonBase(ctx);
  return composite.png().toBuffer();
}

export async function renderPersonOgImageJpeg(
  ctx: PersonOgContext,
): Promise<Buffer> {
  const composite = await compositePersonBase(ctx);
  return encodeJpegUnderBudget(composite);
}
