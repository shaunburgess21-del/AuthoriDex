import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { trendingPeople, celebrityMetrics, trackedPeople, inductionCandidates } from "@shared/schema";
/** Compact profile metrics mirrored on Voices profile link cards. */
export interface VoicesProfileStats {
  categoryRank: number | null;
  fameIndex: number | null;
  change24h: number | null;
  change7d: number | null;
  approvalAvgRating: number | null;
}

export const EMPTY_PROFILE_STATS: VoicesProfileStats = {
  categoryRank: null,
  fameIndex: null,
  change24h: null,
  change7d: null,
  approvalAvgRating: null,
};

/** Induction-queue preview for Voices profile link cards. */
export interface VoicesInductionPreview {
  inductionCandidateId: string | null;
  seedVotes: number;
}

/**
 * Batch-load induction-queue preview data for Voices profile cards.
 * Only returns entries for tracked_people shadows (status = induction).
 */
export async function loadInductionProfilePreview(
  personIds: string[],
): Promise<Map<string, VoicesInductionPreview>> {
  const out = new Map<string, VoicesInductionPreview>();
  if (personIds.length === 0) return out;

  const shadows = await db
    .select({
      id: trackedPeople.id,
      name: trackedPeople.name,
    })
    .from(trackedPeople)
    .where(and(inArray(trackedPeople.id, personIds), eq(trackedPeople.status, "induction")));

  if (shadows.length === 0) return out;

  const names = shadows.map((s) => s.name);
  const candidateRows = await db
    .select({
      id: inductionCandidates.id,
      displayName: inductionCandidates.displayName,
      seedVotes: inductionCandidates.seedVotes,
    })
    .from(inductionCandidates)
    .where(and(inArray(inductionCandidates.displayName, names), eq(inductionCandidates.isActive, true)));

  const candidateByName = new Map(
    candidateRows.map((c) => [c.displayName, { id: c.id, seedVotes: c.seedVotes }]),
  );

  for (const shadow of shadows) {
    const candidate = candidateByName.get(shadow.name);
    out.set(shadow.id, {
      inductionCandidateId: candidate?.id ?? null,
      seedVotes: candidate?.seedVotes ?? 0,
    });
  }

  return out;
}

/**
 * Batch-load profile stats for Voices profile link cards.
 * Main-leaderboard people get trend scores from `trending_people`; induction
 * shadows and other non-scored profiles still get an entry (approval when present).
 */
export async function loadPersonProfileStats(
  personIds: string[],
): Promise<Map<string, VoicesProfileStats>> {
  const out = new Map<string, VoicesProfileStats>();
  if (personIds.length === 0) return out;

  const rows = await db
    .select({
      id: trendingPeople.id,
      fameIndex: trendingPeople.fameIndex,
      change24h: trendingPeople.change24h,
      change7d: trendingPeople.change7d,
      approvalAvgRating: celebrityMetrics.approvalAvgRating,
    })
    .from(trendingPeople)
    .leftJoin(celebrityMetrics, eq(celebrityMetrics.celebrityId, trendingPeople.id))
    .where(inArray(trendingPeople.id, personIds));

  const rankById = new Map<string, number>();
  if (rows.length > 0) {
    const rankRows = await db.execute(sql`
      WITH ranked AS (
        SELECT ${trendingPeople.id} AS id,
          ROW_NUMBER() OVER (
            PARTITION BY ${trendingPeople.category}
            ORDER BY ${trendingPeople.fameIndex} DESC NULLS LAST, ${trendingPeople.name} ASC
          ) AS category_rank
        FROM ${trendingPeople}
      )
      SELECT id, category_rank FROM ranked
      WHERE id IN (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
    `);

    for (const row of rankRows.rows ?? []) {
      const id = String(row.id);
      const raw = row.category_rank ?? row.categoryRank;
      const n = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) rankById.set(id, n);
    }

    for (const r of rows) {
      out.set(r.id, {
        categoryRank: rankById.get(r.id) ?? null,
        fameIndex: r.fameIndex ?? null,
        change24h: r.change24h ?? null,
        change7d: r.change7d ?? null,
        approvalAvgRating: r.approvalAvgRating ?? null,
      });
    }
  }

  const missingIds = personIds.filter((id) => !out.has(id));
  if (missingIds.length > 0) {
    const metricsRows = await db
      .select({
        celebrityId: celebrityMetrics.celebrityId,
        approvalAvgRating: celebrityMetrics.approvalAvgRating,
      })
      .from(celebrityMetrics)
      .where(inArray(celebrityMetrics.celebrityId, missingIds));

    const approvalById = new Map(
      metricsRows.map((m) => [m.celebrityId, m.approvalAvgRating ?? null]),
    );

    for (const id of missingIds) {
      out.set(id, {
        ...EMPTY_PROFILE_STATS,
        approvalAvgRating: approvalById.get(id) ?? null,
      });
    }
  }

  return out;
}
