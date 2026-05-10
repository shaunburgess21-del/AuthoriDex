import type { Express, Request, Response } from "express";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db";
import {
  predictionMarkets,
  marketEntries,
  trendingPeople,
  trendingPolls,
  opinionPolls,
  matchups,
} from "@shared/schema";

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
  "Track how famous people are trending. Predict, vote, and win on real-world events.";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

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
  /** Absolute URL to the OG image PNG. */
  imageUrl: string;
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
    <meta property="og:image" content="${img}" />
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
 * Sharp can't render TTF text directly, but it DOES rasterize SVG, and
 * SVG `<text>` is faithfully rendered through the bundled fontconfig.
 * That's how we composite a brand-coloured 1200x630 PNG with the title
 * + subtitle overlaid for any market.
 *
 * We avoid loading external fonts (no asset path baked in to the docker
 * image is reliable across Railway + Vercel). The default fontconfig
 * sans-serif on Railway's Debian base is fine for our brand wordmark.
 *
 * Output is buffered, cached for 24h via Cache-Control, and tiny
 * (~30–60kb) since it's solid colours + text.
 */
function buildOgSvg(title: string, subtitle: string, badge: string): string {
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
        `<text x="80" y="${320 + i * 90}" fill="#ffffff" font-size="78" font-weight="700" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif">${escapeHtml(line)}</text>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
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

  <text x="80" y="170" fill="#a78bfa" font-size="32" font-weight="600" letter-spacing="6" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif">${escapeHtml(badge.toUpperCase())}</text>

  ${titleLines}

  <text x="80" y="540" fill="#cbd5e1" font-size="32" font-weight="500" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif">${escapeHtml(subtitle)}</text>

  <text x="${OG_WIDTH - 80}" y="170" fill="#ffffff" font-size="44" font-weight="700" text-anchor="end" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif">VoxDex</text>
  <text x="${OG_WIDTH - 80}" y="540" fill="#94a3b8" font-size="22" font-weight="500" text-anchor="end" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif">voxdex.com</text>
</svg>`;
}

async function renderOgImage(
  title: string,
  subtitle: string,
  badge: string,
): Promise<Buffer> {
  const svg = buildOgSvg(title, subtitle, badge);
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
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, id))
    .limit(1);
  return m ?? null;
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

async function lookupMatchup(slug: string) {
  const [m] = await db
    .select({
      id: matchups.id,
      title: matchups.title,
      description: matchups.description,
      optionAText: matchups.optionAText,
      optionBText: matchups.optionBText,
      optionAImage: matchups.optionAImage,
      optionBImage: matchups.optionBImage,
      category: matchups.category,
      slug: matchups.slug,
    })
    .from(matchups)
    .where(eq(matchups.slug, slug))
    .limit(1);
  return m ?? null;
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
  /* Default site OG image — used by the home page meta. Cached aggressively
   * since the brand wordmark doesn't change. */
  app.get("/api/og/image/default.png", async (_req: Request, res: Response) => {
    try {
      const png = await renderOgImage(
        "Vox Populi",
        "Track. Predict. Win.",
        "VoxDex",
      );
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
   * route, avoids a second DB lookup. */
  app.get("/api/og/image/market.png", async (req: Request, res: Response) => {
    try {
      const title = String(req.query.title ?? "VoxDex Market").slice(0, 80);
      const subtitle = String(req.query.subtitle ?? "Predict & win on VoxDex").slice(0, 80);
      const badge = String(req.query.badge ?? "Prediction").slice(0, 24);
      const png = await renderOgImage(title, subtitle, badge);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(png);
    } catch (err: any) {
      console.error("[OG] Market image render failed:", err?.message);
      res.status(500).send("og render failed");
    }
  });

  /* Community market OG HTML page. */
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

    const description =
      market.teaser ?? market.summary ?? DEFAULT_DESCRIPTION;
    const imageUrl = `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(market.title)}&subtitle=${encodeURIComponent("World market • Predict on VoxDex")}&badge=${encodeURIComponent("World market")}`;

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
      ) => {
        const imageUrl = `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(title)}&subtitle=${encodeURIComponent(subtitle)}&badge=${encodeURIComponent(badge)}`;
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

        if (type === "updown") {
          const personName =
            (await lookupPersonName(market.personId)) ?? "this person";
          fallback(
            `${personName}: Up or Down?`,
            "Will their Trend Score close above or below the weekly baseline?",
            "Up / Down",
          );
          return;
        }

        if (type === "h2h") {
          const entries = await lookupNativeEntries(market.id);
          const a = entries[0]?.label ?? "Side A";
          const b = entries[1]?.label ?? "Side B";
          fallback(
            `${a} vs ${b}`,
            "Head-to-head: who'll gain more Trend Score points this week?",
            "Head to head",
          );
          return;
        }

        if (type === "race") {
          const categoryLabel = market.category ?? "Category Race";
          fallback(
            `${categoryLabel} Race`,
            "Pick the biggest mover in the category this week.",
            "Race",
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
      const poll = await lookupSentimentPoll(slug);
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
        poll.description ?? poll.subjectText ?? "Cast your vote on VoxDex.";
      const imageUrl = `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(poll.headline)}&subtitle=${encodeURIComponent("Sentiment poll • Cast your vote")}&badge=${encodeURIComponent("Sentiment poll")}`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.send(
        renderOgHtml({
          title: `${poll.headline} • VoxDex`,
          description,
          canonicalUrl,
          imageUrl,
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

  app.get("/api/og/matchups/:slug", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const canonicalUrl = `${SITE_URL}/vote/matchups/${encodeURIComponent(slug)}`;
    try {
      const m = await lookupMatchup(slug);
      if (!m) {
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
      const subtitle = `${m.optionAText} vs ${m.optionBText}`;
      const description =
        m.description ??
        `Pick a side: ${m.optionAText} or ${m.optionBText}. Vote on VoxDex.`;
      const imageUrl = `${SITE_URL}/api/og/image/market.png?title=${encodeURIComponent(m.title)}&subtitle=${encodeURIComponent(subtitle)}&badge=${encodeURIComponent("Matchup")}`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.send(
        renderOgHtml({
          title: `${m.title} • VoxDex`,
          description,
          canonicalUrl,
          imageUrl,
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
