import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, withDbAdvisoryLock } from "../db";
import { inductionCandidates, inductionCycleResults, inductionVotes } from "@shared/schema";
import { approveInductionCandidate } from "../services/induction-service";
import {
  getMostRecentInductionClose,
  selectInductionWinner,
  type InductionWinnerCandidate,
} from "../utils/induction-cycle";

const INDUCTION_CYCLE_LOCK_KEY = 2_704_2026;

export type InductionCycleOutcome =
  | "inducted"
  | "already_processed"
  | "no_candidates"
  | "locked";

export interface InductionCycleResult {
  status: InductionCycleOutcome;
  weekCloseAt: string;
  candidateId?: string | null;
  displayName?: string | null;
  personId?: string | null;
  voteTotalAtClose?: number | null;
}

async function getActiveCandidateSnapshots(executor: any, weekCloseAt: Date): Promise<InductionWinnerCandidate[]> {
  const candidates = await executor
    .select({
      id: inductionCandidates.id,
      displayName: inductionCandidates.displayName,
      weightedScore: inductionCandidates.weightedScore,
    })
    .from(inductionCandidates)
    .where(eq(inductionCandidates.isActive, true))
    .orderBy(desc(inductionCandidates.weightedScore));

  if (candidates.length === 0) return [];

  // Roll back post-close votes by their captured curatorial weight so the
  // recorded winner reflects the weighted standing at the moment of close.
  const candidateIds = candidates.map((candidate: { id: string }) => candidate.id);
  const postCloseRows = await executor
    .select({
      candidateId: inductionVotes.candidateId,
      weight: sql<number>`COALESCE(SUM(${inductionVotes.weight}), 0)`,
    })
    .from(inductionVotes)
    .where(
      and(
        gt(inductionVotes.votedAt, weekCloseAt),
        inArray(inductionVotes.candidateId, candidateIds),
      ),
    )
    .groupBy(inductionVotes.candidateId);

  const postCloseWeightByCandidate = new Map<string, number>(
    postCloseRows.map((row: { candidateId: string; weight: number }) => [row.candidateId, Number(row.weight || 0)]),
  );

  return candidates.map((candidate: { id: string; displayName: string; weightedScore: number }) => ({
    id: candidate.id,
    displayName: candidate.displayName,
    weightedScore: Number(candidate.weightedScore || 0),
    postCloseWeight: postCloseWeightByCandidate.get(candidate.id) ?? 0,
  }));
}

export async function runWeeklyInductionCycle(now: Date = new Date()): Promise<InductionCycleResult> {
  const weekCloseAt = getMostRecentInductionClose(now);
  const lockResult = await withDbAdvisoryLock(INDUCTION_CYCLE_LOCK_KEY, "weekly induction", async () => {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(inductionCycleResults)
        .where(eq(inductionCycleResults.weekCloseAt, weekCloseAt))
        .limit(1);

      if (existing) {
        return {
          status: "already_processed" as const,
          weekCloseAt: weekCloseAt.toISOString(),
          candidateId: existing.candidateId,
          personId: existing.personId,
          voteTotalAtClose: existing.voteTotalAtClose,
        };
      }

      const winner = selectInductionWinner(await getActiveCandidateSnapshots(tx, weekCloseAt));
      if (!winner) {
        await tx.insert(inductionCycleResults).values({
          weekCloseAt,
          status: "no_candidates",
        });
        return {
          status: "no_candidates" as const,
          weekCloseAt: weekCloseAt.toISOString(),
          candidateId: null,
          personId: null,
          voteTotalAtClose: null,
        };
      }

      const approval = await approveInductionCandidate(winner.id, { executor: tx, runOnboarding: true });
      await tx.insert(inductionCycleResults).values({
        weekCloseAt,
        status: "inducted",
        candidateId: winner.id,
        personId: approval.personId,
        // Column is integer; weighted total can be fractional → round for the record.
        voteTotalAtClose: Math.round(winner.voteTotalAtClose),
      });

      return {
        status: "inducted" as const,
        weekCloseAt: weekCloseAt.toISOString(),
        candidateId: winner.id,
        displayName: winner.displayName,
        personId: approval.personId,
        voteTotalAtClose: winner.voteTotalAtClose,
      };
    });
  });

  if (!lockResult.acquired) {
    return { status: "locked", weekCloseAt: weekCloseAt.toISOString() };
  }

  return lockResult.result!;
}
