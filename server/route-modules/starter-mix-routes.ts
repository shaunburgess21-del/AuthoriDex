import type { Express } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { matchups, trendingPolls, opinionPolls } from "@shared/schema";
import { isCardVisibleToUser } from "@shared/geoVisibility";
import { optionalAuth, type AuthRequest } from "../auth-middleware";
import { resolveUserGeoContext } from "../lib/geoVisibility";

/**
 * Starter mix — heuristic, cross-type card sequence for the Quick Vote
 * onboarding overlay. Returns ordered *references* only ({ type, id, slug });
 * the client hydrates full card data from the existing list queries
 * (/api/matchups, /api/trending-polls, /api/opinion-polls) so votes cast in
 * the overlay share the same TanStack cache as the Vote hub.
 *
 * Heuristic (no schema/curation table yet — see plan Phase 2): per type,
 * featured first, then admin-ordered (display_order > 0) ahead of unordered,
 * then recency. Interleaved matchup → sentiment → opinion so a new visitor
 * sees variety; the FULL live catalog is returned (ids only — cheap) so the
 * overlay can be doomscrolled to the very last votable card. Only
 * anon-votable types are included by design.
 */

export type StarterMixItemType = "matchup" | "sentiment" | "opinion";

export interface StarterMixItem {
  type: StarterMixItemType;
  id: string;
  slug: string | null;
}

/** featured DESC, explicitly ordered first, admin order ASC, newest first. */
function heuristicOrder(table: {
  featured: any;
  displayOrder: any;
  createdAt: any;
}) {
  return [
    desc(table.featured),
    sql`CASE WHEN ${table.displayOrder} > 0 THEN 0 ELSE 1 END`,
    asc(table.displayOrder),
    desc(table.createdAt),
  ];
}

export function registerStarterMixRoutes(app: Express): void {
  app.get("/api/vote/starter-mix", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const [matchupRows, sentimentRows, opinionRows] = await Promise.all([
        db
          .select({
            id: matchups.id,
            slug: matchups.slug,
            visibleCountries: matchups.visibleCountries,
          })
          .from(matchups)
          .where(and(eq(matchups.visibility, "live"), eq(matchups.isActive, true)))
          .orderBy(...heuristicOrder(matchups)),
        db
          .select({
            id: trendingPolls.id,
            slug: trendingPolls.slug,
            visibleCountries: trendingPolls.visibleCountries,
          })
          .from(trendingPolls)
          .where(eq(trendingPolls.status, "live"))
          .orderBy(...heuristicOrder(trendingPolls)),
        db
          .select({
            id: opinionPolls.id,
            slug: opinionPolls.slug,
            visibleCountries: opinionPolls.visibleCountries,
          })
          .from(opinionPolls)
          .where(eq(opinionPolls.visibility, "live"))
          .orderBy(...heuristicOrder(opinionPolls)),
      ]);

      const geo = await resolveUserGeoContext(req);
      const geoFilter = <T extends { visibleCountries: string[] }>(rows: T[]) =>
        geo.bypass
          ? rows
          : rows.filter((r) => isCardVisibleToUser(r.visibleCountries, geo.residence));

      const pools: Array<{ type: StarterMixItemType; rows: Array<{ id: string; slug: string | null }> }> = [
        { type: "matchup", rows: geoFilter(matchupRows) },
        { type: "sentiment", rows: geoFilter(sentimentRows) },
        { type: "opinion", rows: geoFilter(opinionRows) },
      ];

      // Fixed interleave recipe (matchup, sentiment, opinion, repeat) until
      // every pool is exhausted — shorter pools simply drop out of the rotation.
      const data: StarterMixItem[] = [];
      const maxRounds = Math.max(...pools.map((p) => p.rows.length));
      for (let round = 0; round < maxRounds; round++) {
        for (const pool of pools) {
          const row = pool.rows[round];
          if (row) data.push({ type: pool.type, id: row.id, slug: row.slug ?? null });
        }
      }

      res.json({ data });
    } catch (error) {
      console.error("[starter-mix] list", error);
      res.status(500).json({ error: "Failed to load starter mix" });
    }
  });
}
