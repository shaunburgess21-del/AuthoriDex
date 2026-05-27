/**
 * Rich Insights OG image — 1200x630 PNG.
 * Composites avatar circles with name pills onto a brand panel so share
 * previews on Twitter / iMessage / Slack feel as polished as the matchup
 * cards. Falls back to gradient initials when an avatar URL is missing.
 */
import sharp from "sharp";
import {
  measureOutlinedTextWidth,
  textPath,
} from "./og-svg-text-paths";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

export interface InsightsOgRow {
  rank: number;
  name: string;
  avatarUrl: string | null;
  meta?: string;
}

export interface RenderInsightsOgInput {
  title: string;
  subtitle: string;
  badge: string;
  rows?: InsightsOgRow[];
}

const AVATAR_SIZE = 96;
const ROW_GAP = 18;
const ROW_HEIGHT = AVATAR_SIZE + ROW_GAP;
const RIGHT_PANEL_X = 660;
const RIGHT_PANEL_W = OG_WIDTH - RIGHT_PANEL_X - 60;
const PANEL_PAD_X = 28;
const PANEL_PAD_Y = 28;
const NAME_FONT_SIZE = 26;
const META_FONT_SIZE = 18;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

async function fetchAvatarBuffer(url: string | null): Promise<Buffer | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
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

const PLACEHOLDER_GRADIENTS: Array<[string, string]> = [
  ["#6366f1", "#a78bfa"],
  ["#0ea5e9", "#22d3ee"],
  ["#10b981", "#34d399"],
  ["#f59e0b", "#fbbf24"],
  ["#ef4444", "#f97316"],
];

