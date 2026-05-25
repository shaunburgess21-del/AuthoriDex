/** DB-backed induction avatar enrichment; re-exports URL helpers for OG and other callers. */

import { inArray } from "drizzle-orm";
import { db } from "../db";
import { trackedPeople } from "@shared/schema";
import {
  buildTrackedByNameForInduction,
  inductionCandidateNameKey,
  resolveInductionCandidateAvatar,
  type TrackedRowForInductionAvatar,
} from "./induction-avatar-resolution";

export type {
  TrackedRowForInductionAvatar,
} from "./induction-avatar-resolution";
export {
  buildTrackedByNameForInduction,
  inductionCandidateNameKey,
  resolveInductionCandidateAvatar,
} from "./induction-avatar-resolution";
export {
  personConventionImageUrl,
  resolvePersonAvatarUrl,
  resolvePersonAvatarCandidates,
} from "./person-avatar-urls";

export type InductionCandidateAvatarInput = {
  displayName: string;
  imageSlug: string | null;
};

export async function enrichInductionCandidatesWithAvatars<T extends InductionCandidateAvatarInput>(
  candidates: T[],
): Promise<(T & { avatar: string | null })[]> {
  if (candidates.length === 0) return [];

  const candidateNames = Array.from(
    new Set(candidates.map((c) => c.displayName.trim()).filter(Boolean)),
  );

  const trackedRows: TrackedRowForInductionAvatar[] = candidateNames.length
    ? await db
        .select({
          name: trackedPeople.name,
          avatar: trackedPeople.avatar,
          imageSlug: trackedPeople.imageSlug,
          status: trackedPeople.status,
        })
        .from(trackedPeople)
        .where(inArray(trackedPeople.name, candidateNames))
    : [];

  const trackedByName = buildTrackedByNameForInduction(trackedRows);

  return candidates.map((candidate) => {
    const tracked = trackedByName.get(inductionCandidateNameKey(candidate.displayName));
    return {
      ...candidate,
      avatar: resolveInductionCandidateAvatar(tracked, candidate.imageSlug),
    };
  });
}
