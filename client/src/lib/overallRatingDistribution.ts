import type { QueryClient, QueryKey } from "@tanstack/react-query";

export interface RatingDistributionPerson {
  id: string;
  ratingDistribution?: number[] | null;
  userApprovalRating?: number | null;
  approvalVotesCount?: number | null;
  approvalAvgRating?: number | null;
}

function ratingBucket(rating: number | null | undefined): number | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  const bucket = Math.round(rating);
  if (bucket < 1 || bucket > 5) return null;
  return bucket;
}

/**
 * Community bars for one person, with the viewer's own rating applied.
 *
 * The list payload's distribution already includes `serverUserRating` when
 * that vote was saved before the fetch. Subtract it, then add the rating
 * the card is showing, so a brand-new vote moves the bars immediately and
 * a later refetch (which already includes the vote) is not counted twice.
 */
export function projectRatingDistribution(
  distribution: number[] | null | undefined,
  serverUserRating: number | null | undefined,
  localRating: number | null | undefined,
): number[] {
  const counts = distribution?.length === 5 ? [...distribution] : [0, 0, 0, 0, 0];
  const server = ratingBucket(serverUserRating);
  const local = ratingBucket(localRating);
  // No local override, or the payload already matches it: use the server bars.
  if (local == null || local === server) return counts;
  if (server != null) counts[server - 1] = Math.max(0, counts[server - 1] - 1);
  counts[local - 1] += 1;
  return counts;
}

export function ratingDistributionStats(counts: readonly number[]): {
  total: number;
  average: number | null;
} {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return { total: 0, average: null };
  const weighted = counts.reduce((sum, count, index) => sum + count * (index + 1), 0);
  return { total, average: weighted / total };
}

export function applyLocalRating<T extends RatingDistributionPerson>(person: T, localRating: number): T {
  const counts = projectRatingDistribution(
    person.ratingDistribution,
    person.userApprovalRating,
    localRating,
  );
  const { total, average } = ratingDistributionStats(counts);
  return {
    ...person,
    userApprovalRating: localRating,
    ratingDistribution: counts,
    approvalVotesCount: total,
    approvalAvgRating: average,
  };
}

function isOverallRatingsQuery(queryKey: QueryKey): boolean {
  return typeof queryKey[0] === "string" && queryKey[0].startsWith("/api/vote/overall-ratings");
}

interface OverallRatingsCache {
  data?: RatingDistributionPerson[];
}

export function snapshotOverallRatings(queryClient: QueryClient) {
  return queryClient.getQueriesData<OverallRatingsCache>({
    predicate: (query) => isOverallRatingsQuery(query.queryKey),
  });
}

export function restoreOverallRatings(
  queryClient: QueryClient,
  snapshot: Array<[QueryKey, OverallRatingsCache | undefined]>,
) {
  for (const [queryKey, data] of snapshot) {
    queryClient.setQueryData(queryKey, data);
  }
}

/** Patch every overall-ratings list cache so a remounted card sees the vote. */
export function patchOverallRatingsCache(queryClient: QueryClient, personId: string, rating: number) {
  queryClient.setQueriesData<OverallRatingsCache>(
    { predicate: (query) => isOverallRatingsQuery(query.queryKey) },
    (current) => {
      if (!current?.data) return current;
      let changed = false;
      const data = current.data.map((person) => {
        if (person.id !== personId) return person;
        changed = true;
        return applyLocalRating(person, rating);
      });
      return changed ? { ...current, data } : current;
    },
  );
}
