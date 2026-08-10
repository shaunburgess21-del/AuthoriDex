import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import type { CardReactionSurface, CardReactionType } from "@shared/constants";

/**
 * Card Like/Dislike ("More like this" / "Less like this") state for the
 * category-pill menu on Vote/Predict cards.
 *
 * One GET powers every pill on the page via the shared query cache; the
 * mutation patches that cache optimistically and rolls back on error
 * (modeled on useToggleMarketMute / useOpinionPollVoteMutation).
 */

export type CardReactionTarget = {
  surfaceType: CardReactionSurface;
  targetId: string;
};

type ReactionRow = {
  surfaceType: string;
  targetId: string;
  reaction: CardReactionType;
};

type ReactionsPayload = { data: ReactionRow[] };

const REACTIONS_KEY = ["/api/me/card-reactions"] as const;

export function cardReactionKey(target: CardReactionTarget): string {
  return `${target.surfaceType}:${target.targetId}`;
}

/** Map of `${surfaceType}:${targetId}` → current reaction for the signed-in user. */
export function useCardReactionsMap(): Map<string, CardReactionType> {
  const { user } = useAuth();
  const { data } = useQuery<ReactionsPayload>({
    queryKey: REACTIONS_KEY,
    enabled: !!user,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const map = new Map<string, CardReactionType>();
    for (const row of data?.data ?? []) {
      map.set(`${row.surfaceType}:${row.targetId}`, row.reaction);
    }
    return map;
  }, [data]);
}

export type CardReactionVariables = CardReactionTarget & {
  /** null clears the user's reaction (toggle off). */
  reaction: CardReactionType | null;
  /** Raw card category label — server normalises to a canonical id. */
  category?: string | null;
};

export function useCardReactionMutation() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, CardReactionVariables, { previous: unknown }>({
    mutationFn: async (variables) => {
      const res = await apiRequest("PUT", "/api/me/card-reactions", variables);
      return res.json();
    },

    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: REACTIONS_KEY });
      const previous = queryClient.getQueryData(REACTIONS_KEY);

      queryClient.setQueryData<ReactionsPayload>(REACTIONS_KEY, (old) => {
        const rows = (old?.data ?? []).filter(
          (r) => !(r.surfaceType === variables.surfaceType && r.targetId === variables.targetId),
        );
        if (variables.reaction) {
          rows.unshift({
            surfaceType: variables.surfaceType,
            targetId: variables.targetId,
            reaction: variables.reaction,
          });
        }
        return { data: rows };
      });

      return { previous };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(REACTIONS_KEY, context.previous);
      }
      toast.error("Couldn't save your preference", {
        description: "Please try again in a moment.",
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: REACTIONS_KEY });
    },
  });
}
