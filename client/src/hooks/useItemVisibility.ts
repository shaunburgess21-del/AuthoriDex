import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";

export type PrivacyItemType =
  | "matchup"
  | "sentiment"
  | "trending_poll"
  | "opinion_poll"
  | "image_curate"
  | "induction"
  | "value_vote"
  | "overall_rating"
  | "market_bet";

export interface ItemVisibilityVariables {
  itemType: PrivacyItemType;
  itemId: string;
  hidden: boolean;
}

interface ItemVisibilityContext {
  previousVotes: unknown;
  previousPredictions: unknown;
}

const VOTES_KEY_PREFIX = "/api/me/votes";
const PREDICTIONS_KEY = ["/api/me/predictions"] as const;

// Map a voteType (as returned by /api/me/votes) to its canonical PrivacyItemType.
export function voteTypeToPrivacyType(voteType: string): PrivacyItemType | null {
  switch (voteType) {
    case "face_off": return "matchup";
    case "sentiment": return "sentiment";
    case "value_vote": return "value_vote";
    case "trending_poll": return "trending_poll";
    case "opinion_poll": return "opinion_poll";
    case "image_curate": return "image_curate";
    case "induction": return "induction";
    case "overall_rating": return "overall_rating";
    default: return null;
  }
}

/**
 * Optimistically toggles an item's hidden flag in the React Query cache and
 * persists the change via PATCH /api/me/item-visibility. On error it rolls back
 * and surfaces a toast.
 */
export function useItemVisibility() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { hidden: boolean },
    Error,
    ItemVisibilityVariables,
    ItemVisibilityContext
  >({
    mutationFn: async ({ itemType, itemId, hidden }) => {
      const res = await apiRequest("PATCH", "/api/me/item-visibility", {
        itemType,
        itemId,
        hidden,
      });
      return res.json();
    },

    onMutate: async (variables) => {
      const { itemType, itemId, hidden } = variables;

      // Cancel in-flight refetches so they don't overwrite our optimistic update.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: [VOTES_KEY_PREFIX] }),
        queryClient.cancelQueries({ queryKey: PREDICTIONS_KEY }),
      ]);

      // Snapshot so we can roll back if the server rejects the change.
      const previousVotes = queryClient.getQueriesData({ queryKey: [VOTES_KEY_PREFIX] });
      const previousPredictions = queryClient.getQueryData(PREDICTIONS_KEY);

      // Votes cache — the API returns an array of UnifiedVote objects for every
      // active filter. Update all matching voteType variants in-place.
      if (itemType !== "market_bet") {
        queryClient.setQueriesData(
          { queryKey: [VOTES_KEY_PREFIX] },
          (old: unknown) => {
            if (!Array.isArray(old)) return old;
            return old.map((v: any) => {
              if (!v) return v;
              const vType = voteTypeToPrivacyType(String(v.voteType));
              if (vType === itemType && String(v.id) === itemId) {
                return { ...v, hidden };
              }
              return v;
            });
          },
        );
      }

      // Predictions cache — /api/me/predictions returns { predictions, stats }.
      if (itemType === "market_bet") {
        queryClient.setQueryData(PREDICTIONS_KEY, (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const current = old as { predictions?: any[]; stats?: unknown };
          if (!Array.isArray(current.predictions)) return old;
          return {
            ...current,
            predictions: current.predictions.map((p: any) =>
              p && String(p.betId) === itemId ? { ...p, hidden } : p,
            ),
          };
        });
      }

      return { previousVotes, previousPredictions };
    },

    onError: (_err, _variables, context) => {
      const votesSnapshot = context?.previousVotes;
      if (Array.isArray(votesSnapshot) && votesSnapshot.length > 0) {
        const entries = votesSnapshot as Array<[readonly unknown[], unknown]>;
        for (const [key, value] of entries) {
          queryClient.setQueryData(key, value);
        }
      }
      if (context?.previousPredictions !== undefined) {
        queryClient.setQueryData(PREDICTIONS_KEY, context.previousPredictions);
      }
      toast.error("Couldn't update visibility", {
        description: "Please try again in a moment.",
      });
    },

    // Scope the invalidation to the list that actually changed. Cross-invalidating
    // both caches after every mutation causes unnecessary refetches and can race
    // with a quick second click, producing spurious errors.
    onSettled: (_data, _error, variables) => {
      if (variables.itemType === "market_bet") {
        queryClient.invalidateQueries({ queryKey: PREDICTIONS_KEY });
      } else {
        queryClient.invalidateQueries({ queryKey: [VOTES_KEY_PREFIX] });
      }
    },
  });

  return mutation;
}
