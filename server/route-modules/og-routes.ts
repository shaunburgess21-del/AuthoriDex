import type { Express, Request, Response } from "express";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { db } from "../db";
import {
  predictionMarkets,
  marketEntries,
  trendingPeople,
  trendingPolls,
  opinionPolls,
  matchups,
  marketBets,
  profiles,
  ammPriceSnapshots,
} from "@shared/schema";
import {
  loadMatchupOgContext,
  matchupOgDescription,
  matchupOgPromptTitle,
} from "../services/matchup-og-context";
import {
  renderMatchupOgImage,
  renderMatchupOgImageJpeg,
} from "../services/matchup-og-image";
import { matchupOgImagePath } from "@shared/matchup-og";
import { sentimentPollOgImagePath } from "@shared/sentiment-poll-og";
import {
  loadSentimentPollOgContext,
  sentimentPollOgDescription,
} from "../services/sentiment-poll-og-context";
import {
  renderSentimentPollOgImage,
  renderSentimentPollOgImageJpeg,
} from "../services/sentiment-poll-og-image";
import {
  getOgFontFaceStyle,
  logOgFontStartup,
  OG_FONT_FAMILY,
} from "../services/og-fonts";

/* ─────────────────────────────────────────────────────────────────────────────
 * Open Graph + Twitter card endpoints + sitemap.xml
 *
 * Why this module exists
 * ----------------------
 * VoxDex is a Vite SPA hosted on Vercel — Vercel rewrites every non-asset
 * path to /index.html so the React app boots and routes client-side. That
 * means non-JS crawlers (Slack, iMessage, Facebook, LinkedIn, Twitter/X,
 * Discord, WhatsApp) all see the same generic <title> and zero per-page
 * `<meta og:*>` tags — links pasted into a chat preview as bare URLs
 * with no thumbnail.
 *
 * Solution: the SPA still serves humans, but a UA-matched Vercel rewrite
 * (see vercel.json) sends crawlers to `/api/og/...` here, which returns
 * a tiny HTML doc with the right OG/Twitter meta + a meta-refresh back
 * to the canonical SPA URL (so an accidental human visit doesn't get
 * stranded).
 *
 * The sitemap endpoint lives here too because it shares the same
 * "tell external services about our markets" purpose.
 *
 * The OG image route is generated on the fly with sharp — no extra
 * deps, brand-styled, per-market title overlay. Cached for 24h via
 * Cache-Control so we don't re-render on every crawl. */

const SITE_URL =
  process.env.PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://voxdex.com";
const SITE_NAME = "VoxDex";
const DEFAULT_DESCRIPTION =
  "The voice of the people, indexed. Vote, predict, and track the people and topics shaping global conversation.";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/**
 * Pre-rendered static default OG card. We bake a designed PNG into
 * `public/og/og-default.png` and serve those bytes from this module
 * instead of dynamically rasterising an SVG via sharp+librsvg — that
 * pipeline drops the embedded @font-face on some Linux containers
 * and produces an unbranded "empty rectangles on blue" preview on
 * WhatsApp / iMessage / Facebook.
 *
 * Loaded lazily on first request and cached for the process lifetime.
 * Resolved relative to `process.cwd()` so it works under both
 * `tsx server/index.ts` (cwd = repo root) and the bundled
 * `node dist/index.js` (cwd = repo root on Railway).
 */
