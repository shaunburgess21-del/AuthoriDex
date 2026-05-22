import sharp from "sharp";
import type { PersonOgContext } from "./person-og-context";
import { measureOutlinedTextWidth, textPath } from "./og-svg-text-paths";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const JPEG_MAX_BYTES = 550_000;
const JPEG_QUALITY_START = 82;
const JPEG_QUALITY_MIN = 65;

const WIDGET_PAD_X = 24;
const WIDGET_GAP = 12;
const WIDGET_ROW_Y = 458;
const WIDGET_ROW_H = 132;

const CONTENT_TOP = 100;
const HERO_GAP_ABOVE_WIDGETS = 8;
const HERO_X = 360;
const HERO_W = OG_WIDTH - HERO_X - 24;
const HERO_H = WIDGET_ROW_Y - HERO_GAP_ABOVE_WIDGETS - CONTENT_TOP;

const NAME_X = 48;
const NAME_BASELINE_Y = 188;
/** Exported for tests — celebrity name size on OG card. */
export const PERSON_OG_NAME_FONT_SIZE = 56;

const RANK_PILL_X = 48;
const RANK_PILL_Y = 228;
const RANK_PILL_HEIGHT = 44;
const RANK_PILL_FONT_SIZE = 21;
const RANK_ICON_SIZE = 22;
const WIDGET_COUNT = 4;

const CHANGE_UP_COLOR = "#00C853";
const CHANGE_DOWN_COLOR = "#FF0000";
const CHANGE_NEUTRAL_COLOR = "#94a3b8";

const AMBER_FILL = "#f59e0b";
const AMBER_TEXT = "#fbbf24";

/** Lucide Trophy (24×24) — stroke paths for OG pill icon. */
const TROPHY_PATHS = [
  "M6 9H4.5a2.5 2.5 0 0 1 0-5H6",
  "M18 9h1.5a2.5 2.5 0 0 0 0-5H18",
  "M4 22h16",
  "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",
  "M14 14.66V17c0 .55.47.98.97 1.21 2.18 1.58 3 3.09 3 5",
  "M18 2H6v7a6 6 0 0 0 12 0V2Z",
];

export interface PersonOgWidgetLayout {
  widgetWidth: number;
  widgetHeight: number;
  widgetRowY: number;
  widgetPadX: number;
  widgetGap: number;
}

export interface PersonOgHeroLayout {
  heroX: number;
  heroY: number;
  heroWidth: number;
  heroHeight: number;
  contentTop: number;
}

