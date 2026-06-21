import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";

export interface OptionSuggestion {
  id: string;
  name: string;
  voteCount: number;
  userHasVoted: boolean;
  createdAt: string;
}

/** Extract a human-readable error string from an apiRequest "<status>: <body>" error. */
export function parseSuggestionError(err: unknown): string {
  if (err instanceof Error && err.message) {
    const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
    if (jsonMatch) {
      try {
        const j = JSON.parse(jsonMatch[1]) as { error?: string };
        if (j.error) return j.error;
      } catch {
        /* ignore */
      }
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

function suggestionsKey(slug: string) {
  return ["/api/opinion-polls", slug, "suggestions"] as const;
}

/**
 * Data + mutations for community-suggested options on an opinion poll.
 * - `suggestions` is sorted by votes desc (server-side).
 * - `submit` posts a new suggestion (logged-in only, server-enforced).
 * - `toggleVote` optimistically flips the caller's upvote on a suggestion.
 */
export function useOptionSuggestions(slug: string, enabled = true) {
  const queryClient = useQueryClient();
  const key = suggestionsKey(slug);

  const query = useQuery<OptionSuggestion[]>({
    queryKey: key,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/opinion-polls/${encodeURIComponent(slug)}/suggestions`, {
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load suggestions");
      return res.json();
    },
    enabled: enabled && !!slug,
  });

  const submitMutation = useMutation<{ suggestion: OptionSuggestion }, Error, string>({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/opinion-polls/${encodeURIComponent(slug)}/suggestions`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const voteMutation = useMutation<
    { voteCount: number; userHasVoted: boolean },
    Error,
    string,
    { previous: OptionSuggestion[] | undefined }
  >({
    mutationFn: async (suggestionId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/opinion-polls/${encodeURIComponent(slug)}/suggestions/${suggestionId}/vote`,
      );
      return res.json();
    },
    onMutate: async (suggestionId: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OptionSuggestion[]>(key);
      queryClient.setQueryData<OptionSuggestion[]>(key, (old) =>
        old?.map((s) =>
          s.id === suggestionId
            ? {
                ...s,
                userHasVoted: !s.userHasVoted,
                voteCount: s.userHasVoted ? Math.max(0, s.voteCount - 1) : s.voteCount + 1,
              }
            : s,
        ),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSuccess: (data, suggestionId) => {
      queryClient.setQueryData<OptionSuggestion[]>(key, (old) =>
        old?.map((s) =>
          s.id === suggestionId
            ? { ...s, voteCount: data.voteCount, userHasVoted: data.userHasVoted }
            : s,
        ),
      );
    },
  });

  return {
    suggestions: query.data ?? [],
    isLoading: query.isLoading,
    submit: submitMutation,
    toggleVote: voteMutation,
  };
}
