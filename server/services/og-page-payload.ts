/**
 * Shared Open Graph page payloads for crawler HTML and admin preview.
 * Keeps og-routes.ts and /api/admin/og-preview in sync.
 */

import { desc, eq } from "drizzle-orm";
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
import { matchupOgImagePath } from "@shared/matchup-og";
import { sentimentPollOgImagePath } from "@shared/sentiment-poll-og";
import { opinionPollOgImagePath } from "@shared/opinion-poll-og";
import { personOgImagePath } from "@shared/person-og";
import {
  loadMatchupOgContext,
  matchupOgDescription,
  matchupOgPromptTitle,
} from "./matchup-og-context";
import {
  loadSentimentPollOgContext,
  sentimentPollOgDescription,
} from "./sentiment-poll-og-context";
import {
  loadOpinionPollOgContext,
  opinionPollOgDescription,
} from "./opinion-poll-og-context";
import {
  loadPersonOgContext,
  personOgDescription,
} from "./person-og-context";
import { parseFilters, parseTab } from "@shared/insights/filters";
import {
  INSIGHTS_DIVERGENCE_LABELS,
  INSIGHTS_SOURCE_LABELS,
} from "@shared/insights/constants";

export const SITE_URL =
  process.env.PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://voxdex.com";
export const SITE_NAME = "VoxDex";
export const DEFAULT_DESCRIPTION =
  "VoxDex turns the voice of the people into a living, real-time index. Vote, predict, and weigh in on the figures and topics shaping global conversation. — make your voice heard, one vote at a time.";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgPagePayload {
  title: string;
  description: string;
  canonicalUrl: string;
  /** Omit to skip og:image / twitter:image (e.g. person not found). */
  imageUrl?: string;
  imageType?: string;
  twitterSite?: string;
}

export type OgEntityType =
  | "site"
  | "community_market"
  | "native_predict"
  | "sentiment_poll"
  | "opinion_poll"
  | "matchup"
  | "person"
  | "bet_share"
  | "insights"
  | "unknown";