function placeholderAvatarSvg(name: string, idx: number): string {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const [from, to] = PLACEHOLDER_GRADIENTS[idx % PLACEHOLDER_GRADIENTS.length]!;
  const initialWidth = measureOutlinedTextWidth(initial, 56, 700);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" fill="url(#g)"/>
  ${textPath({
    text: initial,
    x: AVATAR_SIZE / 2 - initialWidth / 2,
    y: AVATAR_SIZE / 2 + 20,
    fontSize: 56,
    weight: 700,
    fill: "#ffffff",
  })}
</svg>`;
}

async function buildAvatarTile(row: InsightsOgRow, idx: number): Promise<Buffer> {
  const buf = await fetchAvatarBuffer(row.avatarUrl);
  if (buf) {
    try {
      return await sharp(buf)
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    } catch {
      /* fall through */
    }
  }
  return sharp(Buffer.from(placeholderAvatarSvg(row.name, idx), "utf8"))
    .png()
    .toBuffer();
}

function backgroundSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="url(#accent)"/>
</svg>`;
}

function rowPanelSvg(rows: InsightsOgRow[]): string {
  if (rows.length === 0) return "";
  const panelHeight = rows.length * ROW_HEIGHT + PANEL_PAD_Y * 2 - ROW_GAP;
  const panelY = (OG_HEIGHT - panelHeight) / 2;

  const rowSvgs = rows.map((row, idx) => {
    const rowTop = panelY + PANEL_PAD_Y + idx * ROW_HEIGHT;
    const avatarX = RIGHT_PANEL_X + PANEL_PAD_X;
    const textX = avatarX + AVATAR_SIZE + 22;
    const baselineName = rowTop + 42;
    const baselineMeta = rowTop + 42 + 28;
    const rankBadgeText = `#${row.rank}`;
    const rankWidth = measureOutlinedTextWidth(rankBadgeText, 18, 700);
    const rankPadX = 12;
    const rankBoxW = rankWidth + rankPadX * 2;
    const rankBoxX = avatarX - 6;
    const rankBoxY = rowTop - 6;

    return `
  <rect x="${rankBoxX}" y="${rankBoxY}" width="${rankBoxW}" height="28" rx="14" fill="#22d3ee" fill-opacity="0.9"/>
  ${textPath({
    text: rankBadgeText,
    x: rankBoxX + rankPadX,
    y: rankBoxY + 20,
    fontSize: 18,
    weight: 700,
    fill: "#0f172a",
  })}
  ${textPath({
    text: truncate(row.name, 26),
    x: textX,
    y: baselineName,
    fontSize: NAME_FONT_SIZE,
    weight: 700,
    fill: "#ffffff",
  })}
  ${
    row.meta
      ? textPath({
          text: truncate(row.meta, 28),
          x: textX,
          y: baselineMeta,
          fontSize: META_FONT_SIZE,
          weight: 500,
          fill: "#94a3b8",
        })
      : ""
  }`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="${RIGHT_PANEL_X}" y="${panelY}" width="${RIGHT_PANEL_W}" height="${panelHeight}" rx="24" fill="url(#panel)" stroke="#38bdf8" stroke-opacity="0.25" stroke-width="1.5"/>
  ${rowSvgs.join("\n")}
</svg>`;
}

function leftPanelSvg(opts: {
  title: string;
  subtitle: string;
  badge: string;
}): string {
  const { title, subtitle, badge } = opts;
  const titleX = 64;

  // Word-wrap the title to up to 2 lines (~14 chars each at 64px).
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > 14 && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  const limited = lines.slice(0, 2);
  if (lines.length > 2) {
    limited[1] = truncate(limited[1] ?? "", 14);
  }

  const titleSvgs = limited
    .map((line, i) =>
      textPath({
        text: line,
        x: titleX,
        y: 280 + i * 78,
        fontSize: 64,
        weight: 700,
        fill: "#ffffff",
      }),
    )
    .join("\n");

  const subtitleY = 280 + limited.length * 78 + 18;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  ${textPath({
    text: "VoxDex",
    x: titleX,
    y: 88,
    fontSize: 34,
    weight: 700,
    fill: "#ffffff",
  })}
  <rect x="${titleX}" y="160" width="${measureOutlinedTextWidth(badge.toUpperCase(), 22, 600) + 32}" height="38" rx="19" fill="#a78bfa" fill-opacity="0.18" stroke="#a78bfa" stroke-opacity="0.45"/>
  ${textPath({
    text: badge.toUpperCase(),
    x: titleX + 16,
    y: 186,
    fontSize: 22,
    weight: 600,
    fill: "#c4b5fd",
    letterSpacing: 4,
  })}
  ${titleSvgs}
  ${textPath({
    text: truncate(subtitle, 50),
    x: titleX,
    y: subtitleY,
    fontSize: 24,
    weight: 500,
    fill: "#cbd5e1",
  })}
  ${textPath({
    text: "voxdex.com",
    x: titleX,
    y: 580,
    fontSize: 22,
    weight: 600,
    fill: "#94a3b8",
  })}
</svg>`;
}

export async function renderInsightsOgImage(
  input: RenderInsightsOgInput,
): Promise<Buffer> {
  const rows = (input.rows ?? []).slice(0, 3);

  const [bgPng, leftPng, panelPng, ...avatarTiles] = await Promise.all([
    sharp(Buffer.from(backgroundSvg(), "utf8")).png().toBuffer(),
    sharp(
      Buffer.from(
        leftPanelSvg({
          title: input.title,
          subtitle: input.subtitle,
          badge: input.badge,
        }),
        "utf8",
      ),
    )
      .png()
      .toBuffer(),
    rows.length > 0
      ? sharp(Buffer.from(rowPanelSvg(rows), "utf8")).png().toBuffer()
      : Promise.resolve(null as Buffer | null),
    ...rows.map((row, idx) => buildAvatarTile(row, idx)),
  ]);

  const composite: sharp.OverlayOptions[] = [
    { input: bgPng, left: 0, top: 0 },
    { input: leftPng, left: 0, top: 0 },
  ];

  if (panelPng) {
    composite.push({ input: panelPng, left: 0, top: 0 });

    const panelHeight = rows.length * ROW_HEIGHT + PANEL_PAD_Y * 2 - ROW_GAP;
    const panelY = (OG_HEIGHT - panelHeight) / 2;
    avatarTiles.forEach((tile, idx) => {
      if (!tile) return;
      const rowTop = panelY + PANEL_PAD_Y + idx * ROW_HEIGHT;
      composite.push({
        input: tile,
        left: RIGHT_PANEL_X + PANEL_PAD_X,
        top: Math.round(rowTop),
      });
    });
  }

  return sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite(composite)
    .png()
    .toBuffer();
}
