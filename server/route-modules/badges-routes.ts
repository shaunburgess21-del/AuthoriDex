import type { Express } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { badges, profiles, userBadges } from "@shared/schema";
import {
  optionalAuth,
  requireAuth,
  type AuthRequest,
} from "../auth-middleware";

/**
 * User-facing badge endpoints.
 *
 *   GET /api/me/badges
 *     Returns every visible badge (visibleOnFrontend = true) joined
 *     with the authenticated user's user_badges row, so the client
 *     can render both earned and locked states from a single
 *     payload.
 *
 *   GET /api/users/:userId/badges
 *     Public profile companion. Returns ONLY earned badges for the
 *     given userId, and only if the target profile is public
 *     (`isPublic = true`). Anonymous callers are allowed
 *     (optionalAuth) — the gating decision is profile.isPublic, not
 *     the caller's auth state.
 *
 * Definitions are read live from the `badges` table so admin toggles
 * for visibleOnFrontend / isActive take effect without a redeploy.
 * Inactive rows are filtered out of both endpoints — a deactivated
 * badge should disappear from the catalogue even if some users hold
 * historical awards.
 */
export function registerBadgesRoutes(app: Express): void {
  app.get("/api/me/badges", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      // Single LEFT JOIN keeps the response ordering stable even for
      // users with zero earned badges. Earned info comes through the
      // join; null = locked.
      const rows = await db
        .select({
          key: badges.key,
          name: badges.name,
          description: badges.description,
          category: badges.category,
          rarity: badges.rarity,
          icon: badges.icon,
          sortOrder: badges.sortOrder,
          visibleOnFrontend: badges.visibleOnFrontend,
          earnedAt: userBadges.earnedAt,
          metadata: userBadges.metadata,
        })
        .from(badges)
        .leftJoin(
          userBadges,
          and(eq(userBadges.badgeKey, badges.key), eq(userBadges.userId, userId)),
        )
        .where(and(eq(badges.isActive, true), eq(badges.visibleOnFrontend, true)))
        .orderBy(asc(badges.category), asc(badges.sortOrder), asc(badges.key));

      const enriched = rows.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        category: r.category,
        rarity: r.rarity,
        icon: r.icon,
        sortOrder: r.sortOrder,
        visibleOnFrontend: r.visibleOnFrontend,
        earned: r.earnedAt !== null,
        earnedAt: r.earnedAt ? r.earnedAt.toISOString() : null,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      }));

      res.json(enriched);
    } catch (error: any) {
      console.error("[badges] /api/me/badges failed", error?.message);
      res.status(500).json({ error: "Failed to load badges" });
    }
  });

  app.get(
    "/api/users/:userId/badges",
    optionalAuth,
    async (req: AuthRequest, res) => {
      try {
        const { userId } = req.params;
        if (!userId) {
          return res.status(400).json({ error: "userId required" });
        }

        const [profile] = await db
          .select({ id: profiles.id, isPublic: profiles.isPublic })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1);

        if (!profile) {
          return res.status(404).json({ error: "Profile not found" });
        }
        // Caller is allowed to view their own badges even when
        // profile is private. Otherwise the public toggle gates
        // visibility.
        const isOwn = req.userId && req.userId === userId;
        if (!profile.isPublic && !isOwn) {
          return res.json([]);
        }

        const rows = await db
          .select({
            key: badges.key,
            name: badges.name,
            description: badges.description,
            category: badges.category,
            rarity: badges.rarity,
            icon: badges.icon,
            sortOrder: badges.sortOrder,
            visibleOnFrontend: badges.visibleOnFrontend,
            earnedAt: userBadges.earnedAt,
            metadata: userBadges.metadata,
          })
          .from(userBadges)
          .innerJoin(badges, eq(badges.key, userBadges.badgeKey))
          .where(
            and(
              eq(userBadges.userId, userId),
              eq(badges.isActive, true),
              eq(badges.visibleOnFrontend, true),
            ),
          )
          .orderBy(desc(userBadges.earnedAt));

        const enriched = rows.map((r) => ({
          key: r.key,
          name: r.name,
          description: r.description,
          category: r.category,
          rarity: r.rarity,
          icon: r.icon,
          sortOrder: r.sortOrder,
          visibleOnFrontend: r.visibleOnFrontend,
          earned: true,
          earnedAt: r.earnedAt ? r.earnedAt.toISOString() : null,
          metadata: (r.metadata as Record<string, unknown> | null) ?? null,
        }));

        res.json(enriched);
      } catch (error: any) {
        console.error(
          "[badges] /api/users/:userId/badges failed",
          error?.message,
        );
        res.status(500).json({ error: "Failed to load user badges" });
      }
    },
  );
}