export interface OgPreviewResult extends OgPagePayload {
  entityType: OgEntityType;
  entityLabel?: string;
  warnings: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOgHtml(p: OgPagePayload): string {
  const t = escapeHtml(p.title);
  const d = escapeHtml(p.description);
  const url = escapeHtml(p.canonicalUrl);
  const site = escapeHtml(p.twitterSite ?? "@voxdex");
  const imageBlock = p.imageUrl
    ? (() => {
        const img = escapeHtml(p.imageUrl);
        const imageTypeMeta = p.imageType
          ? `\n    <meta property="og:image:type" content="${escapeHtml(p.imageType)}" />`
          : "";
        const secureImageMeta = p.imageUrl!.startsWith("https://")
          ? `\n    <meta property="og:image:secure_url" content="${img}" />`
          : "";
        return `
    <meta property="og:image" content="${img}" />${imageTypeMeta}${secureImageMeta}
    <meta property="og:image:width" content="${OG_WIDTH}" />
    <meta property="og:image:height" content="${OG_HEIGHT}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${img}" />`;
      })()
    : `
    <meta name="twitter:card" content="summary" />`;
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
    <meta property="og:url" content="${url}" />${imageBlock}
    <meta name="twitter:site" content="${site}" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />

    <meta http-equiv="refresh" content="0; url=${url}" />
  </head>
  <body>
    <p>Redirecting to <a href="${url}">${url}</a>…</p>
    <script>window.location.replace(${JSON.stringify(p.canonicalUrl)});</script>
  </body>
</html>`;
}

export interface AmmPriceChip {
  label: string;
  pct: number;
  accent: "up" | "down" | "other";
}

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

function marketImageUrl(
  title: string,
  subtitle: string,
  badge: string,
  chips?: AmmPriceChip[],
): string {
  return `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(title)}&subtitle=${encodeURIComponent(subtitle)}&badge=${encodeURIComponent(badge)}${pricesParamFromChips(chips)}`;
}

function defaultImageUrl(): string {
  return `${SITE_URL}/api/og/image/default.png`;
}

function withPreviewMeta(
  payload: OgPagePayload,
  entityType: OgEntityType,
  entityLabel?: string,
  warnings: string[] = [],
): OgPreviewResult {
  return { ...payload, entityType, entityLabel, warnings };
}

function fallbackPayload(
  canonicalUrl: string,
  warning: string,
  entityType: OgEntityType = "unknown",
): OgPreviewResult {
  return withPreviewMeta(
    {
      title: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      canonicalUrl,
      imageUrl: defaultImageUrl(),
    },
    entityType,
    undefined,
    [warning],
  );
}

async function lookupCommunityMarket(slug: string) {
  const [m] = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      teaser: predictionMarkets.teaser,
      summary: predictionMarkets.summary,
      slug: predictionMarkets.slug,
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
      engine: predictionMarkets.engine,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, id))
    .limit(1);
  return m ?? null;
}

async function lookupLatestAmmPrices(marketId: string) {
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
    .limit(200);

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

async function lookupNativeEntries(id: string) {
  return db
    .select({ label: marketEntries.label })
    .from(marketEntries)
    .where(eq(marketEntries.marketId, id))
    .orderBy(marketEntries.displayOrder);
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

async function lookupBetForShare(betId: string) {
  const [row] = await db
    .select({
      betId: marketBets.id,
      marketId: marketBets.marketId,
      actionType: marketBets.actionType,
      status: marketBets.status,
      stakeAmount: marketBets.stakeAmount,
      potentialPayout: marketBets.potentialPayout,
      payoutAmount: marketBets.payoutAmount,
      shareCount: marketBets.shareCount,
      pricePerShare: marketBets.pricePerShare,
      marketTitle: predictionMarkets.title,
      marketSlug: predictionMarkets.slug,
      marketType: predictionMarkets.marketType,
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

function isBetSharePublic(bet: BetShareRow): boolean {
  if (!bet.ownerIsPublic) return false;
  const settled = new Set(["won", "lost", "refunded", "void"]);
  if (settled.has(bet.status)) return true;
  return Boolean(bet.ownerPositionsPublic);
}

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

function deriveBetShareCopy(bet: BetShareRow): {
  badge: string;
  title: string;
  subtitle: string;
} {
  const hero = bet.personName ?? bet.marketTitle ?? "VoxDex";
  const entryLabel = bet.entryLabel ?? "PICKED";

  if (bet.status === "won") {
    const stake = Number(bet.stakeAmount) || 0;
    const payout = Number(bet.payoutAmount) || 0;
    const pnl = Math.max(0, payout - stake);
    return {
      badge: "WON",
      title: hero,
      subtitle: `+${pnl.toLocaleString()} credits on "${bet.marketTitle}"`,
    };
  }
  if (bet.status === "lost") {
    const stake = Math.abs(Number(bet.stakeAmount) || 0);
    return {
      badge: "RESOLVED",
      title: hero,
      subtitle: `Backed ${entryLabel} · ${stake.toLocaleString()} cr on "${bet.marketTitle}"`,
    };
  }
  if (bet.status === "refunded" || bet.status === "void") {
    const stake = Math.abs(Number(bet.stakeAmount) || 0);
    return {
      badge: bet.status === "void" ? "VOID" : "REFUNDED",
      title: hero,
      subtitle: `Market ${bet.status === "void" ? "voided" : "refunded"} · ${stake.toLocaleString()} cr returned`,
    };
  }
  if (bet.actionType === "sell") {
    const shares = Number(bet.shareCount) || 0;
    const proceeds = Number(bet.payoutAmount) || 0;
    return {
      badge: "SOLD",
      title: hero,
      subtitle: `Sold ${Math.round(shares).toLocaleString()} ${entryLabel} shares · +${proceeds.toLocaleString()} cr`,
    };
  }
  if (bet.actionType === "buy") {
    const shares = Number(bet.shareCount) || 0;
    const pricePerShare = Number(bet.pricePerShare) || 0;
    const stake = Number(bet.stakeAmount) || 0;
    const payIfWin = Math.max(0, Math.floor(shares));
    const direction =
      entryLabel.toLowerCase() === "up" || entryLabel.toLowerCase() === "yes"
        ? "up"
        : entryLabel.toLowerCase() === "down" || entryLabel.toLowerCase() === "no"
          ? "down"
          : "other";
    return {
      badge: `BACKED ${direction === "other" ? entryLabel.toUpperCase() : direction.toUpperCase()}`,
      title: hero,
      subtitle: `${Math.round(shares).toLocaleString()} shares @ ${Math.round(pricePerShare * 100)}% · ${stake.toLocaleString()} cr in · pays ${payIfWin.toLocaleString()} if ${direction === "other" ? `${entryLabel} wins` : `${direction} wins`}`,
    };
  }
  const stake = Number(bet.stakeAmount) || 0;
  const payout = Number(bet.potentialPayout) || 0;
  return {
    badge: `BACKED ${entryLabel.toUpperCase()}`,
    title: hero,
    subtitle:
      payout > 0
        ? `${stake.toLocaleString()} cr backing ${entryLabel} · est. payout ${payout.toLocaleString()}`
        : `${stake.toLocaleString()} cr backing ${entryLabel}`,
  };
}

/** Normalize user input to a pathname (no query/hash). */
export function parseOgPreviewPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "/";
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const u = new URL(trimmed);
      return u.pathname || "/";
    }
  } catch {
    /* fall through */
  }
  return trimmed.startsWith("/") ? trimmed.split("?")[0].split("#")[0] : `/${trimmed}`;
}

export async function resolveCommunityMarketOg(slug: string): Promise<OgPreviewResult> {
  const canonicalUrl = `${SITE_URL}/markets/${encodeURIComponent(slug)}`;
  const market = await lookupCommunityMarket(slug);
  if (!market) {
    return fallbackPayload(canonicalUrl, "Community market not found — using generic preview.", "community_market");
  }

  let subtitle = "World market • Predict on VoxDex";
  let chips: AmmPriceChip[] | undefined;
  if (market.engine === "amm") {
    try {
      const prices = await lookupLatestAmmPrices(market.id);
      const enriched = buildAmmMarketCopy("community", prices);
      if (enriched) {
        subtitle = enriched.subtitle;
        chips = enriched.chips;
      }
    } catch {
      /* keep static subtitle */
    }
  }

  const description = market.teaser ?? market.summary ?? DEFAULT_DESCRIPTION;
  return withPreviewMeta(
    {
      title: `${market.title} • VoxDex`,
      description,
      canonicalUrl,
      imageUrl: marketImageUrl(market.title, subtitle, "World market", chips),
    },
    "community_market",
    market.title,
  );
}

export async function resolveNativePredictOg(
  type: string,
  marketId: string,
): Promise<OgPreviewResult> {
  const validTypes = new Set(["updown", "h2h", "race", "jackpot"]);
  const canonicalPath =
    type === "race"
      ? `/predict/race/${marketId}`
      : type === "h2h"
        ? `/predict/h2h/${marketId}`
        : type === "updown"
          ? `/predict/updown/${marketId}`
          : `/predict`;
  const canonicalUrl = `${SITE_URL}${canonicalPath}`;

  if (!validTypes.has(type)) {
    return fallbackPayload(canonicalUrl, "Unknown predict type — using generic preview.", "native_predict");
  }

  const market = await lookupNativeMarket(marketId);
  if (!market) {
    return fallbackPayload(canonicalUrl, "Native market not found — using generic preview.", "native_predict");
  }

  const ammPrices =
    market.engine === "amm" && type !== "jackpot"
      ? await lookupLatestAmmPrices(market.id).catch(() => [])
      : [];

  let cardTitle = SITE_NAME;
  let subtitle = DEFAULT_DESCRIPTION;
  let badge = "Predict";
  let chips: AmmPriceChip[] | undefined;

  if (type === "updown") {
    const personName = (await lookupPersonName(market.personId)) ?? "this person";
    cardTitle = `${personName}: Up or Down?`;
    const enriched = ammPrices.length > 0 ? buildAmmMarketCopy("updown", ammPrices, personName) : null;
    subtitle =
      enriched?.subtitle ??
      "Will their Trend Score close above or below the weekly baseline?";
    badge = "Up / Down";
    chips = enriched?.chips;
  } else if (type === "h2h") {
    const entries = await lookupNativeEntries(market.id);
    const a = entries[0]?.label ?? "Side A";
    const b = entries[1]?.label ?? "Side B";
    cardTitle = `${a} vs ${b}`;
    const enriched = ammPrices.length > 0 ? buildAmmMarketCopy("h2h", ammPrices) : null;
    subtitle =
      enriched?.subtitle ?? "Head-to-head: who'll gain more Trend Score points this week?";
    badge = "Head to head";
    chips = enriched?.chips;
  } else if (type === "race") {
    const categoryLabel = market.category ?? "Category Race";
    cardTitle = `${categoryLabel} Race`;
    const enriched =
      ammPrices.length > 0 ? buildAmmMarketCopy("gainer", ammPrices, null, categoryLabel) : null;
    subtitle = enriched?.subtitle ?? "Pick the biggest mover in the category this week.";
    badge = "Race";
    chips = enriched?.chips;
  } else {
    const personName = await lookupPersonName(market.personId);
    cardTitle = personName ? `${personName} Jackpot` : "Weekly Jackpot";
    subtitle = "Pick a Trend Score number, win the pool if you're closest.";
    badge = "Jackpot";
  }

  return withPreviewMeta(
    {
      title: `${cardTitle} • VoxDex`,
      description: subtitle,
      canonicalUrl,
      imageUrl: marketImageUrl(cardTitle, subtitle, badge, chips),
    },
    "native_predict",
    cardTitle,
  );
}

export async function resolveSiteOg(canonicalUrl = SITE_URL): Promise<OgPreviewResult> {
  return withPreviewMeta(
    {
      title: `${SITE_NAME} | Vox Populi - Indexed`,
      description: DEFAULT_DESCRIPTION,
      canonicalUrl,
      imageUrl: defaultImageUrl(),
    },
    "site",
    "Home",
  );
}

export async function resolveSentimentPollOg(slug: string): Promise<OgPreviewResult> {
  const canonicalUrl = `${SITE_URL}/polls/${encodeURIComponent(slug)}`;
  const ctx = await loadSentimentPollOgContext(slug);
  if (!ctx) {
    return fallbackPayload(canonicalUrl, "Sentiment poll not found — using generic preview.", "sentiment_poll");
  }
  return withPreviewMeta(
    {
      title: `${ctx.headline} • VoxDex`,
      description: sentimentPollOgDescription(ctx),
      canonicalUrl,
      imageUrl: `${SITE_URL}${sentimentPollOgImagePath(ctx.slug)}`,
      imageType: "image/jpeg",
    },
    "sentiment_poll",
    ctx.headline,
  );
}

export async function resolveOpinionPollOg(slug: string): Promise<OgPreviewResult> {
  const canonicalUrl = `${SITE_URL}/vote/opinion-polls/${encodeURIComponent(slug)}`;
  const ctx = await loadOpinionPollOgContext(slug);
  if (!ctx) {
    return fallbackPayload(canonicalUrl, "Opinion poll not found — using generic preview.", "opinion_poll");
  }
  return withPreviewMeta(
    {
      title: `${ctx.title} • VoxDex`,
      description: opinionPollOgDescription(ctx),
      canonicalUrl,
      imageUrl: `${SITE_URL}${opinionPollOgImagePath(ctx.slug)}`,
      imageType: "image/jpeg",
    },
    "opinion_poll",
    ctx.title,
  );
}

export async function resolveMatchupOg(slug: string): Promise<OgPreviewResult> {
  const canonicalUrl = `${SITE_URL}/vote/matchups/${encodeURIComponent(slug)}`;
  const ctx = await loadMatchupOgContext(slug);
  if (!ctx) {
    return fallbackPayload(canonicalUrl, "Matchup not found — using generic preview.", "matchup");
  }
  return withPreviewMeta(
    {
      title: matchupOgPromptTitle(ctx),
      description: matchupOgDescription(ctx),
      canonicalUrl,
      imageUrl: `${SITE_URL}${matchupOgImagePath(ctx.slug)}`,
      imageType: "image/jpeg",
    },
    "matchup",
    ctx.slug,
  );
}

export async function resolvePersonOg(id: string): Promise<OgPreviewResult> {
  const canonicalUrl = `${SITE_URL}/person/${encodeURIComponent(id)}`;
  const ctx = await loadPersonOgContext(id);
  if (!ctx) {
    return withPreviewMeta(
      {
        title: SITE_NAME,
        description: DEFAULT_DESCRIPTION,
        canonicalUrl,
      },
      "person",
      undefined,
      ["Person not found — omitting og:image (not the site default card)."],
    );
  }
  return withPreviewMeta(
    {
      title: `${ctx.name} • VoxDex`,
      description: personOgDescription(ctx),
      canonicalUrl,
      imageUrl: `${SITE_URL}${personOgImagePath(ctx.id)}`,
      imageType: "image/jpeg",
    },
    "person",
    ctx.name,
  );
}

export async function resolveBetShareOg(betId: string): Promise<OgPreviewResult> {
  const bet = await lookupBetForShare(betId);
  const canonicalUrl = bet ? canonicalMarketUrl(bet) : `${SITE_URL}/predict`;

  if (!bet || !isBetSharePublic(bet)) {
    return withPreviewMeta(
      {
        title: `${SITE_NAME} — Predict`,
        description: DEFAULT_DESCRIPTION,
        canonicalUrl,
        imageUrl: defaultImageUrl(),
      },
      "bet_share",
      betId,
      [
        !bet
          ? "Bet not found — using generic preview."
          : "Bet is private — using generic preview (canonical URL still points at market).",
      ],
    );
  }

  const copy = deriveBetShareCopy(bet);
  const previewTitle = bet.ownerUsername
    ? `[${copy.badge}] @${bet.ownerUsername} on ${copy.title}`
    : `[${copy.badge}] ${copy.title}`;

  return withPreviewMeta(
    {
      title: `${previewTitle} • VoxDex`,
      description: copy.subtitle,
      canonicalUrl,
      imageUrl: `${SITE_URL}/api/og/share/bet/${encodeURIComponent(betId)}.png`,
    },
    "bet_share",
    betId,
  );
}

function insightsImageUrl(
  variant: "default" | "rankings" | "discover",
  query: URLSearchParams,
): string {
  const qs = query.toString();
  const suffix = qs ? `?${qs}` : "";
  if (variant === "rankings") {
    return `${SITE_URL}/api/og/insights/rankings.png${suffix}`;
  }
  if (variant === "discover") {
    return `${SITE_URL}/api/og/insights/discover.png${suffix}`;
  }
  return `${SITE_URL}/api/og/insights.png`;
}

export function buildInsightsRankingsOgCopy(search: string): {
  title: string;
  subtitle: string;
} {
  const filters = parseFilters(search);
  const sourceLabel = INSIGHTS_SOURCE_LABELS[filters.source];
  const title = filters.category
    ? `${sourceLabel} · ${filters.category}`
    : `Rankings · ${sourceLabel}`;
  const subtitle = filters.favouritesOnly
    ? "Your favourites — VoxDex Insights"
    : "Live rankings & signal movers on VoxDex";
  return { title, subtitle };
}

export function buildInsightsDiscoverOgCopy(search: string): {
  title: string;
  subtitle: string;
} {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const type = params.get("type") ?? "";
  const title = type
    ? (INSIGHTS_DIVERGENCE_LABELS[type] ?? "Discover")
    : "Insights Discover";
  const subtitle = "Crowd vs data stories on VoxDex";
  return { title, subtitle };
}

export async function resolveInsightsOg(input: {
  pathname?: string;
  search?: string;
}): Promise<OgPreviewResult> {
  const pathname = input.pathname ?? "/insights";
  const rawSearch = input.search ?? "";
  const search = rawSearch.startsWith("?") ? rawSearch : rawSearch ? `?${rawSearch}` : "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tab = parseTab(params);
  const canonicalUrl = `${SITE_URL}${pathname}${search}`;

  if (tab === "discover") {
    const { title, subtitle } = buildInsightsDiscoverOgCopy(search);
    const imageParams = new URLSearchParams();
    const type = params.get("type");
    if (type) imageParams.set("type", type);
    return withPreviewMeta(
      {
        title: `${title} • VoxDex Insights`,
        description: subtitle,
        canonicalUrl,
        imageUrl: insightsImageUrl("discover", imageParams),
      },
      "insights",
      "discover",
    );
  }

  const { title, subtitle } = buildInsightsRankingsOgCopy(search);
  const imageParams = new URLSearchParams();
  for (const key of ["source", "category", "window", "fav"]) {
    const v = params.get(key);
    if (v) imageParams.set(key, v);
  }

  return withPreviewMeta(
    {
      title: `${title} • VoxDex Insights`,
      description: subtitle,
      canonicalUrl,
      imageUrl: insightsImageUrl(
        tab === "rankings" || params.get("source") ? "rankings" : "default",
        imageParams,
      ),
    },
    "insights",
    tab,
  );
}

/**
 * Resolve OG payload from a public SPA pathname or full URL.
 */
export async function resolveOgPagePayload(input: {
  url?: string;
  pathname?: string;
}): Promise<OgPreviewResult> {
  const pathname = input.pathname ?? parseOgPreviewPath(input.url ?? "/");

  if (pathname === "/" || pathname === "/predict") {
    const canonical = pathname === "/predict" ? `${SITE_URL}/predict` : SITE_URL;
    return resolveSiteOg(canonical);
  }

  const marketMatch = pathname.match(/^\/markets\/([^/]+)\/?$/);
  if (marketMatch) {
    return resolveCommunityMarketOg(decodeURIComponent(marketMatch[1]));
  }

  const updownMatch = pathname.match(/^\/predict\/updown\/([^/]+)\/?$/);
  if (updownMatch) {
    return resolveNativePredictOg("updown", decodeURIComponent(updownMatch[1]));
  }

  const h2hMatch = pathname.match(/^\/predict\/h2h\/([^/]+)\/?$/);
  if (h2hMatch) {
    return resolveNativePredictOg("h2h", decodeURIComponent(h2hMatch[1]));
  }

  const raceMatch = pathname.match(/^\/predict\/race\/([^/]+)\/?$/);
  if (raceMatch) {
    return resolveNativePredictOg("race", decodeURIComponent(raceMatch[1]));
  }

  const pollMatch = pathname.match(/^\/polls\/([^/]+)\/?$/);
  if (pollMatch) {
    return resolveSentimentPollOg(decodeURIComponent(pollMatch[1]));
  }

  const opinionMatch = pathname.match(/^\/vote\/opinion-polls\/([^/]+)\/?$/);
  if (opinionMatch) {
    return resolveOpinionPollOg(decodeURIComponent(opinionMatch[1]));
  }

  const matchupMatch = pathname.match(/^\/vote\/matchups\/([^/]+)\/?$/);
  if (matchupMatch) {
    return resolveMatchupOg(decodeURIComponent(matchupMatch[1]));
  }

  const personMatch = pathname.match(/^\/(?:person|celebrity)\/([^/]+)\/?$/);
  if (personMatch) {
    return resolvePersonOg(decodeURIComponent(personMatch[1]));
  }

  const betMatch = pathname.match(/^\/share\/bet\/([^/]+)\/?$/);
  if (betMatch) {
    return resolveBetShareOg(decodeURIComponent(betMatch[1]));
  }

  if (pathname === "/insights" || pathname === "/explore" || pathname.startsWith("/insights/")) {
    const search = input.url?.includes("?") ? input.url.slice(input.url.indexOf("?")) : "";
    return resolveInsightsOg({ pathname, search });
  }

  return fallbackPayload(
    pathname.startsWith("http") ? pathname : `${SITE_URL}${pathname}`,
    `Path "${pathname}" has no OG mapping — using generic site preview.`,
    "unknown",
  );
}
