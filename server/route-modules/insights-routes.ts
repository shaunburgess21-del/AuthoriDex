import type { Express } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import {
  DEFAULT_INSIGHTS_FILTERS,
  parseFilters,
  INSIGHTS_SOURCE_VALUES,
} from "@shared/insights/filters";
import type { InsightsDivergenceType } from "@shared/insights/types";
import { optionalAuth, type AuthRequest } from "../auth-middleware";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { insightsEvents, userFavourites } from "@shared/schema";
import { loadInsightsRankings } from "../services/insights/rankings";
import { loadInsightsOverview } from "../services/insights/overview";
import { loadDivergence, loadSingleSourceSurge } from "../services/insights/discover";
import { loadDriversSummary } from "../services/insights/drivers";
import { getInsightsStory } from "../services/insights/story";
import { withDiscoverCache } from "../services/insights/discover-cache";
import { loadBreakoutRadar } from "../services/insights/breakout";
import { loadPolarisation } from "../services/insights/polarisation";
import { loadVolatility } from "../services/insights/volatility";
import { loadStreaks } from "../services/insights/streaks";
import { loadMostDiscussed } from "../services/insights/most-discussed";
import { loadCategoryHeatmap } from "../services/insights/category-heatmap";
import { loadMarketsAnalytics, loadBiggestMovers, loadPredictorDemographics } from "../services/insights/markets-analytics";
import {
  loadCrowdWebSentimentPage,
  WEB_SENTIMENT_DEFAULT_PAGE_SIZE,
} from "../services/insights/crowd-web-sentiment";

const insightsEventSchema = z.object({
  surface: z.string().min(1).max(64),
  action: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
});

const divergenceTypes = [
  "rising_disliked",
  "underrated_gaining",
  "overrated_cooling",
  "consensus",
  "press_loved_crowd_cool",
  "crowd_loved_press_critical",
] as const;

const insightsEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

function parseInsightsFiltersFromQuery(req: { query: Record<string, unknown> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string") params.set(key, value);
  }
  return parseFilters(params);
}