/** Exported for tests — hero photo region geometry. */
export function getPersonOgHeroLayout(): PersonOgHeroLayout {
  return {
    heroX: HERO_X,
    heroY: CONTENT_TOP,
    heroWidth: HERO_W,
    heroHeight: HERO_H,
    contentTop: CONTENT_TOP,
  };
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

/** Exported for tests — overlay must not paint an opaque full-canvas background. */
export function overlayHasFullCanvasOpaqueFill(svg: string): boolean {
  return /<rect[^>]*width="1200"[^>]*height="630"[^>]*fill="#0f172a"/.test(
    svg,
  );
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

function rankLabel(rank: number | null): string {
  if (rank == null || rank <= 0) return "New";
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

function buildTrophyIconSvg(iconX: number, iconY: number): string {
  const scale = RANK_ICON_SIZE / 24;
  const paths = TROPHY_PATHS.map(
    (d) =>
      `<path d="${d}" fill="none" stroke="${AMBER_TEXT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  ).join("\n    ");
  return `<g transform="translate(${iconX}, ${iconY}) scale(${scale})">
    ${paths}
  </g>`;
}

/** Exported for tests — amber rank pill matching PersonDetailPage header. */
export function buildOverallRankPillSvg(
  x: number,
  y: number,
  rankText: string,
): string {
  const padX = 14;
  const iconGap = 10;
  const textWidth = measureOutlinedTextWidth(
    rankText,
    RANK_PILL_FONT_SIZE,
    600,
  );
  const pillWidth =
    padX * 2 + RANK_ICON_SIZE + iconGap + Math.ceil(textWidth);
  const iconX = x + padX;
  const iconY = y + (RANK_PILL_HEIGHT - RANK_ICON_SIZE) / 2;
  const textX = iconX + RANK_ICON_SIZE + iconGap;
  const textBaselineY = y + RANK_PILL_HEIGHT / 2 + 8;

  return `<g>
  <rect x="${x}" y="${y}" width="${pillWidth}" height="${RANK_PILL_HEIGHT}" rx="8" fill="${AMBER_FILL}" fill-opacity="0.15" stroke="${AMBER_FILL}" stroke-opacity="0.3" stroke-width="1"/>
  ${buildTrophyIconSvg(iconX, iconY)}
  ${textPath({
    text: rankText,
    x: textX,
    y: textBaselineY,
    fontSize: RANK_PILL_FONT_SIZE,
    weight: 600,
    fill: AMBER_TEXT,
  })}
</g>`;
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

  const rankPill = buildOverallRankPillSvg(
    RANK_PILL_X,
    RANK_PILL_Y,
    labels.rank,
  );

  const heroFadeWidth = 200;
  const heroFadeHeight = HERO_H;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="heroLeftFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.85"/>
      <stop offset="55%" stop-color="#0f172a" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${OG_WIDTH}" height="140" fill="url(#topFade)"/>
  <rect x="${HERO_X}" y="${CONTENT_TOP}" width="${heroFadeWidth}" height="${heroFadeHeight}" fill="url(#heroLeftFade)"/>

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
    fontSize: PERSON_OG_NAME_FONT_SIZE,
    weight: 700,
    fill: "#ffffff",
  })}
  ${rankPill}
  ${widgets.join("\n  ")}
</svg>`;
}

/** Person OG must never fall back to the generic site marketing image. */
export function personOgUsesSiteDefaultFallback(): boolean {
  return false;
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

async function fetchFirstHeroImageBuffer(
  urls: string[],
): Promise<{ buffer: Buffer | null; tried: number }> {
  for (let i = 0; i < urls.length; i++) {
    const buf = await fetchImageBuffer(urls[i]!);
    if (buf) return { buffer: buf, tried: i + 1 };
  }
  return { buffer: null, tried: urls.length };
}

function buildHeroPlaceholderSvg(name: string): string {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const fontSize = Math.round(HERO_H * 0.28);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${HERO_W}" height="${HERO_H}">
  <defs>
    <linearGradient id="heroPh" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#164e63"/>
    </linearGradient>
  </defs>
  <rect width="${HERO_W}" height="${HERO_H}" fill="url(#heroPh)"/>
  ${textPath({
    text: initial,
    x: HERO_W / 2,
    y: HERO_H / 2 + fontSize * 0.2,
    fontSize,
    weight: 700,
    fill: "#ffffff",
    anchor: "middle",
    opacity: 0.35,
  })}
</svg>`;
}

async function buildHeroPhotoPanel(ctx: PersonOgContext): Promise<Buffer> {
  const candidates =
    ctx.avatarCandidates.length > 0
      ? ctx.avatarCandidates
      : ctx.avatarUrl
        ? [ctx.avatarUrl]
        : [];
  const { buffer: buf, tried } = await fetchFirstHeroImageBuffer(candidates);
  if (buf) {
    try {
      return await sharp(buf)
        .resize(HERO_W, HERO_H, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    } catch {
      console.warn(
        `[OG] Person hero sharp resize failed id=${ctx.id} slug=${ctx.imageSlug ?? "none"} tried=${tried}`,
      );
    }
  } else if (candidates.length > 0) {
    console.warn(
      `[OG] Person hero fetch failed id=${ctx.id} slug=${ctx.imageSlug ?? "none"} candidates=${candidates.length}`,
    );
  }
  return sharp(Buffer.from(buildHeroPlaceholderSvg(ctx.name), "utf8"))
    .png()
    .toBuffer();
}

function buildPersonOgUnavailableSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f172a"/>
  ${textPath({
    text: "VoxDex",
    x: 48,
    y: 58,
    fontSize: 34,
    weight: 700,
    fill: "#ffffff",
  })}
  ${textPath({
    text: "Preview unavailable",
    x: OG_WIDTH / 2,
    y: OG_HEIGHT / 2,
    fontSize: 36,
    weight: 600,
    fill: "#94a3b8",
    anchor: "middle",
  })}
</svg>`;
}

/** Minimal slate OG when person JPEG render fails — not the site default marketing PNG. */
export async function renderPersonOgUnavailableJpeg(): Promise<Buffer> {
  const composite = await sharp(
    Buffer.from(buildPersonOgUnavailableSvg(), "utf8"),
  )
    .png()
    .toBuffer();
  return sharp(composite)
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

async function buildOverlayPng(ctx: PersonOgContext): Promise<Buffer> {
  return sharp(Buffer.from(buildPersonOgOverlaySvg(ctx), "utf8"))
    .png()
    .toBuffer();
}

async function compositePersonBase(ctx: PersonOgContext): Promise<sharp.Sharp> {
  const [hero, overlay] = await Promise.all([
    buildHeroPhotoPanel(ctx),
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
    { input: hero, left: HERO_X, top: CONTENT_TOP },
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
