import { eq, sql } from "drizzle-orm";
import { celebrityMetrics, inductionCandidates, trackedPeople, trendingPeople } from "@shared/schema";
import { db } from "../db";
import { runPostInductionOnboarding } from "./induction-onboarding";
import { buildTrackedPersonBackfillFromCandidate } from "./induction-sync-build";

type DbExecutor = any;

export interface ApproveInductionCandidateResult {
  personId: string;
  candidate: typeof inductionCandidates.$inferSelect;
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
