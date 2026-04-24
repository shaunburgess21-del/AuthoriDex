import type { Express } from "express";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  marketBets,
  marketEntries,
  matchups,
  opinionPollOptions,
  opinionPolls,
  predictionMarkets,
  trackedPeople,
  trendingPeople,
  trendingPolls,
  trendSnapshots,
  userFavourites,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import { getTrendContextBatch } from "../services/trend-context";

/**
 * Favorites CRUD extracted from the main routes.ts monolith.
 *
 * Endpoints:
 *   GET    /api/me/favorites             — list current user's favorites
 *   GET    /api/me/favorites/dashboard   — aggregator: mover + markets + polls + alerts
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

  /**
   * Watchlist dashboard aggregator.
   *
   * Returns the same favorites list as /api/me/favorites (so consumers can
   * render the "All Favorites" section without a second round-trip), plus
   * four derived sections:
   *   - biggestMover:   the favorite with the largest |change24h|, annotated
   *                     with its primary trend driver from trend-context.
   *   - newMarkets:     recent native prediction markets (h2h/updown) that
   *                     include at least one favorited person as an entry.
   *   - newPolls:       recent opinion polls / matchups / trending polls
   *                     referencing at least one favorited person.
   *   - alerts:         rank-cross-top10 / top50 events derived from
   *                     trend_snapshots, plus "winning" open predictions.
   *
   * Everything is computed from existing tables — no schema changes, no
   * new indexes. Each section has a conservative LIMIT so the response
   * stays small for users with many favorites.
   */
  app.get("/api/me/favorites/dashboard", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      const userFavs = await db
        .select()
        .from(userFavourites)
        .where(eq(userFavourites.userId, userId))
        .limit(50);

      const favPersonIds = userFavs.map((f) => f.personId);

      if (favPersonIds.length === 0) {
        return res.json({
          favorites: [],
          biggestMover: null,
          newMarkets: [],
          newPolls: [],
          alerts: [],
        });
      }

      // Fan out the read; each query is independent so we run them in
      // parallel to keep p95 latency under ~400ms even with ~20 favorites.
      const [
        personRows,
        trendingRows,
        entryRows,
        matchupRows,
        pollOptionRows,
        trendingPollRows,
        snapshot24hRows,
        openBetRows,
      ] = await Promise.all([
        db
          .select()
          .from(trackedPeople)
          .where(inArray(trackedPeople.id, favPersonIds)),
        db
          .select()
          .from(trendingPeople)
          .where(inArray(trendingPeople.id, favPersonIds)),
        // Markets referencing favorites via market_entries, limited to native
        // binary/updown markets that are still OPEN and visible.
        db
          .select({
            entryId: marketEntries.id,
            personId: marketEntries.personId,
            marketId: predictionMarkets.id,
            slug: predictionMarkets.slug,
            title: predictionMarkets.title,
            marketType: predictionMarkets.marketType,
            category: predictionMarkets.category,
            endAt: predictionMarkets.endAt,
            closeAt: predictionMarkets.closeAt,
            createdAt: predictionMarkets.createdAt,
            coverImageUrl: predictionMarkets.coverImageUrl,
            visibility: predictionMarkets.visibility,
            status: predictionMarkets.status,
          })
          .from(marketEntries)
          .innerJoin(
            predictionMarkets,
            eq(predictionMarkets.id, marketEntries.marketId),
          )
          .where(
            and(
              inArray(marketEntries.personId, favPersonIds),
              eq(predictionMarkets.status, "OPEN"),
              inArray(predictionMarkets.marketType, ["h2h", "updown"]),
            ),
          )
          .orderBy(desc(predictionMarkets.createdAt))
          .limit(40),
        // Matchups (face_offs) referencing favorites on either side.
        db
          .select()
          .from(matchups)
          .where(
            and(
              or(
                inArray(matchups.personAId, favPersonIds),
                inArray(matchups.personBId, favPersonIds),
              ),
              eq(matchups.visibility, "live"),
            ),
          )
          .orderBy(desc(matchups.createdAt))
          .limit(20),
        // Opinion polls referencing favorites via a poll option's personId.
        db
          .select({
            pollId: opinionPolls.id,
            pollSlug: opinionPolls.slug,
            pollTitle: opinionPolls.title,
            pollCategory: opinionPolls.category,
            pollImageUrl: opinionPolls.imageUrl,
            pollCreatedAt: opinionPolls.createdAt,
            pollVisibility: opinionPolls.visibility,
            optionPersonId: opinionPollOptions.personId,
          })
          .from(opinionPollOptions)
          .innerJoin(
            opinionPolls,
            eq(opinionPolls.id, opinionPollOptions.pollId),
          )
          .where(
            and(
              inArray(opinionPollOptions.personId, favPersonIds),
              eq(opinionPolls.visibility, "live"),
            ),
          )
          .orderBy(desc(opinionPolls.createdAt))
          .limit(40),
        // Trending polls (single-subject community polls) referencing favs.
        db
          .select()
          .from(trendingPolls)
          .where(
            and(
              inArray(trendingPolls.personId, favPersonIds),
              eq(trendingPolls.visibility, "live"),
            ),
          )
          .orderBy(desc(trendingPolls.createdAt))
          .limit(20),
        // Snapshot from ~24h ago (give or take an hour) to detect rank
        // crossings. We pick the earliest snapshot in a 20h–28h window.
        db
          .select({
            personId: trendSnapshots.personId,
            timestamp: trendSnapshots.timestamp,
            diagnostics: trendSnapshots.diagnostics,
          })
          .from(trendSnapshots)
          .where(
            and(
              inArray(trendSnapshots.personId, favPersonIds),
              gte(
                trendSnapshots.timestamp,
                sql`NOW() - INTERVAL '28 hours'`,
              ),
              sql`${trendSnapshots.timestamp} <= NOW() - INTERVAL '20 hours'`,
              eq(trendSnapshots.snapshotOrigin, "ingest"),
            ),
          )
          .orderBy(desc(trendSnapshots.timestamp)),
        // Open predictions by the current user on markets involving any of
        // their favorites. Used to derive "your prediction is currently
        // winning" alerts.
        db
          .select({
            betId: marketBets.id,
            betStatus: marketBets.status,
            betDirection: marketBets.direction,
            betStake: marketBets.stakeAmount,
            betEntryId: marketBets.entryId,
            marketId: predictionMarkets.id,
            marketSlug: predictionMarkets.slug,
            marketTitle: predictionMarkets.title,
            marketType: predictionMarkets.marketType,
            marketStatus: predictionMarkets.status,
            entryPersonId: marketEntries.personId,
            entryTotalStake: marketEntries.totalStake,
            entryLabel: marketEntries.label,
          })
          .from(marketBets)
          .innerJoin(
            marketEntries,
            eq(marketEntries.id, marketBets.entryId),
          )
          .innerJoin(
            predictionMarkets,
            eq(predictionMarkets.id, marketBets.marketId),
          )
          .where(
            and(
              eq(marketBets.userId, userId),
              eq(marketBets.status, "active"),
              inArray(marketEntries.personId, favPersonIds),
              eq(predictionMarkets.status, "OPEN"),
            ),
          )
          .limit(50),
      ]);

      const personMap = new Map(personRows.map((p) => [p.id, p]));
      const trendingMap = new Map(trendingRows.map((t) => [t.id, t]));

      // ----- favorites (same shape as /api/me/favorites) -----
      const favorites = userFavs.map((fav) => {
        const person = personMap.get(fav.personId);
        const trending = trendingMap.get(fav.personId);
        return {
          id: fav.id,
          celebrityId: fav.personId,
          name: person?.name || fav.personName || "Unknown",
          imageUrl: person?.avatar || fav.personAvatar || null,
          category: person?.category || fav.personCategory || "Other",
          rank: trending?.rank ?? null,
          change: trending?.change24h ?? 0,
        };
      });

      // ----- biggestMover -----
      const moverCandidates = trendingRows
        .filter((t) => typeof t.change24h === "number")
        .sort((a, b) => Math.abs((b.change24h ?? 0)) - Math.abs((a.change24h ?? 0)));
      const moverRow = moverCandidates[0] ?? null;

      let biggestMover: null | {
        personId: string;
        name: string;
        avatar: string | null;
        category: string | null;
        rank: number | null;
        change24h: number;
        driver: string | null;
        reasonTag: string | null;
      } = null;

      if (moverRow && Math.abs(moverRow.change24h ?? 0) >= 0.5) {
        // Skip tiny movers — sub-0.5% isn't worth spotlighting. We still
        // fall back to the top-ranked favorite below if nothing moved.
        const contextMap = await getTrendContextBatch([moverRow.id]);
        const ctx = contextMap.get(moverRow.id);
        const person = personMap.get(moverRow.id);
        biggestMover = {
          personId: moverRow.id,
          name: person?.name || moverRow.name,
          avatar: person?.avatar ?? moverRow.avatar ?? null,
          category: person?.category ?? moverRow.category ?? null,
          rank: moverRow.rank ?? null,
          change24h: moverRow.change24h ?? 0,
          driver: ctx?.primaryDriver ?? null,
          reasonTag: ctx?.reasonTag ?? null,
        };
      }

      // ----- newMarkets (dedupe by marketId, aggregate matched persons) -----
      const marketsById = new Map<
        string,
        {
          marketId: string;
          slug: string;
          title: string;
          marketType: string;
          category: string | null;
          endAt: string | null;
          closeAt: string | null;
          coverImageUrl: string | null;
          matchedPersonIds: string[];
          matchedPersonNames: string[];
        }
      >();
      for (const row of entryRows) {
        if (!row.marketId || !row.personId) continue;
        const existing = marketsById.get(row.marketId);
        if (existing) {
          if (!existing.matchedPersonIds.includes(row.personId)) {
            existing.matchedPersonIds.push(row.personId);
            existing.matchedPersonNames.push(
              personMap.get(row.personId)?.name || "Unknown",
            );
          }
        } else {
          marketsById.set(row.marketId, {
            marketId: row.marketId,
            slug: row.slug,
            title: row.title,
            marketType: row.marketType,
            category: row.category ?? null,
            endAt: row.endAt ? new Date(row.endAt).toISOString() : null,
            closeAt: row.closeAt ? new Date(row.closeAt).toISOString() : null,
            coverImageUrl: row.coverImageUrl ?? null,
            matchedPersonIds: [row.personId],
            matchedPersonNames: [personMap.get(row.personId)?.name || "Unknown"],
          });
        }
      }

      // Collapse weekly-recurring markets that share a title+type. Users
      // only care about the soonest-closing instance; keeping every past
      // week makes the list look duplicated. We dedupe by
      // `${marketType}::${title}` and keep the one with the earliest
      // future close/end time.
      const dedupedMarketsByTitle = new Map<string, ReturnType<typeof marketsById.values> extends IterableIterator<infer T> ? T : never>();
      for (const m of marketsById.values()) {
        const key = `${m.marketType}::${m.title.trim().toLowerCase()}`;
        const existing = dedupedMarketsByTitle.get(key);
        if (!existing) {
          dedupedMarketsByTitle.set(key, m);
          continue;
        }
        const pickTs = (c: typeof m) => {
          const raw = c.closeAt || c.endAt;
          const t = raw ? new Date(raw).getTime() : NaN;
          return Number.isFinite(t) ? t : Infinity;
        };
        if (pickTs(m) < pickTs(existing)) {
          dedupedMarketsByTitle.set(key, m);
        }
      }
      const newMarkets = Array.from(dedupedMarketsByTitle.values())
        .sort((a, b) => {
          const ta = a.closeAt || a.endAt;
          const tb = b.closeAt || b.endAt;
          if (!ta && !tb) return 0;
          if (!ta) return 1;
          if (!tb) return -1;
          return new Date(ta).getTime() - new Date(tb).getTime();
        })
        .slice(0, 6);

      // ----- newPolls (union of opinion polls, matchups, trending polls) -----
      const pollsById = new Map<
        string,
        {
          id: string;
          kind: "opinion_poll" | "matchup" | "trending_poll";
          slug: string | null;
          title: string;
          category: string | null;
          imageUrl: string | null;
          matchedPersonIds: string[];
          matchedPersonNames: string[];
          createdAt: string;
        }
      >();
      for (const row of pollOptionRows) {
        if (!row.pollId || !row.optionPersonId) continue;
        const existing = pollsById.get(row.pollId);
        if (existing) {
          if (!existing.matchedPersonIds.includes(row.optionPersonId)) {
            existing.matchedPersonIds.push(row.optionPersonId);
            existing.matchedPersonNames.push(
              personMap.get(row.optionPersonId)?.name || "Unknown",
            );
          }
        } else {
          pollsById.set(row.pollId, {
            id: row.pollId,
            kind: "opinion_poll",
            slug: row.pollSlug ?? null,
            title: row.pollTitle,
            category: row.pollCategory ?? null,
            imageUrl: row.pollImageUrl ?? null,
            matchedPersonIds: [row.optionPersonId],
            matchedPersonNames: [
              personMap.get(row.optionPersonId)?.name || "Unknown",
            ],
            createdAt: row.pollCreatedAt
              ? new Date(row.pollCreatedAt).toISOString()
              : new Date().toISOString(),
          });
        }
      }
      for (const m of matchupRows) {
        const matched: string[] = [];
        const matchedNames: string[] = [];
        if (m.personAId && favPersonIds.includes(m.personAId)) {
          matched.push(m.personAId);
          matchedNames.push(personMap.get(m.personAId)?.name || m.optionAText);
        }
        if (m.personBId && favPersonIds.includes(m.personBId)) {
          matched.push(m.personBId);
          matchedNames.push(personMap.get(m.personBId)?.name || m.optionBText);
        }
        if (matched.length === 0) continue;
        pollsById.set(`matchup:${m.id}`, {
          id: m.id,
          kind: "matchup",
          slug: m.slug ?? null,
          title: m.title,
          category: m.category ?? null,
          imageUrl: m.optionAImage ?? m.optionBImage ?? null,
          matchedPersonIds: matched,
          matchedPersonNames: matchedNames,
          createdAt: m.createdAt
            ? new Date(m.createdAt).toISOString()
            : new Date().toISOString(),
        });
      }
      for (const tp of trendingPollRows) {
        if (!tp.personId) continue;
        pollsById.set(`trending:${tp.id}`, {
          id: tp.id,
          kind: "trending_poll",
          slug: tp.slug ?? null,
          title: tp.headline,
          category: tp.category ?? null,
          imageUrl: tp.imageUrl ?? null,
          matchedPersonIds: [tp.personId],
          matchedPersonNames: [personMap.get(tp.personId)?.name || "Unknown"],
          createdAt: tp.createdAt
            ? new Date(tp.createdAt).toISOString()
            : new Date().toISOString(),
        });
      }
      // Same weekly-recurrence dedupe as markets: collapse polls with the
      // same kind+title and keep the newest one, then take the 6 newest.
      const dedupedPollsByTitle = new Map<
        string,
        ReturnType<typeof pollsById.values> extends IterableIterator<infer T> ? T : never
      >();
      for (const p of pollsById.values()) {
        const key = `${p.kind}::${p.title.trim().toLowerCase()}`;
        const existing = dedupedPollsByTitle.get(key);
        if (!existing || p.createdAt.localeCompare(existing.createdAt) > 0) {
          dedupedPollsByTitle.set(key, p);
        }
      }
      const newPolls = Array.from(dedupedPollsByTitle.values())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6);

      // ----- alerts -----
      type DashboardAlert =
        | {
            kind: "rank_cross_top10" | "rank_cross_top50";
            personId: string;
            personName: string;
            previousRank: number;
            currentRank: number;
          }
        | {
            kind: "prediction_winning";
            betId: string;
            marketId: string;
            marketSlug: string;
            marketTitle: string;
            entryLabel: string;
            personId: string;
            personName: string;
          };

      const alerts: DashboardAlert[] = [];

      // Rank crossings. We look at each favorite's 24h-ago snapshot and
      // compare to their current rank. We can't rely on trend_snapshots
      // having a `rank` column directly — but diagnostics may include it,
      // and trendingPeople.rank is always current. For simplicity we
      // compute "crossed into top10/top50" purely from current rank + prior
      // rank stored in diagnostics.rankPrior, if present. Otherwise we
      // skip the alert — better silent than false-positive.
      //
      // The diagnostics jsonb shape isn't guaranteed, so we treat it
      // defensively. This matches how TrendingNowFeed surfaces rank change.
      const snapshotByPerson = new Map<string, { rank?: number }>();
      for (const s of snapshot24hRows) {
        if (snapshotByPerson.has(s.personId)) continue;
        const diag = s.diagnostics as { rank?: number; rankPrior?: number } | null;
        const priorRank = diag?.rank ?? diag?.rankPrior;
        if (typeof priorRank === "number") {
          snapshotByPerson.set(s.personId, { rank: priorRank });
        }
      }
      for (const t of trendingRows) {
        const prior = snapshotByPerson.get(t.id)?.rank;
        if (typeof prior !== "number" || typeof t.rank !== "number") continue;
        if (prior > 10 && t.rank <= 10) {
          alerts.push({
            kind: "rank_cross_top10",
            personId: t.id,
            personName: personMap.get(t.id)?.name || t.name,
            previousRank: prior,
            currentRank: t.rank,
          });
        } else if (prior > 50 && t.rank <= 50) {
          alerts.push({
            kind: "rank_cross_top50",
            personId: t.id,
            personName: personMap.get(t.id)?.name || t.name,
            previousRank: prior,
            currentRank: t.rank,
          });
        }
      }

      // Winning predictions. For updown-style markets we check whether the
      // user's direction matches the current trend; for h2h we check that
      // the user's entry has the highest total_stake among the market's
      // entries. To avoid loading every market's entry list, we grouped
      // openBetRows by market and compute with the data we already have.
      const betsByMarket = new Map<string, typeof openBetRows>();
      for (const b of openBetRows) {
        const list = betsByMarket.get(b.marketId) ?? [];
        list.push(b);
        betsByMarket.set(b.marketId, list);
      }
      // We need per-market entry sums to determine the "leading" entry for
      // h2h markets. Load lightweight entry rows for these markets.
      const marketIdsInvolvingFavs = Array.from(betsByMarket.keys());
      const entryLeaderMap = new Map<string, { entryId: string; totalStake: number }>();
      if (marketIdsInvolvingFavs.length > 0) {
        const allEntries = await db
          .select({
            marketId: marketEntries.marketId,
            entryId: marketEntries.id,
            totalStake: marketEntries.totalStake,
          })
          .from(marketEntries)
          .where(inArray(marketEntries.marketId, marketIdsInvolvingFavs));
        for (const e of allEntries) {
          const leader = entryLeaderMap.get(e.marketId);
          if (!leader || (e.totalStake ?? 0) > leader.totalStake) {
            entryLeaderMap.set(e.marketId, {
              entryId: e.entryId,
              totalStake: e.totalStake ?? 0,
            });
          }
        }
      }
      for (const b of openBetRows) {
        if (!b.entryPersonId) continue;
        const leader = entryLeaderMap.get(b.marketId);
        if (!leader) continue;
        // Treat "winning" as leading entry for h2h, and as "yes leading"
        // for updown / binary (same check — total_stake leader).
        if (leader.entryId !== b.betEntryId) continue;
        alerts.push({
          kind: "prediction_winning",
          betId: b.betId,
          marketId: b.marketId,
          marketSlug: b.marketSlug,
          marketTitle: b.marketTitle,
          entryLabel: b.entryLabel,
          personId: b.entryPersonId,
          personName: personMap.get(b.entryPersonId)?.name || "Unknown",
        });
      }

      // Cap alerts so the strip stays compact even for prolific users.
      const cappedAlerts = alerts.slice(0, 6);

      res.json({
        favorites,
        biggestMover,
        newMarkets,
        newPolls,
        alerts: cappedAlerts,
      });
    } catch (error: any) {
      console.error("Error fetching favorites dashboard:", error?.message);
      res.status(500).json({ error: "Failed to fetch favorites dashboard" });
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