let DEFAULT_OG_PNG_CACHE: Buffer | null = null;
function loadDefaultOgPng(): Buffer | null {
  if (DEFAULT_OG_PNG_CACHE) return DEFAULT_OG_PNG_CACHE;
  try {
    const p = path.resolve(process.cwd(), "public/og/og-default.png");
    DEFAULT_OG_PNG_CACHE = fs.readFileSync(p);
    return DEFAULT_OG_PNG_CACHE;
  } catch (err) {
    console.warn(
      "[OG] Static default PNG not found at public/og/og-default.png — falling back to dynamic SVG render.",
      err,
    );
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface OgPagePayload {
  title: string;
  description: string;
  /** Absolute URL to the canonical SPA page humans should land on. */
  canonicalUrl: string;
  /** Absolute URL to the OG image. */
  imageUrl: string;
  /** e.g. `image/jpeg` — emitted as og:image:type when set. */
  imageType?: string;
  /** Optional Twitter creator handle, e.g. `@voxdex`. */
  twitterSite?: string;
}

/**
 * Render the minimal HTML doc that crawlers consume. We deliberately
 * keep this small — most crawlers parse only the `<head>` and bail out
 * before reading body. The meta-refresh + JS redirect at the end is for
 * any human who somehow ends up here (clicking a Slack-rewritten link
 * with a debug UA, for example).
 */
function renderOgHtml(p: OgPagePayload): string {
  const t = escapeHtml(p.title);
  const d = escapeHtml(p.description);
  const url = escapeHtml(p.canonicalUrl);
  const img = escapeHtml(p.imageUrl);
  const site = escapeHtml(p.twitterSite ?? "@voxdex");
  const imageTypeMeta = p.imageType
    ? `\n    <meta property="og:image:type" content="${escapeHtml(p.imageType)}" />`
    : "";
  const secureImageMeta =
    p.imageUrl.startsWith("https://")
      ? `\n    <meta property="og:image:secure_url" content="${img}" />`
      : "";
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${url}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${img}" />${imageTypeMeta}${secureImageMeta}
    <meta property="og:image:width" content="${OG_WIDTH}" />
    <meta property="og:image:height" content="${OG_HEIGHT}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="${site}" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${img}" />

    <meta http-equiv="refresh" content="0; url=${url}" />
  </head>
  <body>
    <p>Redirecting to <a href="${url}">${url}</a>…</p>
    <script>window.location.replace(${JSON.stringify(p.canonicalUrl)});</script>
  </body>
</html>`;
}

/* ───────────────────────────────────────────────────── OG image generation
 *
 * Market/share cards still rasterize SVG via sharp/librsvg with `<text>`.
 * Matchup OG overlay labels use SVG paths from opentype.js + bundled Inter
 * TTF (see matchup-og-image.ts) — not librsvg fonts or fontconfig.
 *
 * Default site OG uses a pre-rendered PNG; dynamic market SVG may still be
 * font-sensitive on Linux. Output is cached 24h via Cache-Control.
 */
/**
 * Sprint 3: live LMSR price chip rendered into the market OG. We render
 * this row in the SVG just above the subtitle so a Slack/iMessage
 * preview reflects current prices the moment it's pasted.
 *
 * `accent` drives the chip colour: emerald for "UP / YES" outcomes,
 * rose for "DOWN / NO", violet for everything else (named candidates).
 */
export interface AmmPriceChip {
  label: string;
  pct: number;
  accent: "up" | "down" | "other";
}

const PRICE_CHIP_FILL: Record<AmmPriceChip["accent"], string> = {
  up: "#10B981",
  down: "#F43F5E",
  other: "#A855F7",
};

function buildOgSvg(
  title: string,
  subtitle: string,
  badge: string,
  prices?: AmmPriceChip[],
): string {
  // Word-wrap a long title across two lines manually — sharp/SVG doesn't
  // give us automatic flow. Splitting on spaces and packing characters
  // up to ~22 per line keeps the wordmark readable at 1200px wide.
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > 22 && current.length > 0) {
      lines.push(current.trim());
      current = w;
      if (lines.length === 1) {
        // Two-line cap; truncate the rest with an ellipsis on line 2.
      }
    } else {
      current = current ? `${current} ${w}` : w;
    }
  }
  if (current) lines.push(current.trim());
  const limited = lines.slice(0, 2);
  if (lines.length > 2) {
    limited[1] = `${limited[1].slice(0, 20).trim()}…`;
  }

  const titleLines = limited
    .map(
      (line, i) =>
        `<text x="80" y="${320 + i * 90}" fill="#ffffff" font-size="78" font-weight="700" font-family="${OG_FONT_FAMILY}">${escapeHtml(line)}</text>`,
    )
    .join("\n");

  // Optional LMSR price chip row, ~30px tall, sits above the subtitle.
  // Each chip is a rounded-rect filled with the accent colour at low
  // opacity + a same-colour 1px border. Width grows with the label so
  // long candidate names ("Ursula von der Leyen 41%") fit cleanly.
  let priceChipsSvg = "";
  if (prices && prices.length > 0) {
    const y = 470;
    const chipHeight = 44;
    const padX = 22;
    const gap = 14;
    const fontSize = 22;
    let cursorX = 80;
    // Cap to first 3 chips so we always fit on the line at 1200px wide.
    const visible = prices.slice(0, 3);
    const chips = visible.map((c) => {
      const text = `${c.label} ${Math.round(c.pct)}%`;
      // Rough char-to-px estimate for our chosen 22px font. Generous
      // upper bound — chips never butt into each other this way.
      const width = Math.min(420, padX * 2 + text.length * 13);
      const fill = PRICE_CHIP_FILL[c.accent];
      const chip = `<g>
    <rect x="${cursorX}" y="${y}" width="${width}" height="${chipHeight}" rx="22" ry="22" fill="${fill}" fill-opacity="0.18" stroke="${fill}" stroke-opacity="0.55" stroke-width="1.5" />
    <text x="${cursorX + padX}" y="${y + chipHeight / 2 + fontSize / 3}" fill="#ffffff" font-size="${fontSize}" font-weight="600" font-family="${OG_FONT_FAMILY}">${escapeHtml(text)}</text>
  </g>`;
      cursorX += width + gap;
      return chip;
    });
    priceChipsSvg = chips.join("\n");
  }

  // Subtitle drops 25px when we render the AMM price chip row so the
  // chips don't overlap. voxdex.com tagline tracks the subtitle baseline
  // so the parimutuel (no-prices) layout matches what was on production
  // before Sprint 3 — only AMM markets shift the bottom rail down.
  const subtitleY = prices && prices.length > 0 ? 565 : 540;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  ${getOgFontFaceStyle()}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e1b4b" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa" />
      <stop offset="100%" stop-color="#22d3ee" />
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)" />
  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="url(#accent)" />

  <text x="80" y="170" fill="#a78bfa" font-size="32" font-weight="600" letter-spacing="6" font-family="${OG_FONT_FAMILY}">${escapeHtml(badge.toUpperCase())}</text>

  ${titleLines}

  ${priceChipsSvg}

  <text x="80" y="${subtitleY}" fill="#cbd5e1" font-size="32" font-weight="500" font-family="${OG_FONT_FAMILY}">${escapeHtml(subtitle)}</text>

  <text x="${OG_WIDTH - 80}" y="170" fill="#ffffff" font-size="44" font-weight="700" text-anchor="end" font-family="${OG_FONT_FAMILY}">VoxDex</text>
  <text x="${OG_WIDTH - 80}" y="${subtitleY}" fill="#94a3b8" font-size="22" font-weight="500" text-anchor="end" font-family="${OG_FONT_FAMILY}">voxdex.com</text>
</svg>`;
}

async function renderOgImage(
  title: string,
  subtitle: string,
  badge: string,
  prices?: AmmPriceChip[],
): Promise<Buffer> {
  const svg = buildOgSvg(title, subtitle, badge, prices);
  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}

/* ───────────────────────────────────────────────────── data lookups
 *
 * Each helper reads enough of the market to populate the OG title +
 * description. We keep these lean — we do NOT need joins for entries
 * unless H2H, where the two side names are part of the title.
 */

async function lookupCommunityMarket(slug: string) {
  const [m] = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      teaser: predictionMarkets.teaser,
      summary: predictionMarkets.summary,
      slug: predictionMarkets.slug,
      category: predictionMarkets.category,
      marketType: predictionMarkets.marketType,
      // Sprint 3: drives whether we enrich the OG with live LMSR
      // prices. Parimutuel community markets keep the static subtitle.
      engine: predictionMarkets.engine,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.slug, slug))
    .limit(1);
  return m ?? null;
}

async function lookupNativeMarket(id: string) {
  const [m] = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      marketType: predictionMarkets.marketType,
      personId: predictionMarkets.personId,
      category: predictionMarkets.category,
      endAt: predictionMarkets.endAt,
      // Sprint 3: needed for AMM-aware OG enrichment.
      engine: predictionMarkets.engine,
      slug: predictionMarkets.slug,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, id))
    .limit(1);
  return m ?? null;
}

/**
 * Sprint 3 — look up the latest LMSR price per outcome for an AMM
 * market. Reads the most recent snapshot per (market, entry) so the
 * preview reflects the current state without re-running the LMSR.
 *
 * We scan the newest snapshots for this market via the
 * `amm_price_snapshots_market_time_idx` index (an ORDER BY recorded_at
 * DESC LIMIT walks the index prefix), then reduce in memory. The cap
 * is set well above any realistic outcome count × snapshot density so
 * every entry has a row even on heavy-traffic markets.
 *
 * Returns the snapshots joined with the canonical entry label +
 * displayOrder so callers can render in market order without a second
 * lookup.
 */
async function lookupLatestAmmPrices(
  marketId: string,
): Promise<{ entryId: string; label: string; price: number }[]> {
  const rows = await db
    .select({
      entryId: ammPriceSnapshots.entryId,
      price: ammPriceSnapshots.price,
      label: marketEntries.label,
      displayOrder: marketEntries.displayOrder,
    })
    .from(ammPriceSnapshots)
    .innerJoin(marketEntries, eq(marketEntries.id, ammPriceSnapshots.entryId))
    .where(eq(ammPriceSnapshots.marketId, marketId))
    .orderBy(desc(ammPriceSnapshots.recordedAt))
    // Bounded scan — the largest AMM market has at most ~10 outcomes,
    // and a snapshot per trade. 200 covers ~20 trades' worth of rows
    // for a 10-outcome race which is way more than enough to find a
    // latest row per entry. Keeps the query a fixed-cost index lookup
    // regardless of how active a market gets.
    .limit(200);

  // First occurrence in the DESC-ordered scan is the latest snapshot
  // per entry. Preserve market display order in the returned array.
  const seen = new Map<
    string,
    { entryId: string; label: string; price: number; displayOrder: number }
  >();
  for (const r of rows) {
    if (seen.has(r.entryId)) continue;
    seen.set(r.entryId, {
      entryId: r.entryId,
      label: r.label,
      price: Number(r.price),
      displayOrder: r.displayOrder ?? 0,
    });
  }
  return Array.from(seen.values())
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(({ entryId, label, price }) => ({ entryId, label, price }));
}

