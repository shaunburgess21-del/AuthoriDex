import { eq, sql } from "drizzle-orm";
import { celebrityMetrics, inductionCandidates, trackedPeople, trendingPeople } from "@shared/schema";
import { db } from "../db";
import { runPostInductionOnboarding } from "./induction-onboarding";

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

  const existingPerson = await executor
    .select({
      id: trackedPeople.id,
      imageSlug: trackedPeople.imageSlug,
      status: trackedPeople.status,
    })
    .from(trackedPeople)
    .where(eq(trackedPeople.name, candidate.displayName))
    .limit(1);

  let personId: string;

  if (existingPerson.length > 0) {
    personId = existingPerson[0].id;
    const backfillUpdates: Partial<{
      imageSlug: string | null;
      status: string;
    }> = {};

    if (!existingPerson[0].imageSlug && candidate.imageSlug) {
      backfillUpdates.imageSlug = candidate.imageSlug;
    }
    if (existingPerson[0].status !== "main_leaderboard") {
      backfillUpdates.status = "main_leaderboard";
    }
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
        name: candidate.displayName,
        category: candidate.category,
        imageSlug: candidate.imageSlug,
        wikiSlug: candidate.wikiSlug,
        xHandle: candidate.xHandle,
        displayOrder: (maxOrder[0]?.maxOrder || 0) + 1,
        status: "main_leaderboard",
      })
      .returning();
    personId = newPerson.id;

    await executor
      .insert(trendingPeople)
      .values({
        id: personId,
        name: candidate.displayName,
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
