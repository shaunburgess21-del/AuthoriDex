import { eq, sql } from "drizzle-orm";
import {
  celebrityMetrics,
  inductionCandidates,
  trackedPeople,
  type InductionCandidate,
} from "@shared/schema";
import type { TrackedPerson } from "@shared/schema";
import { generateImageSlug } from "../lib/imageSlug";
import { db } from "../db";
import {
  buildTrackedPersonBackfillFromCandidate,
  isEmptyish,
} from "./induction-sync-build";

export { buildTrackedPersonBackfillFromCandidate, isEmptyish } from "./induction-sync-build";

type DbExecutor = typeof db;

export interface SyncInductionShadowResult {
  personId: string | null;
  created: boolean;
  updated: boolean;
}

/**
 * Copy induction_candidates metadata onto the matching tracked_people shadow row
 * (status = induction). Creates the shadow row with full metadata if missing.
 */
export async function syncInductionCandidateToShadowTrackedPerson(
  candidate: InductionCandidate,
  options: { executor?: DbExecutor; createIfMissing?: boolean } = {},
): Promise<SyncInductionShadowResult> {
  const executor = options.executor ?? db;
  const createIfMissing = options.createIfMissing ?? true;
  const name = candidate.displayName.trim();

  const [tp] = await executor
    .select()
    .from(trackedPeople)
    .where(eq(trackedPeople.name, name))
    .limit(1);

  if (tp) {
    if (tp.status !== "induction") {
      return { personId: tp.id, created: false, updated: false };
    }
    const backfill = buildTrackedPersonBackfillFromCandidate(tp, candidate);
    if (Object.keys(backfill).length > 0) {
      await executor.update(trackedPeople).set(backfill).where(eq(trackedPeople.id, tp.id));
      return { personId: tp.id, created: false, updated: true };
    }
    return { personId: tp.id, created: false, updated: false };
  }

  if (!createIfMissing) {
    return { personId: null, created: false, updated: false };
  }

  const imageSlug =
    (candidate.imageSlug?.trim() || generateImageSlug(name)) || null;

  const inserted = await executor
    .insert(trackedPeople)
    .values({
      name,
      category: candidate.category || "Other",
      status: "induction",
      imageSlug,
      wikiSlug: candidate.wikiSlug,
      xHandle: candidate.xHandle,
      instagramHandle: candidate.instagramHandle,
      tiktokHandle: candidate.tiktokHandle,
      youtubeId: candidate.youtubeId,
      spotifyId: candidate.spotifyId,
      searchQueryOverride: candidate.searchQueryOverride,
      googleTrendsTopicId: candidate.googleTrendsTopicId,
    })
    .onConflictDoNothing()
    .returning({ id: trackedPeople.id });

  if (inserted[0]) {
    await executor
      .insert(celebrityMetrics)
      .values({ celebrityId: inserted[0].id })
      .onConflictDoNothing();
    return { personId: inserted[0].id, created: true, updated: false };
  }

  const [existing] = await executor
    .select()
    .from(trackedPeople)
    .where(eq(trackedPeople.name, name))
    .limit(1);

  if (!existing) {
    return { personId: null, created: false, updated: false };
  }

  if (existing.status !== "induction") {
    return { personId: existing.id, created: false, updated: false };
  }

  const backfill = buildTrackedPersonBackfillFromCandidate(existing, candidate);
  if (Object.keys(backfill).length > 0) {
    await executor.update(trackedPeople).set(backfill).where(eq(trackedPeople.id, existing.id));
    return { personId: existing.id, created: false, updated: true };
  }

  return { personId: existing.id, created: false, updated: false };
}

export interface SyncTrackedToCandidateResult {
  candidateId: string | null;
  updated: boolean;
}

/**
 * When admin edits a tracked_people induction shadow, push social/wiki metadata
 * back to the matching induction_candidates row (source of truth for vote queue).
 */
