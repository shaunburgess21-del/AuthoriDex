import { resolvePersonAvatarUrl } from "./person-avatar-urls";

export type TrackedRowForInductionAvatar = {
  name: string;
  avatar: string | null;
  imageSlug: string | null;
  status: string;
};

export function inductionCandidateNameKey(displayName: string): string {
  return displayName.trim().toLowerCase();
}

/** Prefer `status === 'induction'` when multiple tracked rows share a display name key. */
export function buildTrackedByNameForInduction(
  rows: TrackedRowForInductionAvatar[],
): Map<string, TrackedRowForInductionAvatar> {
  const map = new Map<string, TrackedRowForInductionAvatar>();
  for (const row of rows) {
    const key = inductionCandidateNameKey(row.name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    if (existing.status !== "induction" && row.status === "induction") {
      map.set(key, row);
    }
  }
  return map;
}

export function resolveInductionCandidateAvatar(
  tracked: TrackedRowForInductionAvatar | undefined,
  candidateImageSlug: string | null | undefined,
): string | null {
  return resolvePersonAvatarUrl(tracked?.avatar ?? null, candidateImageSlug);
}
