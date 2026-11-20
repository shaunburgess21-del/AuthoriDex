import type { QueryClient } from "@tanstack/react-query";

export const INDUCTION_VOTES_QUERY_KEY = ["/api/me/induction-votes"] as const;

export function withInductionVote(ids: readonly string[] | undefined, candidateId: string): string[] {
  const list = Array.isArray(ids) ? [...ids] : [];
  if (!list.includes(candidateId)) list.push(candidateId);
  return list;
}

export function mergeInductionVotedIds(
  serverIds: readonly string[] | undefined,
  pendingIds: ReadonlySet<string>,
): Set<string> {
  const merged = new Set(serverIds ?? []);
  pendingIds.forEach((id) => merged.add(id));
  return merged;
}

export function stageInductionVote(queryClient: QueryClient, candidateId: string): string[] | undefined {
  const previous = queryClient.getQueryData<string[]>(INDUCTION_VOTES_QUERY_KEY);
  queryClient.setQueryData<string[]>(
    INDUCTION_VOTES_QUERY_KEY,
    withInductionVote(previous, candidateId),
  );
  return previous;
}