export function registerInsightsRoutes(app: Express): void {
  app.get("/api/insights/rankings", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const filters = parseInsightsFiltersFromQuery(req);
      const data = await loadInsightsRankings(filters, req.userId);
      res.json({ data });
    } catch (error) {
      console.error("[insights] rankings", error);
      res.status(500).json({ error: "Failed to load insights rankings" });
    }
  });

  app.get("/api/insights/overview", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const data = await loadInsightsOverview(req.userId);
      res.json({ data });
    } catch (error) {
      console.error("[insights] overview", error);
      res.status(500).json({ error: "Failed to load insights overview" });
    }
  });

  app.get("/api/insights/story", async (_req, res) => {
    try {
      const data = await getInsightsStory();
      res.json({ data });
    } catch (error) {
      console.error("[insights] story", error);
      res.status(500).json({ error: "Failed to load insights story" });
    }
  });

  app.get("/api/insights/drivers-summary", async (req, res) => {
    try {
      const topN = Math.min(Math.max(parseInt(String(req.query.topN ?? "20"), 10) || 20, 1), 50);
      const data = await loadDriversSummary(topN);
      res.json({ data });
    } catch (error) {
      console.error("[insights] drivers-summary", error);
      res.status(500).json({ error: "Failed to load drivers summary" });
    }
  });

  app.get("/api/insights/discover/divergence", async (req, res) => {
    try {
      const type = String(req.query.type ?? "") as InsightsDivergenceType;
      if (!divergenceTypes.includes(type as (typeof divergenceTypes)[number])) {
        return res.status(400).json({ error: "Invalid divergence type" });
      }
      const limit = Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 50);
      const data = await loadDivergence(type, limit);
      res.json({ data });
    } catch (error) {
      console.error("[insights] divergence", error);
      res.status(500).json({ error: "Failed to load divergence" });
    }
  });

  app.get("/api/insights/discover/single-source-surge", async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 50);
      const rows = await loadSingleSourceSurge(limit);
      res.json({ data: { rows, total: rows.length } });
    } catch (error) {
      console.error("[insights] single-source-surge", error);
      res.status(500).json({ error: "Failed to load single-source surge" });
    }
  });

  app.get("/api/insights/discover/breakout", async (_req, res) => {
    try {
      const data = await withDiscoverCache("breakout", loadBreakoutRadar);
      res.json({ data });
    } catch (error) {
      console.error("[insights] breakout", error);
      res.status(500).json({ error: "Failed to load breakout radar" });
    }
  });

  app.get("/api/insights/discover/polarisation", async (_req, res) => {
    try {
      const data = await withDiscoverCache("polarisation", loadPolarisation);
      res.json({ data });
    } catch (error) {
      console.error("[insights] polarisation", error);
      res.status(500).json({ error: "Failed to load polarisation" });
    }
  });

  app.get("/api/insights/discover/volatility", async (_req, res) => {
    try {
      const data = await withDiscoverCache("volatility", loadVolatility);
      res.json({ data });
    } catch (error) {
      console.error("[insights] volatility", error);
      res.status(500).json({ error: "Failed to load volatility" });
    }
  });

  app.get("/api/insights/discover/streaks", async (_req, res) => {
    try {
      const data = await withDiscoverCache("streaks", loadStreaks);
      res.json({ data });
    } catch (error) {
      console.error("[insights] streaks", error);
      res.status(500).json({ error: "Failed to load streaks" });
    }
  });

  app.get("/api/insights/discover/most-discussed", async (_req, res) => {
    try {
      const data = await withDiscoverCache("most-discussed", loadMostDiscussed);
      res.json({ data });
    } catch (error) {
      console.error("[insights] most-discussed", error);
      res.status(500).json({ error: "Failed to load most-discussed" });
    }
  });

  app.get("/api/insights/discover/category-heatmap", async (_req, res) => {
    try {
      const data = await withDiscoverCache("category-heatmap", loadCategoryHeatmap);
      res.json({ data });
    } catch (error) {
      console.error("[insights] category-heatmap", error);
      res.status(500).json({ error: "Failed to load category heatmap" });
    }
  });

  app.get("/api/insights/markets/analytics", async (_req, res) => {
    try {
      const data = await loadMarketsAnalytics();
      res.json({ data });
    } catch (error) {
      console.error("[insights] markets analytics", error);
      res.status(500).json({ error: "Failed to load markets analytics" });
    }
  });

  app.get("/api/insights/markets/movers", async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "6"), 10) || 6, 12);
      const data = await loadBiggestMovers(limit);
      res.json({ data });
    } catch (error) {
      console.error("[insights] markets movers", error);
      res.status(500).json({ error: "Failed to load market movers" });
    }
  });

  app.get("/api/insights/markets/demographics", async (_req, res) => {
    try {
      const data = await loadPredictorDemographics();
      res.json({ data });
    } catch (error) {
      console.error("[insights] markets demographics", error);
      res.status(500).json({ error: "Failed to load predictor demographics" });
    }
  });

  app.get("/api/insights/crowd/web-sentiment", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : "";
      const category =
        typeof req.query.category === "string" && req.query.category ? req.query.category : "all";
      const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? WEB_SENTIMENT_DEFAULT_PAGE_SIZE), 10) || WEB_SENTIMENT_DEFAULT_PAGE_SIZE, 1),
        100,
      );
      const offset = Math.max(parseInt(String(req.query.offset ?? 0), 10) || 0, 0);

      let favoriteIds = new Set<string>();
      if (category === "favorites" && req.userId) {
        const favRows = await db
          .select({ personId: userFavourites.personId })
          .from(userFavourites)
          .where(eq(userFavourites.userId, req.userId));
        favoriteIds = new Set(favRows.map((row) => row.personId).filter(Boolean));
      }

      const data = await loadCrowdWebSentimentPage({
        search,
        category,
        favoriteIds,
        sortDir,
        limit,
        offset,
      });
      res.json({ data });
    } catch (error) {
      console.error("[insights] crowd web-sentiment", error);
      res.status(500).json({ error: "Failed to load web sentiment leaderboard" });
    }
  });

  app.post("/api/insights/event", insightsEventLimiter, optionalAuth, async (req: AuthRequest, res) => {
    try {
      const parsed = insightsEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid event payload" });
      }
      await db.insert(insightsEvents).values({
        userId: req.userId ?? null,
        surface: parsed.data.surface,
        action: parsed.data.action,
        params: parsed.data.params ?? {},
      });
      res.status(204).send();
    } catch (error) {
      console.error("[insights] event", error);
      res.status(500).json({ error: "Failed to record event" });
    }
  });

  /** Meta: supported sources for Rankings pills */
  app.get("/api/insights/meta", (_req, res) => {
    res.json({
      data: {
        sources: INSIGHTS_SOURCE_VALUES,
        defaultFilters: DEFAULT_INSIGHTS_FILTERS,
      },
    });
  });
}
