import sharp from "sharp";
import {
  resolveCommunityMarketOg,
  resolveNativePredictOg,
  type OgPreviewResult,
} from "./og-page-payload";
import { getTopPredictorsForPeriod } from "./leaderboard-users-top";
import { getOgFontFaceStyle, OG_FONT_FAMILY } from "./og-fonts";

export type SocialTemplateId = "new_market" | "top_predictors_week";

export type SocialTemplateAspect = "square" | "landscape";

const SQUARE = { width: 1080, height: 1080 };
const LANDSCAPE = { width: 1200, height: 630 };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > maxChars && current.length > 0) {
      lines.push(current.trim());
      current = w;
      if (lines.length >= maxLines) break;
    } else {
      current = current ? `${current} ${w}` : w;
    }
  }
  if (current && lines.length < maxLines) lines.push(current.trim());
  if (lines.length > maxLines) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, maxChars - 1).trim()}…`;
  }
  return lines.slice(0, maxLines);
}

function brandChromeDefs(): string {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e1b4b" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa" />
      <stop offset="100%" stop-color="#22d3ee" />
    </linearGradient>
  </defs>`;
}

function buildSocialSvg(
  width: number,
  height: number,
  badge: string,
  titleLines: string[],
  subtitle: string,
  footerLines: string[] = [],
): string {
  const titleSize = width >= 1000 && height >= 1000 ? 72 : 56;
  const titleY = height >= 1000 ? 380 : 280;
  const lineGap = width >= 1000 && height >= 1000 ? 88 : 64;
  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="80" y="${titleY + i * lineGap}" fill="#ffffff" font-size="${titleSize}" font-weight="700" font-family="${OG_FONT_FAMILY}">${escapeHtml(line)}</text>`,
    )
    .join("\n");

  const subtitleY = titleY + titleLines.length * lineGap + 40;
  const footerSvg = footerLines
    .map(
      (line, i) =>
        `<text x="80" y="${height - 120 + i * 36}" fill="#cbd5e1" font-size="28" font-weight="500" font-family="${OG_FONT_FAMILY}">${escapeHtml(line)}</text>`,
    )
    .join("\n");

  const badgeWidth = Math.max(200, Math.min(520, 60 + badge.length * 22));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${getOgFontFaceStyle()}
  ${brandChromeDefs()}
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect x="0" y="0" width="${width}" height="8" fill="url(#accent)" />
  <g>
    <rect x="80" y="120" rx="22" ry="22" width="${badgeWidth}" height="52" fill="#8b5cf6" fill-opacity="0.25" stroke="#a78bfa" stroke-opacity="0.7" stroke-width="2" />
    <text x="108" y="156" fill="#e9d5ff" font-size="24" font-weight="700" letter-spacing="4" font-family="${OG_FONT_FAMILY}">${escapeHtml(badge.toUpperCase())}</text>
  </g>
  ${titleSvg}
  <text x="80" y="${subtitleY}" fill="#94a3b8" font-size="26" font-weight="500" font-family="${OG_FONT_FAMILY}">${escapeHtml(subtitle)}</text>
  ${footerSvg}
  <text x="${width - 80}" y="140" fill="#ffffff" font-size="40" font-weight="700" text-anchor="end" font-family="${OG_FONT_FAMILY}">VoxDex</text>
  <text x="${width - 80}" y="${height - 80}" fill="#64748b" font-size="22" font-weight="500" text-anchor="end" font-family="${OG_FONT_FAMILY}">voxdex.com</text>
</svg>`;
}

async function svgToPng(svg: string, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(svg, "utf8")).resize(width, height).png().toBuffer();
}

function dims(aspect: SocialTemplateAspect) {
  return aspect === "square" ? SQUARE : LANDSCAPE;
}

export async function renderNewMarketSocialPng(params: {
  entityType: "community_market" | "native_predict";
  slug?: string;
  marketId?: string;
  predictType?: "updown" | "h2h" | "race" | "jackpot";
  aspect?: SocialTemplateAspect;
}): Promise<Buffer> {
  let preview: OgPreviewResult;
  if (params.entityType === "community_market" && params.slug) {
    preview = await resolveCommunityMarketOg(params.slug);
  } else if (
    params.entityType === "native_predict" &&
    params.marketId &&
    params.predictType
  ) {
    preview = await resolveNativePredictOg(params.predictType, params.marketId);
  } else {
    throw new Error("new_market requires community slug or native marketId + predictType");
  }

  const title = preview.title.replace(/ • VoxDex$/, "");
  const { width, height } = dims(params.aspect ?? "square");
  const maxChars = params.aspect === "landscape" ? 28 : 22;
  const titleLines = wrapLines(title, maxChars, 2);
  const svg = buildSocialSvg(
    width,
    height,
    "New on VoxDex",
    titleLines,
    preview.description.slice(0, 120),
  );
  return svgToPng(svg, width, height);
}

export async function renderTopPredictorsWeekSocialPng(params?: {
  aspect?: SocialTemplateAspect;
}): Promise<Buffer> {
  const leaders = await getTopPredictorsForPeriod("week", 3);
  const { width, height } = dims(params?.aspect ?? "square");

  const titleLines = ["Top predictors", "this week"];
  const subtitle = leaders.length === 0 ? "No resolved activity this week yet" : "Ranked by weekly P&L";

  const footerLines = leaders.map((l) => {
    const sign = l.totalPnl >= 0 ? "+" : "";
    const name = l.username.startsWith("@") ? l.username : `@${l.username}`;
    return `#${l.rank} ${name}  ${sign}${l.totalPnl.toLocaleString()} Vox`;
  });

  const svg = buildSocialSvg(width, height, "Weekly leaders", titleLines, subtitle, footerLines);
  return svgToPng(svg, width, height);
}

export function socialTemplateFilename(
  template: SocialTemplateId,
  aspect: SocialTemplateAspect,
): string {
  const base =
    template === "new_market" ? "voxdex-new-market" : "voxdex-top-predictors-week";
  return `${base}-${aspect}.png`;
}
