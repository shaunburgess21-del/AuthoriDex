import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CardReactionSurface } from "@shared/constants";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import {
  HIDDEN_CARDS_QUERY_KEY,
  feedPrefixesFor,
  invalidateHiddenCardQueries,
  restoreFeedCaches,
  snapshotFeedCaches,
  stripCardFromFeedCaches,
  type FeedCacheSnapshot,
} from "@/lib/hiddenCardCache";

export interface HideCardTarget {
  cardType: CardReactionSurface;
  cardId: string;
}

interface HiddenCardsResponse {
  data?: HiddenCardKeyRow[];
}

function isHiddenCardsUnavailable(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 503) return true;
  const message = error instanceof Error ? error.message : "";
  return message.includes("hidden_cards_unavailable");
}

function toastHideError(error: unknown, action: "hide" | "unhide"): void {
  if (isHiddenCardsUnavailable(error)) {
    toast.error("Hiding cards isn't available yet", {
      description: "This will work once the latest update is finished.",
    });
    return;
  }
  toast.error(action === "hide" ? "Couldn't hide that card" : "Couldn't restore that card", {
    description: "Please try again.",
  });
}

async function cancelFeedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  cardType: CardReactionSurface,
): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: HIDDEN_CARDS_QUERY_KEY }),
    ...feedPrefixesFor(cardType).map((prefix) =>
      queryClient.cancelQueries({ queryKey: [...prefix] }),
    ),
  ]);
}

interface HiddenCardKeyRow {
  cardType: string;
  cardId: string;
}

/** Keys the signed-in user has hidden. Empty when signed out or still loading. */
export function useHiddenCardKeySet(): ReadonlySet<string> {
  const { user } = useAuth();
  const { data } = useQuery<HiddenCardsResponse>({
    queryKey: HIDDEN_CARDS_QUERY_KEY,
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/hidden-cards");
      return res.json();
    },
  });
  return useMemo(() => {
    const keys = new Set<string>();
    for (const row of data?.data ?? []) {
      keys.add(`${row.cardType}:${row.cardId}`);
    }
    return keys;
  }, [data]);
}

/** Hide one card, drop it from the cached feeds, and offer Undo. */
export function useHideCard() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, HideCardTarget, { snapshots: FeedCacheSnapshot[] }>({
    mutationFn: async (variables) => {
      const res = await apiRequest("POST", "/api/me/hidden-cards", variables);
      return res.json();
    },
    onMutate: async (variables) => {
      await cancelFeedQueries(queryClient, variables.cardType);
      const snapshots = snapshotFeedCaches(queryClient, variables.cardType);
      stripCardFromFeedCaches(queryClient, variables.cardType, variables.cardId);
      queryClient.setQueryData<HiddenCardsResponse>(HIDDEN_CARDS_QUERY_KEY, (old) => {
        const rows = old?.data ?? [];
        if (rows.some((row) => row.cardType === variables.cardType && row.cardId === variables.cardId)) {
          return old ?? { data: rows };
        }
        return {
          data: [{ cardType: variables.cardType, cardId: variables.cardId }, ...rows],
        };
      });
      return { snapshots };
    },
    onSuccess: (_data, variables) => {
      toast("Card hidden", {
        description: "It's off your feeds. Everyone else still sees it.",
        action: {
          label: "Undo",
          onClick: () => {
            void unhideHiddenCard(queryClient, variables);
          },
        },
      });
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) restoreFeedCaches(queryClient, context.snapshots);
      toastHideError(error, "hide");
    },
    onSettled: (_data, _error, variables) => {
      invalidateHiddenCardQueries(queryClient, variables.cardType);
    },
  });
}

export async function unhideHiddenCard(
  queryClient: ReturnType<typeof useQueryClient>,
  variables: HideCardTarget,
): Promise<void> {
  try {
    await cancelFeedQueries(queryClient, variables.cardType);
    await apiRequest("DELETE", "/api/me/hidden-cards", variables);
    toast("Card restored");
  } catch (error) {
    toastHideError(error, "unhide");
  } finally {
    invalidateHiddenCardQueries(queryClient, variables.cardType);
  }
}

/** Unhide from the profile list. The card returns on the next feed fetch. */
export function useUnhideCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: HideCardTarget) => {
      const res = await apiRequest("DELETE", "/api/me/hidden-cards", variables);
      return res.json();
    },
    onMutate: async (variables) => {
      await cancelFeedQueries(queryClient, variables.cardType);
      const previous = queryClient.getQueryData(HIDDEN_CARDS_QUERY_KEY);
      queryClient.setQueryData<HiddenCardsResponse>(HIDDEN_CARDS_QUERY_KEY, (old) => {
        if (!old?.data) return old;
        return {
          data: old.data.filter(
            (row) => !(row.cardType === variables.cardType && row.cardId === variables.cardId),
          ),
        };
      });
      return { previous };
    },
    onSuccess: () => {
      toast("Card restored");
    },
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(HIDDEN_CARDS_QUERY_KEY, context.previous);
      }
      toastHideError(error, "unhide");
    },
    onSettled: (_data, _error, variables) => {
      invalidateHiddenCardQueries(queryClient, variables.cardType);
    },
  });
}