/**
 * Sprint 3 — look up the data we need to render a bet share preview.
 * Single query joins bet → market → entry → person → owner profile so
 * the per-bet OG endpoint doesn't have to fan out.
 */
async function lookupBetForShare(betId: string) {
  const [row] = await db
    .select({
      betId: marketBets.id,
      marketId: marketBets.marketId,
      entryId: marketBets.entryId,
      userId: marketBets.userId,
      actionType: marketBets.actionType,
      status: marketBets.status,
      stakeAmount: marketBets.stakeAmount,
      potentialPayout: marketBets.potentialPayout,
      payoutAmount: marketBets.payoutAmount,
      shareCount: marketBets.shareCount,
      pricePerShare: marketBets.pricePerShare,
      direction: marketBets.direction,
      createdAt: marketBets.createdAt,
      marketTitle: predictionMarkets.title,
      marketSlug: predictionMarkets.slug,
      marketType: predictionMarkets.marketType,
      marketEngine: predictionMarkets.engine,
      marketPersonId: predictionMarkets.personId,
      marketCategory: predictionMarkets.category,
      entryLabel: marketEntries.label,
      personName: trendingPeople.name,
      ownerUsername: profiles.username,
      ownerIsPublic: profiles.isPublic,
      ownerPositionsPublic: profiles.positionsPublic,
    })
    .from(marketBets)
    .innerJoin(predictionMarkets, eq(predictionMarkets.id, marketBets.marketId))
    .innerJoin(marketEntries, eq(marketEntries.id, marketBets.entryId))
    .leftJoin(trendingPeople, eq(trendingPeople.id, predictionMarkets.personId))
    .innerJoin(profiles, eq(profiles.id, marketBets.userId))
    .where(eq(marketBets.id, betId))
    .limit(1);
  return row ?? null;
}

type BetShareRow = NonNullable<Awaited<ReturnType<typeof lookupBetForShare>>>;

/**
 * Sprint 3 privacy gate. Settled outcomes (won / lost / refunded /
 * void) are always public — that's the same rule the public profile,
 * leaderboard, and Town Square use for settled history. Open AMM
 * trades respect the user's `positionsPublic` flag.
 */
function isBetSharePublic(bet: BetShareRow): boolean {
  if (!bet.ownerIsPublic) return false;
  const settled = new Set(["won", "lost", "refunded", "void"]);
  if (settled.has(bet.status)) return true;
  return Boolean(bet.ownerPositionsPublic);
}

/**
 * Canonical SPA URL we redirect humans + bots to from a share preview.
 * Mirrors the routing logic in App.tsx so the share link always lands
 * on the right detail page for the market type.
 */
function canonicalMarketUrl(bet: BetShareRow): string {
  if (bet.marketType === "updown") {
    return `${SITE_URL}/predict/updown/${bet.marketId}`;
  }
  if (bet.marketType === "h2h") {
    return `${SITE_URL}/predict/h2h/${bet.marketId}`;
  }
  if (bet.marketType === "gainer") {
    return `${SITE_URL}/predict/race/${bet.marketId}`;
  }
  if (bet.marketSlug) {
    return `${SITE_URL}/markets/${encodeURIComponent(bet.marketSlug)}`;
  }
  return `${SITE_URL}/predict`;
}

/**
 * Resolve "what should the share preview say about this bet?".
 *
 * Five visual variants — won / lost / refunded-or-void / sell /
 * active-buy — driven by the row's status + actionType. The status
 * check fires before the actionType check so a settled buy row never
 * renders the "pays X if win" active-buy copy (which would read as
 * "we still might win" for a bet that already lost).
 *
 * Pari-mutuel rows without an explicit AMM actionType fall through to
 * the active-buy branch with stake/potentialPayout framing.
 */
function deriveBetShareCopy(bet: BetShareRow): {
  badge: string;
  badgeAccent: AmmPriceChip["accent"] | "win" | "sell" | "neutral";
  title: string;
  subtitle: string;
} {
  const hero = bet.personName ?? bet.marketTitle ?? "VoxDex";
  const entryLabel = bet.entryLabel ?? "PICKED";
  const direction: AmmPriceChip["accent"] =
    entryLabel.toLowerCase() === "up" || entryLabel.toLowerCase() === "yes"
      ? "up"
      : entryLabel.toLowerCase() === "down" || entryLabel.toLowerCase() === "no"
        ? "down"
        : "other";

  // Settled outcomes branch first so a `status='lost'` AMM buy row
  // doesn't render the misleading "pays X if win" active-buy subtitle.
  if (bet.status === "won") {
    const stake = Number(bet.stakeAmount) || 0;
    const payout = Number(bet.payoutAmount) || 0;
    const pnl = Math.max(0, payout - stake);
    return {
      badge: "WON",
      badgeAccent: "win",
      title: hero,
      subtitle: `+${pnl.toLocaleString()} credits on "${bet.marketTitle}"`,
    };
  }

  if (bet.status === "lost") {
    const stake = Math.abs(Number(bet.stakeAmount) || 0);
    return {
      badge: "RESOLVED",
      badgeAccent: "neutral",
      title: hero,
      subtitle: `Backed ${entryLabel} · ${stake.toLocaleString()} cr on "${bet.marketTitle}"`,
    };
  }

  if (bet.status === "refunded" || bet.status === "void") {
    const stake = Math.abs(Number(bet.stakeAmount) || 0);
    return {
      badge: bet.status === "void" ? "VOID" : "REFUNDED",
      badgeAccent: "neutral",
      title: hero,
      subtitle: `Market ${bet.status === "void" ? "voided" : "refunded"} · ${stake.toLocaleString()} cr returned`,
    };
  }

  if (bet.actionType === "sell") {
    const shares = Number(bet.shareCount) || 0;
    // Sell rows store proceeds in payoutAmount (set at insert time by
    // executeSell), so this is the right "credits in" number.
    const proceeds = Number(bet.payoutAmount) || 0;
    return {
      badge: "SOLD",
      badgeAccent: "sell",
      title: hero,
      subtitle: `Sold ${Math.round(shares).toLocaleString()} ${entryLabel} shares · +${proceeds.toLocaleString()} cr`,
    };
  }

  // AMM buy (active) — show shares + fill price + payout-if-win.
  if (bet.actionType === "buy") {
    const shares = Number(bet.shareCount) || 0;
    const pricePerShare = Number(bet.pricePerShare) || 0;
    const stake = Number(bet.stakeAmount) || 0;
    const payIfWin = Math.max(0, Math.floor(shares));
    return {
      badge: `BACKED ${direction === "other" ? entryLabel.toUpperCase() : direction.toUpperCase()}`,
      badgeAccent: direction,
      title: hero,
      subtitle: `${Math.round(shares).toLocaleString()} shares @ ${Math.round(pricePerShare * 100)}% · ${stake.toLocaleString()} cr in · pays ${payIfWin.toLocaleString()} if ${direction === "other" ? `${entryLabel} wins` : `${direction} wins`}`,
    };
  }

  // Pari-mutuel fallback. Treat stake/potentialPayout like the in-app
  // "Estimated payout" framing — keeps the preview useful for legacy
  // open bets that haven't moved off pari yet.
  const stake = Number(bet.stakeAmount) || 0;
  const payout = Number(bet.potentialPayout) || 0;
  return {
    badge: `BACKED ${direction === "other" ? entryLabel.toUpperCase() : direction.toUpperCase()}`,
    badgeAccent: direction,
    title: hero,
    subtitle: payout > 0
      ? `${stake.toLocaleString()} cr backing ${entryLabel} · est. payout ${payout.toLocaleString()}`
      : `${stake.toLocaleString()} cr backing ${entryLabel}`,
  };
}

