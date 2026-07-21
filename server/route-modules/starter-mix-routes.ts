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
 * sees variety. Only anon-votable types are included by design.
 */

export type StarterMixItemType = "matchup" | "sentiment" | "opinion";

export interface StarterMixItem {
  type: StarterMixItemType;
  id: string;
  slug: string | null;
}

const PER_TYPE_FETCH = 24;
const PER_TYPE_TAKE = 4;

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
          .orderBy(...heuristicOrder(matchups))
          .limit(PER_TYPE_FETCH),
        db
          .select({
            id: trendingPolls.id,
            slug: trendingPolls.slug,
            visibleCountries: trendingPolls.visibleCountries,
          })
          .from(trendingPolls)
          .where(eq(trendingPolls.status, "live"))
          .orderBy(...heuristicOrder(trendingPolls))
          .limit(PER_TYPE_FETCH),
        db
          .select({
            id: opinionPolls.id,
            slug: opinionPolls.slug,
            visibleCountries: opinionPolls.visibleCountries,
          })
          .from(opinionPolls)
          .where(eq(opinionPolls.visibility, "live"))
          .orderBy(...heuristicOrder(opinionPolls))
          .limit(PER_TYPE_FETCH),
      ]);

      const geo = await resolveUserGeoContext(req);
      const geoFilter = <T extends { visibleCountries: string[] }>(rows: T[]) =>
        geo.bypass
          ? rows
          : rows.filter((r) => isCardVisibleToUser(r.visibleCountries, geo.residence));

      const pools: Array<{ type: StarterMixItemType; rows: Array<{ id: string; slug: string | null }> }> = [
        { type: "matchup", rows: geoFilter(matchupRows).slice(0, PER_TYPE_TAKE) },
        { type: "sentiment", rows: geoFilter(sentimentRows).slice(0, PER_TYPE_TAKE) },
        { type: "opinion", rows: geoFilter(opinionRows).slice(0, PER_TYPE_TAKE) },
      ];

      // Fixed interleave recipe: matchup, sentiment, opinion, repeat.
      const data: StarterMixItem[] = [];
      for (let round = 0; round < PER_TYPE_TAKE; round++) {
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
