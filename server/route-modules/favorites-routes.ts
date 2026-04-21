import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { trackedPeople, trendingPeople, userFavourites } from "@shared/schema";
import { requireAuth, type AuthRequest } from "../auth-middleware";

/**
 * Favorites CRUD extracted from the main routes.ts monolith.
 *
 * Endpoints:
 *   GET    /api/me/favorites             — list current user's favorites
 *   POST   /api/me/favorites/:personId   — add a favorite (idempotent)
 *   DELETE /api/me/favorites/:personId   — remove a favorite
 */
export function registerFavoritesRoutes(app: Express): void {
  app.get("/api/me/favorites", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      // Bound the query — the UI renders at most a few dozen favorites in the
      // favorites page, so 50 is a safe ceiling that avoids a runaway IN list.
      const userFavs = await db.select().from(userFavourites).where(eq(userFavourites.userId, userId)).limit(50);

      const favPersonIds = userFavs.map(f => f.personId);

      const [personRows, trendingRows] = favPersonIds.length > 0
        ? await Promise.all([
            db.select().from(trackedPeople).where(inArray(trackedPeople.id, favPersonIds)),
            db.select().from(trendingPeople).where(inArray(trendingPeople.id, favPersonIds)),
          ])
        : [[], []];

      const personMap = new Map(personRows.map(p => [p.id, p]));
      const trendingMap = new Map(trendingRows.map(t => [t.id, t]));

      const favoritesWithDetails = userFavs.map(fav => {
        const person = personMap.get(fav.personId);
        const trending = trendingMap.get(fav.personId);
        return {
          id: fav.id,
          celebrityId: fav.personId,
          name: person?.name || "Unknown",
          imageUrl: person?.avatar || null,
          category: person?.category || "Other",
          rank: trending?.rank || null,
          change: trending?.change24h || 0,
        };
      });

      res.json(favoritesWithDetails);
    } catch (error: any) {
      console.error("Error fetching user favorites:", error?.message);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });

  app.post("/api/me/favorites/:personId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { personId } = req.params;
      const { personName, personAvatar, personCategory } = req.body || {};

      let name = personName;
      let avatar = personAvatar;
      let category = personCategory;

      // Fall back to tracked_people metadata when the client didn't send us a
      // denormalised copy. Keeping denormalised copies on user_favourites
      // means favorites keep rendering even if a tracked person is later
      // deleted/renamed.
      if (!name) {
        const person = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personId)).limit(1);
        if (person[0]) {
          name = person[0].name;
          avatar = avatar ?? person[0].avatar;
          category = category ?? person[0].category;
        }
      }

      await db.insert(userFavourites).values({
        userId,
        personId,
        personName: name || "Unknown",
        personAvatar: avatar || null,
        personCategory: category || null,
      }).onConflictDoNothing();

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Error adding favorite:", error?.message);
      res.status(500).json({ error: "Failed to add favorite" });
    }
  });

  app.delete("/api/me/favorites/:personId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { personId } = req.params;

      await db.delete(userFavourites).where(
        and(eq(userFavourites.userId, userId), eq(userFavourites.personId, personId))
      );

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Error removing favorite:", error?.message);
      res.status(500).json({ error: "Failed to remove favorite" });
    }
  });
}
