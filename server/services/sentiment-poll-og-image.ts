import sharp from "sharp";
import type { SentimentPollOgContext } from "./sentiment-poll-og-context";
import { glyphExtentBelowBaseline, textPath } from "./og-svg-text-paths";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const JPEG_MAX_BYTES = 550_000;
const JPEG_QUALITY_START = 82;
const JPEG_QUALITY_MIN = 65;
const HERO_JPEG_QUALITY = 85;

const HEADLINE_FONT_SIZE = 40;
const HEADLINE_WEIGHT = 700;
const HEADLINE_BASELINE_Y = 500;
const HEADLINE_TO_PILL_GAP = 10;

const VOTE_PILL_BOTTOM_Y = OG_HEIGHT - 12;
const HEADLINE_BOTTOM_Y =
  HEADLINE_BASELINE_Y +
  glyphExtentBelowBaseline(HEADLINE_FONT_SIZE, HEADLINE_WEIGHT);
const VOTE_PILL_Y = HEADLINE_BOTTOM_Y + HEADLINE_TO_PILL_GAP;
const VOTE_PILL_H = Math.max(
  44,
  Math.min(120, VOTE_PILL_BOTTOM_Y - VOTE_PILL_Y),
);

const VOTE_PILL_GAP = 16;
const VOTE_PILL_MARGIN_X = 48;
const VOTE_LABEL_FONT_SIZE = 28;
const VOTE_LABEL_WEIGHT = 600;

/** Exported for tests — vote pill row geometry. */
export function getSentimentPollVotePillLayout() {
  return { VOTE_PILL_Y, VOTE_PILL_H, VOTE_PILL_BOTTOM_Y, HEADLINE_BOTTOM_Y };
}

const VOTE_CHOICES = [
  {
    label: "Support",
    fill: "#00C853",
    fillOpacity: 0.12,
    strokeOpacity: 0.55,
    textFill: "#00C853",
  },
  {
    label: "Neutral",
    fill: "#ffffff",
    fillOpacity: 0.08,
    strokeOpacity: 0.4,
    textFill: "#ffffff",
  },
  {
    label: "Oppose",
    fill: "#FF0000",
    fillOpacity: 0.12,
    strokeOpacity: 0.55,
    textFill: "#FF0000",
  },
] as const;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trim()}...`;
}

export function getSentimentPollOverlayLabels(ctx: SentimentPollOgContext) {
  return {
    brand: "VoxDex",
    category: truncate(ctx.category || "Poll", 24).toUpperCase(),
    headline: truncate(ctx.headline, 72),
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

function buildPlaceholderHeroSvg(
  label: string,
  width: number,
  height: number,
): string {
  const initial = (label.trim().charAt(0) || "?").toUpperCase();
  const safeLabel = truncate(label, 36);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="ph" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#164e63"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#ph)"/>
  ${textPath({
    text: initial,
    x: width / 2,
    y: height / 2,
    fontSize: 140,
    weight: 700,
    fill: "#ffffff",
    anchor: "middle",
    opacity: 0.25,
  })}
  ${textPath({
    text: safeLabel,
    x: width / 2,
    y: height / 2 + 90,
    fontSize: 32,
    weight: 600,
    fill: "#e2e8f0",
    anchor: "middle",
  })}
</svg>`;
}

async function coverHeroJpeg(
  imageBuf: Buffer | null,
  label: string,
): Promise<Buffer> {
  if (imageBuf) {
    try {
      return await sharp(imageBuf)
        .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
        .jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch {
      /* placeholder */
    }
  }
  const svg = buildPlaceholderHeroSvg(label, OG_WIDTH, OG_HEIGHT);
  return sharp(Buffer.from(svg, "utf8"))
    .jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

function horizontalVotePills(): string {
  const rowWidth = OG_WIDTH - VOTE_PILL_MARGIN_X * 2;
  const pillW = (rowWidth - VOTE_PILL_GAP * 2) / 3;
  const pillY = Math.round(VOTE_PILL_Y);
  const pillH = Math.round(VOTE_PILL_H);
  const parts: string[] = [];

  for (let i = 0; i < VOTE_CHOICES.length; i++) {
    const choice = VOTE_CHOICES[i]!;
    const pillX = VOTE_PILL_MARGIN_X + i * (pillW + VOTE_PILL_GAP);
    const centerX = pillX + pillW / 2;
    const textY = pillY + pillH / 2 + 7;

    parts.push(
      `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="10" fill="${choice.fill}" fill-opacity="${choice.fillOpacity}" stroke="${choice.fill}" stroke-opacity="${choice.strokeOpacity}" stroke-width="1.5"/>`,
      textPath({
        text: choice.label,
        x: centerX,
        y: textY,
        fontSize: VOTE_LABEL_FONT_SIZE,
        weight: VOTE_LABEL_WEIGHT,
        fill: choice.textFill,
        anchor: "middle",
      }),
    );
  }

  return parts.join("\n  ");
}

export function buildSentimentPollOverlaySvg(ctx: SentimentPollOgContext): string {
  const labels = getSentimentPollOverlayLabels(ctx);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
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

  <rect width="${OG_WIDTH}" height="140" fill="url(#topFade)"/>
  <rect y="280" width="${OG_WIDTH}" height="350" fill="url(#bottomFade)"/>

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
    text: labels.headline,
    x: 48,
    y: HEADLINE_BASELINE_Y,
    fontSize: HEADLINE_FONT_SIZE,
    weight: HEADLINE_WEIGHT,
    fill: "#ffffff",
  })}
  ${horizontalVotePills()}
</svg>`;
}

async function buildOverlayPng(ctx: SentimentPollOgContext): Promise<Buffer> {
  return sharp(Buffer.from(buildSentimentPollOverlaySvg(ctx), "utf8"))
    .png()
    .toBuffer();
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

export async function renderSentimentPollOgImage(
  ctx: SentimentPollOgContext,
): Promise<Buffer> {
  const heroBuf = await fetchImageBuffer(ctx.imageUrl);
  const heroJpeg = await coverHeroJpeg(heroBuf, ctx.headline);
  const overlayPng = await buildOverlayPng(ctx);

  const composite = sharp(heroJpeg).composite([
    { input: overlayPng, left: 0, top: 0 },
  ]);

  return composite.png().toBuffer();
}

export async function renderSentimentPollOgImageJpeg(
  ctx: SentimentPollOgContext,
): Promise<Buffer> {
  const heroBuf = await fetchImageBuffer(ctx.imageUrl);
  const heroJpeg = await coverHeroJpeg(heroBuf, ctx.headline);
  const overlayPng = await buildOverlayPng(ctx);

  const composite = sharp(heroJpeg).composite([
    { input: overlayPng, left: 0, top: 0 },
  ]);

  return encodeJpegUnderBudget(composite);
}