export async function syncTrackedPersonToInductionCandidate(
  tp: TrackedPerson,
  options: { executor?: DbExecutor } = {},
): Promise<SyncTrackedToCandidateResult> {
  if (tp.status !== "induction") {
    return { candidateId: null, updated: false };
  }

  const executor = options.executor ?? db;
  const name = tp.name.trim();

  const [candidate] = await executor
    .select()
    .from(inductionCandidates)
    .where(
      sql`${inductionCandidates.displayName} = ${name} AND ${inductionCandidates.isActive} = true`,
    )
    .limit(1);

  if (!candidate) {
    return { candidateId: null, updated: false };
  }

  const updates: Record<string, unknown> = {};

  if (!isEmptyish(tp.wikiSlug) && tp.wikiSlug !== candidate.wikiSlug) {
    updates.wikiSlug = tp.wikiSlug;
  }
  if (!isEmptyish(tp.xHandle) && tp.xHandle !== candidate.xHandle) {
    updates.xHandle = tp.xHandle;
  }
  if (!isEmptyish(tp.instagramHandle) && tp.instagramHandle !== candidate.instagramHandle) {
    updates.instagramHandle = tp.instagramHandle;
  }
  if (!isEmptyish(tp.tiktokHandle) && tp.tiktokHandle !== candidate.tiktokHandle) {
    updates.tiktokHandle = tp.tiktokHandle;
  }
  if (!isEmptyish(tp.youtubeId) && tp.youtubeId !== candidate.youtubeId) {
    updates.youtubeId = tp.youtubeId;
  }
  if (!isEmptyish(tp.spotifyId) && tp.spotifyId !== candidate.spotifyId) {
    updates.spotifyId = tp.spotifyId;
  }
  if (
    !isEmptyish(tp.searchQueryOverride) &&
    tp.searchQueryOverride !== candidate.searchQueryOverride
  ) {
    updates.searchQueryOverride = tp.searchQueryOverride;
  }
  if (
    !isEmptyish(tp.googleTrendsTopicId) &&
    tp.googleTrendsTopicId !== candidate.googleTrendsTopicId
  ) {
    updates.googleTrendsTopicId = tp.googleTrendsTopicId;
  }
  if (tp.category && tp.category !== candidate.category) {
    updates.category = tp.category;
  }
  if (!isEmptyish(tp.imageSlug) && tp.imageSlug !== candidate.imageSlug) {
    updates.imageSlug = tp.imageSlug;
  }

  if (Object.keys(updates).length === 0) {
    return { candidateId: candidate.id, updated: false };
  }

  await executor
    .update(inductionCandidates)
    .set(updates)
    .where(eq(inductionCandidates.id, candidate.id));

  return { candidateId: candidate.id, updated: true };
}

/** Idempotent backfill for all candidates that have (or can get) an induction shadow. */
export async function backfillAllInductionShadowsFromCandidates(
  options: { executor?: DbExecutor } = {},
): Promise<{ processed: number; created: number; updated: number }> {
  const executor = options.executor ?? db;
  const candidates = await executor
    .select()
    .from(inductionCandidates)
    .where(eq(inductionCandidates.isActive, true));

  let processed = 0;
  let created = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const result = await syncInductionCandidateToShadowTrackedPerson(candidate, {
      executor,
      createIfMissing: true,
    });
    processed += 1;
    if (result.created) created += 1;
    if (result.updated) updated += 1;
  }

  return { processed, created, updated };
}

/**
 * Remove induction shadows that are not tied to an active vote-queue candidate.
 * When names is omitted, discovers all such rows (no candidate, inactive candidate, etc.).
 */
export async function removeOrphanInductionShadows(
  options: { executor?: DbExecutor; names?: string[] } = {},
): Promise<{ removed: number; names: string[] }> {
  const executor = options.executor ?? db;
  const removedNames: string[] = [];

  const orphans = options.names
    ? (
        await Promise.all(
          options.names.map(async (name) => {
            const [tp] = await executor
              .select({
                id: trackedPeople.id,
                name: trackedPeople.name,
                status: trackedPeople.status,
              })
              .from(trackedPeople)
              .where(eq(trackedPeople.name, name))
              .limit(1);
            return tp?.status === "induction" ? tp : null;
          }),
        )
      ).filter((r): r is NonNullable<typeof r> => r != null)
    : await executor
        .select({ id: trackedPeople.id, name: trackedPeople.name })
        .from(trackedPeople)
        .where(
          sql`${trackedPeople.status} = 'induction' AND NOT EXISTS (
            SELECT 1 FROM ${inductionCandidates}
            WHERE ${inductionCandidates.displayName} = ${trackedPeople.name}
              AND ${inductionCandidates.isActive} = true
          )`,
        );

  for (const tp of orphans) {
    if (options.names) {
      const [active] = await executor
        .select({ id: inductionCandidates.id })
        .from(inductionCandidates)
        .where(
          sql`${inductionCandidates.displayName} = ${tp.name} AND ${inductionCandidates.isActive} = true`,
        )
        .limit(1);
      if (active) continue;
    }

    await executor.delete(trackedPeople).where(eq(trackedPeople.id, tp.id));
    removedNames.push(tp.name);
  }

  return { removed: removedNames.length, names: removedNames };
}