/**
 * Sprint 3 — bet-flavoured OG SVG. Reuses the same brand chrome as the
 * generic `buildOgSvg` but swaps the badge accent for the bet variant
 * (emerald "WON", direction-coloured "BACKED", amber "SOLD") and tucks
 * the @username into the top-right under the wordmark so the preview
 * tells a complete "@user backed DOWN on Bill Gates" story.
 */
function buildBetOgSvg(args: {
  badge: string;
  badgeAccent: AmmPriceChip["accent"] | "win" | "sell" | "neutral";
  title: string;
  subtitle: string;
  username: string | null;
}): string {
  // Settled wins / sells / refunds-or-voids use distinct pill accents so
  // the preview communicates outcome at a glance. Neutral grey is used
  // for "resolved" rows (settled losses, refunds, voids) — keeps the
  // card honest without weaponising bright red against the user.
  const badgeFill =
    args.badgeAccent === "win"
      ? "#10B981"
      : args.badgeAccent === "sell"
        ? "#F59E0B"
        : args.badgeAccent === "neutral"
          ? "#64748B"
          : PRICE_CHIP_FILL[args.badgeAccent];

  // Word-wrap the title (re-implemented locally so the bet variant can
  // use a slightly different y-offset to accommodate the eyebrow).
  const words = args.title.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > 22 && current.length > 0) {
      lines.push(current.trim());
      current = w;
    } else {
      current = current ? `${current} ${w}` : w;
    }
  }
  if (current) lines.push(current.trim());
  const limited = lines.slice(0, 2);
  if (lines.length > 2) {
    limited[1] = `${limited[1].slice(0, 20).trim()}…`;
  }
  const titleLines = limited
    .map(
      (line, i) =>
        `<text x="80" y="${330 + i * 90}" fill="#ffffff" font-size="78" font-weight="700" font-family="${OG_FONT_FAMILY}">${escapeHtml(line)}</text>`,
    )
    .join("\n");

  // Subtitle is longer-form than the market OG — bump font down a
  // notch so trade headlines like "152 shares @ 66% · 100 cr in · pays
  // 152 if down wins" fit on one line.
  const sub = args.subtitle;

  const userTag = args.username ? `@${args.username}` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  ${getOgFontFaceStyle()}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e1b4b" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa" />
      <stop offset="100%" stop-color="#22d3ee" />
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)" />
  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="url(#accent)" />

  <!-- Action pill: filled with the variant accent at low opacity, bordered
       for legibility on dark bg. Pill width = 60px padding + 24px per char
       (empirical fit for 26px Inter Bold with letter-spacing 4), clamped
       so short badges like "WON" and long ones like "BACKED CANDIDATE"
       both stay legible without overflowing the 1200px canvas. -->
  <g>
    <rect x="80" y="140" rx="22" ry="22" width="${Math.max(160, Math.min(620, 60 + args.badge.length * 24))}" height="56" fill="${badgeFill}" fill-opacity="0.22" stroke="${badgeFill}" stroke-opacity="0.7" stroke-width="2" />
    <text x="${80 + 28}" y="178" fill="#ffffff" font-size="26" font-weight="700" letter-spacing="4" font-family="${OG_FONT_FAMILY}">${escapeHtml(args.badge.toUpperCase())}</text>
  </g>

  ${titleLines}

  <text x="80" y="520" fill="#e2e8f0" font-size="28" font-weight="500" font-family="${OG_FONT_FAMILY}">${escapeHtml(sub)}</text>

  <text x="${OG_WIDTH - 80}" y="170" fill="#ffffff" font-size="44" font-weight="700" text-anchor="end" font-family="${OG_FONT_FAMILY}">VoxDex</text>
  <text x="${OG_WIDTH - 80}" y="210" fill="#cbd5e1" font-size="22" font-weight="500" text-anchor="end" font-family="${OG_FONT_FAMILY}">${escapeHtml(userTag)}</text>
  <text x="${OG_WIDTH - 80}" y="600" fill="#94a3b8" font-size="22" font-weight="500" text-anchor="end" font-family="${OG_FONT_FAMILY}">voxdex.com</text>
