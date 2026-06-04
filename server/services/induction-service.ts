import { and, eq, sql } from "drizzle-orm";
import {
  adminAuditLog,
  celebrityMetrics,
  inductionCandidates,
  trackedPeople,
  trendingPeople,
} from "@shared/schema";
import { db } from "../db";
import { generateImageSlug } from "../lib/imageSlug";
import { runPostInductionOnboarding } from "./induction-onboarding";
import { syncTrackedPersonToInductionCandidate } from "./induction-sync";
import { buildTrackedPersonBackfillFromCandidate } from "./induction-sync-build";

type DbExecutor = any;

export interface ApproveInductionCandidateResult {
  personId: string;
  candidate: typeof inductionCandidates.$inferSelect;
  message: string;
}

export interface DemoteFromMainLeaderboardResult {
  personId: string;
  candidateId: string;
  createdCandidate: boolean;
  message: string;
}

export async function approveInductionCandidate(
  candidateId: string,
  options: { executor?: DbExecutor; runOnboarding?: boolean } = {},
): Promise<ApproveInductionCandidateResult> {
  const executor = options.executor ?? db;
  const runOnboarding = options.runOnboarding ?? true;

  const [candidate] = await executor
    .select()
    .from(inductionCandidates)
    .where(eq(inductionCandidates.id, candidateId))
    .limit(1);

  if (!candidate) {
    throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
  }

  const displayName = candidate.displayName.trim();

  const existingRows = await executor
    .select()
    .from(trackedPeople)
    .where(eq(trackedPeople.name, displayName))
    .limit(1);

  let personId: string;

  if (existingRows.length > 0) {
    const tp = existingRows[0];
    personId = tp.id;
    const backfillUpdates = buildTrackedPersonBackfillFromCandidate(tp, candidate, {
      promoteToMainLeaderboard: true,
    });

    if (Object.keys(backfillUpdates).length > 0) {
      await executor
        .update(trackedPeople)
        .set(backfillUpdates)
        .where(eq(trackedPeople.id, personId));
    }

    await executor
      .insert(trendingPeople)
      .values({
        id: personId,
        name: displayName,
        category: candidate.category,
        rank: 0,
        trendScore: 0,
        fameIndex: 0,
      })
      .onConflictDoNothing();
  } else {
    const maxOrder = await executor
      .select({ maxOrder: sql<number>`COALESCE(MAX(${trackedPeople.displayOrder}), 0)` })
      .from(trackedPeople);
    const [newPerson] = await executor
      .insert(trackedPeople)
      .values({
        name: displayName,
        category: candidate.category,
        imageSlug: candidate.imageSlug,
        wikiSlug: candidate.wikiSlug,
        xHandle: candidate.xHandle,
        instagramHandle: candidate.instagramHandle,
        tiktokHandle: candidate.tiktokHandle,
        youtubeId: candidate.youtubeId,
        spotifyId: candidate.spotifyId,
        searchQueryOverride: candidate.searchQueryOverride,
        googleTrendsTopicId: candidate.googleTrendsTopicId,
        displayOrder: (maxOrder[0]?.maxOrder || 0) + 1,
        status: "main_leaderboard",
      })
      .returning();
    personId = newPerson.id;

    await executor
      .insert(trendingPeople)
      .values({
        id: personId,
        name: displayName,
        category: candidate.category,
        rank: 0,
        trendScore: 0,
        fameIndex: 0,
      })
      .onConflictDoNothing();
  }

  await executor
    .insert(celebrityMetrics)
    .values({
      celebrityId: personId,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  await executor
    .update(inductionCandidates)
    .set({ isActive: false, inductionStatus: "Inducted" })
    .where(eq(inductionCandidates.id, candidateId));

  if (runOnboarding) {
    void runPostInductionOnboarding({
      personId,
      displayName: candidate.displayName,
      category: candidate.category,
      imageSlug: candidate.imageSlug,
    });
  }

  return { personId, candidate, message: "Candidate approved and added to leaderboard" };
}

/**
 * Move a main-leaderboard celebrity back to the active induction vote queue.
 * Preserves tracked_people id (trend history); removes public trending row immediately.
 */
export async function demoteFromMainLeaderboard(
  personId: string,
  options: { executor?: DbExecutor; adminId?: string } = {},
): Promise<DemoteFromMainLeaderboardResult> {
  const executor = options.executor ?? db;

  const [tp] = await executor
    .select()
    .from(trackedPeople)
    .where(eq(trackedPeople.id, personId))
    .limit(1);

  if (!tp) {
    throw Object.assign(new Error("Celebrity not found"), { statusCode: 404 });
  }
  if (tp.status !== "main_leaderboard") {
    throw Object.assign(
      new Error("Only main leaderboard celebrities can be demoted to the induction queue"),
      { statusCode: 409 },
    );
  }

  const displayName = tp.name.trim();
  let candidate!: typeof inductionCandidates.$inferSelect;
  let createdCandidate = false;

  await executor.transaction(async (tx: DbExecutor) => {
    await tx.delete(trendingPeople).where(eq(trendingPeople.id, personId));
    await tx
      .update(trackedPeople)
      .set({ status: "induction" })
      .where(eq(trackedPeople.id, personId));

    const [existingCandidate] = await tx
      .select()
      .from(inductionCandidates)
      .where(eq(inductionCandidates.displayName, displayName))
      .limit(1);

    if (existingCandidate) {
      const [updated] = await tx
        .update(inductionCandidates)
        .set({ isActive: true, inductionStatus: "Queue" })
        .where(eq(inductionCandidates.id, existingCandidate.id))
        .returning();
      candidate = updated!;
    } else {
      const imageSlug =
        (tp.imageSlug?.trim() || generateImageSlug(displayName)) || null;
      const [created] = await tx
        .insert(inductionCandidates)
        .values({
          displayName,
          category: tp.category,
          imageSlug,
          seedVotes: 0,
          wikiSlug: tp.wikiSlug,
          xHandle: tp.xHandle,
          instagramHandle: tp.instagramHandle,
          tiktokHandle: tp.tiktokHandle,
          youtubeId: tp.youtubeId,
          spotifyId: tp.spotifyId,
          searchQueryOverride: tp.searchQueryOverride,
          googleTrendsTopicId: tp.googleTrendsTopicId,
          inductionStatus: "Queue",
          isActive: true,
        })
        .returning();
      candidate = created!;
      createdCandidate = true;
    }
  });

  // Push current tracked_people metadata onto the vote-queue row (main-board
  // edits are newer than a stale Inducted candidate).
  const [tpAfter] = await executor
    .select()
    .from(trackedPeople)
    .where(eq(trackedPeople.id, personId))
    .limit(1);
  if (tpAfter) {
    await syncTrackedPersonToInductionCandidate(tpAfter, { executor });
  }

  if (options.adminId) {
    await executor.insert(adminAuditLog).values({
      adminId: options.adminId,
      adminEmail: null,
      actionType: "demote_to_induction",
      targetTable: "tracked_people",
      targetId: personId,
      previousData: { status: tp.status, name: tp.name },
      newData: {
        status: "induction",
        candidateId: candidate.id,
        createdCandidate,
      },
    });
  }

  return {
    personId,
    candidateId: candidate.id,
    createdCandidate,
    message: createdCandidate
      ? "Celebrity demoted; new induction candidate created"
      : "Celebrity demoted; induction candidate reactivated",
  };
}