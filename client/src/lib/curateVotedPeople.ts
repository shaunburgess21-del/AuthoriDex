import { queryClient } from "@/lib/queryClient";

/** Person ids the signed-in user has an image vote on. Curate list payload has no voted flag. */
export const CURATE_VOTED_PERSONS_KEY = ["/api/me/curate-voted-person-ids"] as const;

export interface CurateVotedPersonsResponse {
  data: string[];
}

/** Optimistic insert after a successful curate vote, then refetch to confirm. */
export function rememberCuratePersonVoted(personId: string): void {
  void queryClient.cancelQueries({ queryKey: CURATE_VOTED_PERSONS_KEY });
  queryClient.setQueryData<CurateVotedPersonsResponse>(CURATE_VOTED_PERSONS_KEY, (current) => {
    const ids = new Set(current?.data ?? []);
    ids.add(personId);
    return { data: [...ids] };
  });
  void queryClient.invalidateQueries({ queryKey: CURATE_VOTED_PERSONS_KEY });
}