</svg>`;
}

/**
 * Sprint 3 — compose the AMM-aware subtitle for an existing market OG
 * endpoint. Returns null for parimutuel markets so callers fall back
 * to their existing static copy.
 */
function buildAmmMarketCopy(
  marketType: string,
  prices: { entryId: string; label: string; price: number }[],
  personName?: string | null,
  categoryLabel?: string | null,
): { subtitle: string; chips: AmmPriceChip[] } | null {
  if (prices.length === 0) return null;

  const accentFor = (label: string): AmmPriceChip["accent"] => {
    const l = label.toLowerCase();
    if (l === "up" || l === "yes") return "up";
    if (l === "down" || l === "no") return "down";
    return "other";
  };

  const sorted = [...prices].sort((a, b) => b.price - a.price);
  const chips: AmmPriceChip[] = sorted.map((p) => ({
    label: p.label,
    pct: p.price * 100,
    accent: accentFor(p.label),
  }));

  if (marketType === "updown") {
    const up = prices.find((p) => p.label.toLowerCase() === "up");
    const down = prices.find((p) => p.label.toLowerCase() === "down");
    const upPct = up ? Math.round(up.price * 100) : 50;
    const downPct = down ? Math.round(down.price * 100) : 100 - upPct;
    return {
      subtitle: `UP ${upPct}% · DOWN ${downPct}% · Live market${personName ? ` on ${personName}` : ""}`,
      chips,
    };
  }

  if (marketType === "h2h") {
    const leader = sorted[0];
    return {
      subtitle: leader
        ? `${leader.label} leading at ${Math.round(leader.price * 100)}% · Live head-to-head`
        : "Live head-to-head on VoxDex",
      chips,
    };
  }

  if (marketType === "gainer") {
    const leader = sorted[0];
    return {
      subtitle: leader
        ? `Leader: ${leader.label} ${Math.round(leader.price * 100)}% · Pick the biggest mover${categoryLabel ? ` in ${categoryLabel}` : ""}`
        : "Pick the biggest mover this week",
      chips,
    };
  }

  // Community AMM (binary / multi) — also covers native market types we
  // haven't special-cased above. For binary YES/NO show the YES share;
  // for multi-outcome show the leader.
  const yes = prices.find((p) => p.label.toLowerCase() === "yes");
  if (yes) {
    return {
      subtitle: `YES ${Math.round(yes.price * 100)}% · Live world market on VoxDex`,
      chips,
    };
  }
  const leader = sorted[0];
  return {
    subtitle: leader
      ? `Leader: ${leader.label} ${Math.round(leader.price * 100)}% · Live world market`
      : "Live world market on VoxDex",
    chips,
  };
}

/**
 * Encodes AMM price chips into the URL-param shape consumed by
 * `/api/og/image/market.png`. Keeps the encoding in one place so the
 * meta route and the PNG route can't drift.
 */
function pricesParamFromChips(chips: AmmPriceChip[] | undefined): string {
  if (!chips || chips.length === 0) return "";
  const encoded = chips
    .slice(0, 3)
    .map((c) => {
      const safeLabel = c.label.replace(/[,:]/g, " ").slice(0, 32);
      return `${safeLabel}:${Math.round(c.pct)}:${c.accent}`;
    })
    .join(",");
  return `&prices=${encodeURIComponent(encoded)}`;
}

async function lookupNativeEntries(id: string) {
  return db
    .select({
      id: marketEntries.id,
      label: marketEntries.label,
      marketId: marketEntries.marketId,
    })
    .from(marketEntries)
    .where(eq(marketEntries.marketId, id))
    .orderBy(marketEntries.displayOrder);
}

/* Vote-section lookups (sentiment polls / opinion polls / matchups).
 *
 * Each of the three vote surfaces ships its own detail page that's
 * highly shareable on its own (each has a "Share" button in the
 * header). To make those shares preview-rich on Slack/iMessage we
 * read the smallest possible row to populate the OG title +
 * description and avoid joining anything else. */
async function lookupSentimentPoll(slug: string) {
  const [p] = await db
    .select({
      id: trendingPolls.id,
      headline: trendingPolls.headline,
      subjectText: trendingPolls.subjectText,
      description: trendingPolls.description,
      imageUrl: trendingPolls.imageUrl,
      category: trendingPolls.category,
      slug: trendingPolls.slug,
    })
    .from(trendingPolls)
    .where(eq(trendingPolls.slug, slug))
    .limit(1);
  return p ?? null;
}

async function lookupOpinionPoll(slug: string) {
  const [p] = await db
    .select({
      id: opinionPolls.id,
      title: opinionPolls.title,
      summary: opinionPolls.summary,
      description: opinionPolls.description,
      imageUrl: opinionPolls.imageUrl,
      category: opinionPolls.category,
      slug: opinionPolls.slug,
    })
    .from(opinionPolls)
    .where(eq(opinionPolls.slug, slug))
    .limit(1);
  return p ?? null;
}

function matchupOgImageUrl(slug: string): string {
  return `${SITE_URL}${matchupOgImagePath(slug)}`;
}

function sentimentPollOgImageUrl(slug: string): string {
  return `${SITE_URL}${sentimentPollOgImagePath(slug)}`;
}

async function serveSentimentPollOgImage(
  req: Request,
  res: Response,
  format: "png" | "jpeg",
): Promise<void> {
  const slug = req.params.slug;
  const contentType = format === "jpeg" ? "image/jpeg" : "image/png";
  try {
    const ctx = await loadSentimentPollOgContext(slug);
    if (!ctx) {
      const fallback = loadDefaultOgPng();
      if (fallback) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.send(fallback);
        return;
      }
      res.status(404).send("poll not found");
      return;
    }
    const image =
      format === "jpeg"
        ? await renderSentimentPollOgImageJpeg(ctx)
        : await renderSentimentPollOgImage(ctx);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(image);
  } catch (err: any) {
    console.error(`[OG] Sentiment poll ${format.toUpperCase()} render failed:`, err?.message);
    const fallback = loadDefaultOgPng();
    if (fallback) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(fallback);
      return;
    }
    res.status(500).send("og render failed");
  }
}

async function serveMatchupOgImage(
  req: Request,
  res: Response,
  format: "png" | "jpeg",
): Promise<void> {
  const slug = req.params.slug;
  const contentType = format === "jpeg" ? "image/jpeg" : "image/png";
  try {
    const ctx = await loadMatchupOgContext(slug);
    if (!ctx) {
      const fallback = loadDefaultOgPng();
      if (fallback) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.send(fallback);
        return;
      }
      res.status(404).send("matchup not found");
      return;
    }
    const image =
      format === "jpeg"
        ? await renderMatchupOgImageJpeg(ctx)
        : await renderMatchupOgImage(ctx);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(image);
  } catch (err: any) {
    console.error(`[OG] Matchup ${format.toUpperCase()} render failed:`, err?.message);
    const fallback = loadDefaultOgPng();
    if (fallback) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(fallback);
      return;
    }
    res.status(500).send("og render failed");
  }
}

async function lookupPersonName(personId: string | null): Promise<string | null> {
  if (!personId) return null;
  const [p] = await db
    .select({ name: trendingPeople.name })
    .from(trendingPeople)
    .where(eq(trendingPeople.id, personId))
    .limit(1);
  return p?.name ?? null;
}

/* ───────────────────────────────────────────────────── route registration */

export function registerOgRoutes(app: Express): void {
  logOgFontStartup();

  /* Default site OG image — used by the home page meta. Cached aggressively
   * since the brand wordmark doesn't change. */
  app.get("/api/og/image/default.png", async (_req: Request, res: Response) => {
    try {
      const staticPng = loadDefaultOgPng();
      const png =
        staticPng ??
        (await renderOgImage("Vox Populi", "Track. Predict. Win.", "VoxDex"));
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.send(png);
    } catch (err: any) {
      console.error("[OG] Default image render failed:", err?.message);
      res.status(500).send("og render failed");
    }
  });

  /* Per-market OG image. Title comes from query string so the same route
   * powers all four market types — keeps the renderer 1-1 with the meta
   * route, avoids a second DB lookup.
   *
   * Sprint 3: optional `prices` query param packs live LMSR chips
   * (`label:pct,label:pct,...`, `up` / `down` outcomes get the
   * directional accent, anything else lands on violet). The market
   * OG meta routes (`/api/og/predict/...` + `/api/og/markets/:slug`)
   * encode this from `lookupLatestAmmPrices` so the preview thumbnail
   * matches what's on screen for AMM markets without needing a second
   * server-side render path. */
  app.get("/api/og/image/market.png", async (req: Request, res: Response) => {
    try {
      const title = String(req.query.title ?? "VoxDex Market").slice(0, 80);
      const subtitle = String(req.query.subtitle ?? "Predict & win on VoxDex").slice(0, 80);
      const badge = String(req.query.badge ?? "Prediction").slice(0, 24);
      const pricesParam = String(req.query.prices ?? "").slice(0, 240);
      const chips: AmmPriceChip[] | undefined = pricesParam
        ? pricesParam
            .split(",")
            .map((seg) => seg.trim())
            .filter(Boolean)
            .slice(0, 3)
            .map((seg) => {
              // Format: "Label:pct[:accent]". Default accent = other.
              const [labelRaw, pctRaw, accentRaw] = seg.split(":");
              const pct = Number(pctRaw);
              const accent: AmmPriceChip["accent"] =
                accentRaw === "up" || accentRaw === "down" || accentRaw === "other"
                  ? accentRaw
                  : "other";
              return {
                label: (labelRaw ?? "").slice(0, 32),
                pct: Number.isFinite(pct) ? pct : 0,
                accent,
              };
            })
            .filter((c) => c.label.length > 0)
        : undefined;
      const png = await renderOgImage(title, subtitle, badge, chips);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(png);
    } catch (err: any) {
      console.error("[OG] Market image render failed:", err?.message);
      res.status(500).send("og render failed");
    }
  });

  /* Sprint 3 — per-bet OG image (PNG).
   *
   * Slack / iMessage / X preview a `/share/bet/:betId` link by fetching
   * `<meta og:image>`, which resolves to this endpoint. We render an
   * SVG via sharp the same way the market OG works — no external image
   * fetches so the path is bounded and reliable.
   *
   * Cached aggressively because bet rows are append-only: shareCount,
   * pricePerShare, status are all written once at insert / resolve
   * time, so the image is safe to cache for a day.
   */
  app.get(
    "/api/og/share/bet/:betId.png",
    async (req: Request, res: Response) => {
      try {
        const bet = await lookupBetForShare(req.params.betId);
        if (!bet || !isBetSharePublic(bet)) {
          // Fall back to the default brand image rather than 404 — a
          // 404 collapses to an empty card on most chat clients. Cache
          // shorter (5 min) so a freshly-flipped privacy toggle picks
          // up quickly.
          const png = await renderOgImage(
            "VoxDex",
            DEFAULT_DESCRIPTION,
            "Predict",
          );
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Cache-Control", "public, max-age=300");
          res.send(png);
          return;
        }
        const copy = deriveBetShareCopy(bet);
        const svg = buildBetOgSvg({
          badge: copy.badge,
          badgeAccent: copy.badgeAccent,
          title: copy.title,
          subtitle: copy.subtitle,
          username: bet.ownerUsername ?? null,
        });
        const png = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(png);
      } catch (err: any) {
        console.error("[OG] Bet image render failed:", err?.message);
        res.status(500).send("og render failed");
      }
    },
  );

  /* Sprint 3 — per-bet share HTML for crawlers.
   *
   * Mirrors the `/api/og/markets/:slug` shape exactly so OG/Twitter
   * meta + canonical URL all behave the same. The canonical URL
   * always points at the market detail page — the bet itself isn't
   * a navigable surface in the SPA. */
  app.get(
    "/api/og/share/bet/:betId",
    async (req: Request, res: Response) => {
      const betId = req.params.betId;
      try {
        const bet = await lookupBetForShare(betId);
        if (!bet || !isBetSharePublic(bet)) {
          // Fall through to a generic VoxDex preview pointing at /predict.
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=300");
          res.send(
            renderOgHtml({
              title: `${SITE_NAME} — Predict`,
              description: DEFAULT_DESCRIPTION,
              canonicalUrl: `${SITE_URL}/predict`,
              imageUrl: `${SITE_URL}/api/og/image/default.png`,
            }),
          );
          return;
        }

        const copy = deriveBetShareCopy(bet);
        const canonicalUrl = canonicalMarketUrl(bet);
        const imageUrl = `${SITE_URL}/api/og/share/bet/${encodeURIComponent(betId)}.png`;
        // Slack / iMessage / X render og:title as a bold text line above
        // the preview image. Tag-style bracket prefix keeps the variants
        // consistent — `[BACKED DOWN] @andre on Bill Gates` reads the same
        // for buys, sells, wins, and refunds without per-variant grammar.
        const previewTitle = bet.ownerUsername
          ? `[${copy.badge}] @${bet.ownerUsername} on ${copy.title}`
          : `[${copy.badge}] ${copy.title}`;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        // Bet rows are append-only; the OG can be cached for a day.
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(
          renderOgHtml({
            title: `${previewTitle} • VoxDex`,
            description: copy.subtitle,
            canonicalUrl,
            imageUrl,
          }),
        );
      } catch (err: any) {
        console.error("[OG] Bet HTML render failed:", err?.message);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(
          renderOgHtml({
            title: SITE_NAME,
            description: DEFAULT_DESCRIPTION,
            canonicalUrl: `${SITE_URL}/predict`,
            imageUrl: `${SITE_URL}/api/og/image/default.png`,
          }),
        );
      }
    },
  );

  /* Sprint 3 — JSON resolver consumed by the SPA's `/share/bet/:betId`
   * route. Humans never see this URL directly; the SPA fetches it on
   * mount and forwards to the canonical market detail page.
   *
   * We deliberately leak nothing privacy-sensitive: even on a private
   * bet we return the canonical market URL so the user lands on the
   * market page, never a "bet hidden" state. */
  app.get(
    "/api/share/bet/:betId/resolve",
    async (req: Request, res: Response) => {
      try {
        const bet = await lookupBetForShare(req.params.betId);
        if (!bet) {
          res.setHeader("Cache-Control", "public, max-age=60");
          res.json({ canonicalUrl: `${SITE_URL}/predict`, found: false });
          return;
        }
        res.setHeader("Cache-Control", "public, max-age=300");
        res.json({ canonicalUrl: canonicalMarketUrl(bet), found: true });
      } catch (err: any) {
        console.error("[Share] Bet resolve failed:", err?.message);
        res.status(500).json({ canonicalUrl: `${SITE_URL}/predict`, found: false });
      }
    },
  );

  /* Community market OG HTML page.
   *
   * Sprint 3: AMM markets get a live LMSR price chip row + a subtitle
   * that reflects the current state. Pari-mutuel community markets
   * keep the static "World market • Predict on VoxDex" treatment so
   * the new code doesn't regress the existing surface. */
  app.get("/api/og/markets/:slug", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const market = await lookupCommunityMarket(slug);
    const canonicalUrl = `${SITE_URL}/markets/${encodeURIComponent(slug)}`;

    if (!market) {
      // Render a generic preview rather than a 404 — Slack/iMessage will
      // render an empty card if we 404, and the human will land on the
      // SPA's own NotFound page anyway via the meta-refresh.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(
        renderOgHtml({
          title: SITE_NAME,
          description: DEFAULT_DESCRIPTION,
          canonicalUrl,
          imageUrl: `${SITE_URL}/api/og/image/default.png`,
        }),
      );
      return;
    }

    let subtitle = "World market • Predict on VoxDex";
    let pricesQuery = "";
    if (market.engine === "amm") {
      try {
        const prices = await lookupLatestAmmPrices(market.id);
        const enriched = buildAmmMarketCopy("community", prices);
        if (enriched) {
          subtitle = enriched.subtitle;
          pricesQuery = pricesParamFromChips(enriched.chips);
        }
      } catch (err: any) {
        console.error(
          "[OG] AMM community price lookup failed:",
          err?.message,
        );
      }
    }

    const description =
      market.teaser ?? market.summary ?? DEFAULT_DESCRIPTION;
    const imageUrl = `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(market.title)}&subtitle=${encodeURIComponent(subtitle)}&badge=${encodeURIComponent("World market")}${pricesQuery}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(
      renderOgHtml({
        title: `${market.title} • VoxDex`,
        description,
        canonicalUrl,
        imageUrl,
      }),
    );
  });

  /* Native (updown / h2h / race / jackpot) OG HTML page. We branch on
   * marketType from the DB row so the URL shape stays simple. */
  app.get(
    "/api/og/predict/:type/:marketId",
    async (req: Request, res: Response) => {
      const type = req.params.type;
      const marketId = req.params.marketId;
      const validTypes = new Set(["updown", "h2h", "race", "jackpot"]);
      const canonicalPath =
        type === "race"
          ? `/predict/race/${marketId}`
          : type === "h2h"
            ? `/predict/h2h/${marketId}`
            : type === "updown"
              ? `/predict/updown/${marketId}`
              : `/predict#jackpot`;
      const canonicalUrl = `${SITE_URL}${canonicalPath}`;

      const fallback = (
        title: string,
        subtitle: string,
        badge: string,
        chips?: AmmPriceChip[],
      ) => {
        const imageUrl = `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(title)}&subtitle=${encodeURIComponent(subtitle)}&badge=${encodeURIComponent(badge)}${pricesParamFromChips(chips)}`;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=600");
        res.send(
          renderOgHtml({
            title: `${title} • VoxDex`,
            description: subtitle,
            canonicalUrl,
            imageUrl,
          }),
        );
      };

      if (!validTypes.has(type)) {
        fallback(SITE_NAME, DEFAULT_DESCRIPTION, "Predict");
        return;
      }

      try {
        const market = await lookupNativeMarket(marketId);
        if (!market) {
          fallback(SITE_NAME, DEFAULT_DESCRIPTION, "Predict");
          return;
        }

        // Sprint 3: for AMM markets fetch the latest LMSR prices so we
        // can override the static subtitle + show the price chip row
        // on the preview thumbnail. Jackpot stays parimutuel for now.
        const ammPrices =
          market.engine === "amm" && type !== "jackpot"
            ? await lookupLatestAmmPrices(market.id).catch((err) => {
                console.error(
                  "[OG] AMM native price lookup failed:",
                  err?.message,
                );
                return [];
              })
            : [];

        if (type === "updown") {
          const personName =
            (await lookupPersonName(market.personId)) ?? "this person";
          const enriched =
            ammPrices.length > 0
              ? buildAmmMarketCopy("updown", ammPrices, personName)
              : null;
          fallback(
            `${personName}: Up or Down?`,
            enriched?.subtitle ??
              "Will their Trend Score close above or below the weekly baseline?",
            "Up / Down",
            enriched?.chips,
          );
          return;
        }

        if (type === "h2h") {
          const entries = await lookupNativeEntries(market.id);
          const a = entries[0]?.label ?? "Side A";
          const b = entries[1]?.label ?? "Side B";
          const enriched =
            ammPrices.length > 0 ? buildAmmMarketCopy("h2h", ammPrices) : null;
          fallback(
            `${a} vs ${b}`,
            enriched?.subtitle ??
              "Head-to-head: who'll gain more Trend Score points this week?",
            "Head to head",
            enriched?.chips,
          );
          return;
        }

        if (type === "race") {
          const categoryLabel = market.category ?? "Category Race";
          const enriched =
            ammPrices.length > 0
              ? buildAmmMarketCopy("gainer", ammPrices, null, categoryLabel)
              : null;
          fallback(
            `${categoryLabel} Race`,
            enriched?.subtitle ??
              "Pick the biggest mover in the category this week.",
            "Race",
            enriched?.chips,
          );
          return;
        }

        // jackpot
        const personName = await lookupPersonName(market.personId);
        fallback(
          personName ? `${personName} Jackpot` : "Weekly Jackpot",
          "Pick a Trend Score number, win the pool if you're closest.",
          "Jackpot",
        );
      } catch (err: any) {
        console.error("[OG] Native render failed:", err?.message);
        fallback(SITE_NAME, DEFAULT_DESCRIPTION, "Predict");
      }
    },
  );

  /* Generic OG HTML for the homepage / Predict page / static surfaces.
   * Crawlers that follow share-this-page links (e.g. /predict#updown)
   * land here when we strip the hash for routing. */
  app.get("/api/og/site", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(
      renderOgHtml({
        title: `${SITE_NAME} — Vox Populi`,
        description: DEFAULT_DESCRIPTION,
        canonicalUrl: SITE_URL,
        imageUrl: `${SITE_URL}/api/og/image/default.png`,
      }),
    );
  });

  /* ─────────────────────────────────────────────────── vote sections
   *
   * Sentiment polls (`/polls/:slug`), opinion polls
   * (`/vote/opinion-polls/:slug`), and matchups
   * (`/vote/matchups/:slug`) all expose a Share button. We mirror the
   * market OG pattern so the preview cards in Slack/iMessage carry the
   * actual headline + subject instead of "VoxDex" with a generic
   * thumbnail. The image is the same dynamically-rendered SVG used
   * for markets — keeps the brand visual language consistent across
   * every shareable surface. */

  app.get("/api/og/polls/:slug", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const canonicalUrl = `${SITE_URL}/polls/${encodeURIComponent(slug)}`;
    try {
      const ctx = await loadSentimentPollOgContext(slug);
      if (!ctx) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.send(
          renderOgHtml({
            title: SITE_NAME,
            description: DEFAULT_DESCRIPTION,
            canonicalUrl,
            imageUrl: `${SITE_URL}/api/og/image/default.png`,
          }),
        );
        return;
      }
      const description = sentimentPollOgDescription(ctx);
      const imageUrl = sentimentPollOgImageUrl(ctx.slug);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.send(
        renderOgHtml({
          title: `${ctx.headline} • VoxDex`,
          description,
          canonicalUrl,
          imageUrl,
          imageType: "image/jpeg",
        }),
      );
    } catch (err: any) {
      console.error("[OG] Sentiment poll render failed:", err?.message);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        renderOgHtml({
          title: SITE_NAME,
          description: DEFAULT_DESCRIPTION,
          canonicalUrl,
          imageUrl: `${SITE_URL}/api/og/image/default.png`,
        }),
      );
    }
  });

  app.get(
    "/api/og/opinion-polls/:slug",
    async (req: Request, res: Response) => {
      const slug = req.params.slug;
      const canonicalUrl = `${SITE_URL}/vote/opinion-polls/${encodeURIComponent(slug)}`;
      try {
        const poll = await lookupOpinionPoll(slug);
        if (!poll) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=300");
          res.send(
            renderOgHtml({
              title: SITE_NAME,
              description: DEFAULT_DESCRIPTION,
              canonicalUrl,
              imageUrl: `${SITE_URL}/api/og/image/default.png`,
            }),
          );
          return;
        }
        const description =
          poll.summary ?? poll.description ?? "Cast your vote on VoxDex.";
        const imageUrl = `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(poll.title)}&subtitle=${encodeURIComponent("Opinion poll • Pick a side")}&badge=${encodeURIComponent("Opinion poll")}`;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=600");
        res.send(
          renderOgHtml({
            title: `${poll.title} • VoxDex`,
            description,
            canonicalUrl,
            imageUrl,
          }),
        );
      } catch (err: any) {
        console.error("[OG] Opinion poll render failed:", err?.message);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(
          renderOgHtml({
            title: SITE_NAME,
            description: DEFAULT_DESCRIPTION,
            canonicalUrl,
            imageUrl: `${SITE_URL}/api/og/image/default.png`,
          }),
        );
      }
    },
  );

  app.get(
    "/api/og/vote/polls/:slug.jpg",
    (req, res) => serveSentimentPollOgImage(req, res, "jpeg"),
  );

  app.get(
    "/api/og/vote/polls/:slug.png",
    (req, res) => serveSentimentPollOgImage(req, res, "png"),
  );

  app.get(
    "/api/og/vote/matchups/:slug.jpg",
    (req, res) => serveMatchupOgImage(req, res, "jpeg"),
  );

  app.get(
    "/api/og/vote/matchups/:slug.png",
    (req, res) => serveMatchupOgImage(req, res, "png"),
  );

  app.get("/api/og/matchups/:slug", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const canonicalUrl = `${SITE_URL}/vote/matchups/${encodeURIComponent(slug)}`;
    try {
      const ctx = await loadMatchupOgContext(slug);
      if (!ctx) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.send(
          renderOgHtml({
            title: SITE_NAME,
            description: DEFAULT_DESCRIPTION,
            canonicalUrl,
            imageUrl: `${SITE_URL}/api/og/image/default.png`,
          }),
        );
        return;
      }
      const prompt = matchupOgPromptTitle(ctx);
      const description = matchupOgDescription(ctx);
      const imageUrl = matchupOgImageUrl(ctx.slug);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.send(
        renderOgHtml({
          title: prompt,
          description,
          canonicalUrl,
          imageUrl,
          imageType: "image/jpeg",
        }),
      );
    } catch (err: any) {
      console.error("[OG] Matchup render failed:", err?.message);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        renderOgHtml({
          title: SITE_NAME,
          description: DEFAULT_DESCRIPTION,
          canonicalUrl,
          imageUrl: `${SITE_URL}/api/og/image/default.png`,
        }),
      );
    }
  });

  /* ─────────────────────────────────────────────────── sitemap.xml
   *
   * Search engines (Google, Bing) use sitemap.xml as their preferred
   * authoritative discovery surface. We include:
   *   - the static high-traffic pages
   *   - every OPEN community market (`/markets/:slug`)
   *   - every OPEN native market (so they get crawled while live)
   *
   * Lastmod is `endAt` for markets so once they close they drop out
   * of the next sitemap automatically. The 1-day cache keeps DB load
   * low — search engines re-fetch sitemaps on their own cadence
   * regardless of our TTL.
   */
  app.get("/api/sitemap.xml", async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const staticUrls: { loc: string; changefreq: string; priority: string }[] = [
        { loc: `${SITE_URL}/`, changefreq: "daily", priority: "1.0" },
        { loc: `${SITE_URL}/predict`, changefreq: "hourly", priority: "0.95" },
        { loc: `${SITE_URL}/vote`, changefreq: "daily", priority: "0.85" },
        {
          loc: `${SITE_URL}/predictions/leaderboard`,
          changefreq: "daily",
          priority: "0.7",
        },
        { loc: `${SITE_URL}/pricing`, changefreq: "weekly", priority: "0.6" },
        { loc: `${SITE_URL}/terms`, changefreq: "monthly", priority: "0.3" },
        { loc: `${SITE_URL}/privacy`, changefreq: "monthly", priority: "0.3" },
        {
          loc: `${SITE_URL}/refund-policy`,
          changefreq: "monthly",
          priority: "0.3",
        },
        { loc: `${SITE_URL}/contact`, changefreq: "yearly", priority: "0.3" },
      ];

      const openMarkets = await db
        .select({
          slug: predictionMarkets.slug,
          marketType: predictionMarkets.marketType,
          id: predictionMarkets.id,
          endAt: predictionMarkets.endAt,
        })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.status, "OPEN"),
            inArray(predictionMarkets.visibility, ["live"]),
            gt(predictionMarkets.endAt, now),
          ),
        )
        .orderBy(desc(predictionMarkets.endAt))
        .limit(5000);

      const marketUrls = openMarkets
        .map((m) => {
          const lastmod = m.endAt
            ? new Date(m.endAt).toISOString()
            : new Date().toISOString();
          if (m.marketType === "binary" || m.marketType === "multi" || m.marketType === "updown_open") {
            // Community markets are routed via slug; skip if missing.
            if (!m.slug) return null;
            return {
              loc: `${SITE_URL}/markets/${m.slug}`,
              lastmod,
              changefreq: "hourly",
              priority: "0.8",
            };
          }
          if (m.marketType === "updown") {
            return {
              loc: `${SITE_URL}/predict/updown/${m.id}`,
              lastmod,
              changefreq: "hourly",
              priority: "0.75",
            };
          }
          if (m.marketType === "h2h") {
            return {
              loc: `${SITE_URL}/predict/h2h/${m.id}`,
              lastmod,
              changefreq: "hourly",
              priority: "0.75",
            };
          }
          if (m.marketType === "gainer") {
            return {
              loc: `${SITE_URL}/predict/race/${m.id}`,
              lastmod,
              changefreq: "hourly",
              priority: "0.75",
            };
          }
          // jackpot is a section on /predict, already covered.
          return null;
        })
        .filter(
          (
            u,
          ): u is {
            loc: string;
            lastmod: string;
            changefreq: string;
            priority: string;
          } => Boolean(u),
        );

      /* Vote-section URLs. We treat anything with `visibility = 'live'`
       * as eligible — that's the same gate the public pages use to show
       * a poll/matchup, so the sitemap and the UI stay in sync. We
       * intentionally cap each table at 2000 to keep the document under
       * the 50MB / 50k-URL limit even on extreme growth. */
      const livePolls = await db
        .select({
          slug: trendingPolls.slug,
          updatedAt: trendingPolls.updatedAt,
        })
        .from(trendingPolls)
        .where(eq(trendingPolls.visibility, "live"))
        .orderBy(desc(trendingPolls.updatedAt))
        .limit(2000);

      const liveOpinionPolls = await db
        .select({
          slug: opinionPolls.slug,
          updatedAt: opinionPolls.updatedAt,
        })
        .from(opinionPolls)
        .where(eq(opinionPolls.visibility, "live"))
        .orderBy(desc(opinionPolls.updatedAt))
        .limit(2000);

      const liveMatchups = await db
        .select({
          slug: matchups.slug,
          createdAt: matchups.createdAt,
        })
        .from(matchups)
        .where(eq(matchups.visibility, "live"))
        .orderBy(desc(matchups.createdAt))
        .limit(2000);

      const voteUrls: { loc: string; lastmod: string; changefreq: string; priority: string }[] =
        [];
      for (const p of livePolls) {
        if (!p.slug) continue;
        voteUrls.push({
          loc: `${SITE_URL}/polls/${p.slug}`,
          lastmod: (p.updatedAt ?? new Date()).toISOString(),
          changefreq: "daily",
          priority: "0.7",
        });
      }
      for (const p of liveOpinionPolls) {
        if (!p.slug) continue;
        voteUrls.push({
          loc: `${SITE_URL}/vote/opinion-polls/${p.slug}`,
          lastmod: (p.updatedAt ?? new Date()).toISOString(),
          changefreq: "daily",
          priority: "0.7",
        });
      }
      for (const m of liveMatchups) {
        if (!m.slug) continue;
        voteUrls.push({
          loc: `${SITE_URL}/vote/matchups/${m.slug}`,
          lastmod: (m.createdAt ?? new Date()).toISOString(),
          changefreq: "daily",
          priority: "0.7",
        });
      }

      const xmlEntries = [
        ...staticUrls.map(
          (u) =>
            `  <url><loc>${escapeHtml(u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
        ),
        ...marketUrls.map(
          (u) =>
            `  <url><loc>${escapeHtml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
        ),
        ...voteUrls.map(
          (u) =>
            `  <url><loc>${escapeHtml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
        ),
      ];

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlEntries.join("\n")}
</urlset>`;

      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(xml);
    } catch (err: any) {
      console.error("[Sitemap] Render failed:", err?.message);
      res.status(500).send("sitemap render failed");
    }
  });

  /* robots.txt — point search engines at the sitemap. The site itself
   * is open, so the only directive is the sitemap reference. */
  app.get("/api/robots.txt", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  });
}
