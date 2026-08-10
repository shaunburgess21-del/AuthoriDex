import type { Express } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { cardReactions, cardReactionUpsertSchema } from "@shared/schema";
import { normalizeMarketCategory } from "@shared/constants";
import { requireAuth, requireAdmin, type AuthRequest } from "../auth-middleware";
import { normaliseCategoryId, upsertEngagement } from "../lib/engagementWriter";

/**
 * Card Like/Dislike reactions ("More like this" / "Less like this" in the
 * category-pill menu on Vote/Predict cards).
 *
 * Endpoints:
 *   GET /api/me/card-reactions            — all reactions for the current user
 *   PUT /api/me/card-reactions            — upsert one reaction; reaction: null clears it
 *   GET /api/admin/card-reactions/summary — like/dislike counts per surface (analytics)
 *
 * Likes additionally feed user_category_engagement (fire-and-forget, weight of
 * one vote) so the existing interest-blend ranking benefits immediately.
 * Dislikes are stored only — consuming them in per-card ordering is phase 2.
 */
export function registerCardReactionsRoutes(app: Express): void {
  app.get("/api/me/card-reactions", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      // Cap generously above what the hubs render; one fetch powers every
      // pill menu on the page via the shared TanStack Query cache.
      const rows = await db
        .select({
          surfaceType: cardReactions.surfaceType,
          targetId: cardReactions.targetId,
          reaction: cardReactions.reaction,
        })
        .from(cardReactions)
        .where(eq(cardReactions.userId, userId))
        .orderBy(desc(cardReactions.updatedAt))
        .limit(500);
      res.json({ data: rows });
    } catch (error: any) {
      console.error("Error fetching card reactions:", error?.message);
      res.status(500).json({ error: "Failed to fetch card reactions" });
    }
  });

  app.put("/api/me/card-reactions", requireAuth, async (req: AuthRequest, res) => {
    try {
      const parsed = cardReactionUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid reaction payload" });
      }
      const userId = req.userId!;
      const { surfaceType, targetId, reaction, category } = parsed.data;

      if (reaction === null) {
        await db
          .delete(cardReactions)
          .where(
            and(
              eq(cardReactions.userId, userId),
              eq(cardReactions.surfaceType, surfaceType),
              eq(cardReactions.targetId, targetId),
            ),
          );
        return res.json({ data: { surfaceType, targetId, reaction: null } });
      }

      // Freeze the canonical category id at write time (may be null for
      // non-canonical/registry-only categories — that's fine, the engagement
      // writer skips those the same way it does for votes).
      const categoryId = category ? normaliseCategoryId(normalizeMarketCategory(category)) : null;

      await db
        .insert(cardReactions)
        .values({ userId, surfaceType, targetId, reaction, categoryId })
        .onConflictDoUpdate({
          target: [cardReactions.userId, cardReactions.surfaceType, cardReactions.targetId],
          set: {
            reaction,
            categoryId,
            updatedAt: sql`NOW()`,
          },
        });

      if (reaction === "like") {
        // Fire-and-forget: never blocks or fails the reaction write.
        void upsertEngagement({
          userId,
          categoryId,
          voteDelta: 1,
          source: "card-reaction-like",
        });
      }

      res.json({ data: { surfaceType, targetId, reaction } });
    } catch (error: any) {
      console.error("Error saving card reaction:", error?.message);
      res.status(500).json({ error: "Failed to save card reaction" });
    }
  });

  app.get(
    "/api/admin/card-reactions/summary",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const rows = await db
          .select({
            surfaceType: cardReactions.surfaceType,
            reaction: cardReactions.reaction,
            count: sql<number>`count(*)::int`,
            uniqueUsers: sql<number>`count(distinct ${cardReactions.userId})::int`,
          })
          .from(cardReactions)
          .where(gte(cardReactions.createdAt, since))
          .groupBy(cardReactions.surfaceType, cardReactions.reaction)
          .orderBy(cardReactions.surfaceType, cardReactions.reaction);
        res.json({ data: { days, rows } });
      } catch (error: any) {
        console.error("Error fetching card reaction summary:", error?.message);
        res.status(500).json({ error: "Failed to fetch card reaction summary" });
      }
    },
  );
}
