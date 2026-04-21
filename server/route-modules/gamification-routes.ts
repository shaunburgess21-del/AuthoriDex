import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { xpActions } from "@shared/schema";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import { gamificationService } from "../services/gamification";

/**
 * Extracted read-only gamification endpoints from the main routes.ts monolith.
 *
 * NOTE: /api/gamification/stats remains in the main file because it has
 * side-effects (daily-login XP award + streak update) that are tightly
 * interwoven with scoring/analytics hooks we don't want to accidentally split.
 *
 * This module only handles simple, side-effect-free reads.
 */
export function registerGamificationRoutes(app: Express): void {
  // Check a specific capability permission for the authenticated user.
  app.get("/api/gamification/check-permission/:capability", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { capability } = req.params;
      const hasPermission = await gamificationService.checkPermission(req.userId!, capability as any);
      res.json({ capability, hasPermission });
    } catch (error: any) {
      console.error("Error checking permission:", error?.message);
      res.status(500).json({ error: "Failed to check permission" });
    }
  });

  // Recent XP ledger entries for the current user.
  app.get("/api/gamification/xp-history", requireAuth, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const history = await gamificationService.getXpHistory(req.userId!, limit);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching XP history:", error?.message);
      res.status(500).json({ error: "Failed to fetch XP history" });
    }
  });

  // Recent credit ledger entries for the current user.
  app.get("/api/gamification/credit-history", requireAuth, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const history = await gamificationService.getCreditHistory(req.userId!, limit);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching credit history:", error?.message);
      res.status(500).json({ error: "Failed to fetch credit history" });
    }
  });

  // Today's XP summary — used by UI to show remaining daily caps.
  app.get("/api/gamification/daily-summary", requireAuth, async (req: AuthRequest, res) => {
    try {
      const summary = await gamificationService.getDailyXpSummary(req.userId!);
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching daily summary:", error?.message);
      res.status(500).json({ error: "Failed to fetch daily summary" });
    }
  });

  // Public list of active XP actions (for displaying "how to earn XP" UI).
  app.get("/api/gamification/xp-actions", async (_req, res) => {
    try {
      const actions = await db.select().from(xpActions).where(eq(xpActions.isActive, true));
      res.json(actions);
    } catch (error: any) {
      console.error("Error fetching XP actions:", error?.message);
      res.status(500).json({ error: "Failed to fetch XP actions" });
    }
  });

  // Public rank ladder — single source of truth for client rank UI.
  // Served from the in-memory ranks cache on GamificationService (5-min TTL).
  app.get("/api/gamification/ranks", async (_req, res) => {
    try {
      const ranksList = await gamificationService.getRanks();
      res.json(ranksList);
    } catch (error: any) {
      console.error("Error fetching ranks:", error?.message);
      res.status(500).json({ error: "Failed to fetch ranks" });
    }
  });
}
