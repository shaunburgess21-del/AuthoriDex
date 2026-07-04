import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { MentionToken } from "@shared/lib/mentions";
import type { MentionPersonResult, MentionSuggestionItem, MentionUserResult } from "./MentionSuggestions";

export interface ActiveMention {
  /** Index of `@` in the value string. */
  start: number;
  query: string;
}

/** Detect an in-progress @-mention query at the text cursor. */
export function getActiveMention(text: string, cursor: number): ActiveMention | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[\s])@([\w ]*)$/);
  if (!match) return null;
  const query = match[2];
  const atIndex = before.length - query.length - 1;
  return { start: atIndex, query };
}

interface MentionSearchResponse {
  people: MentionPersonResult[];
  users: MentionUserResult[];
}

export function useMentionAutocomplete(value: string, cursor: number) {
  const [mentions, setMentions] = useState<MentionToken[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeMention = useMemo(
    () => getActiveMention(value, cursor),
    [value, cursor],
  );

  const debouncedQuery = activeMention?.query ?? "";
  const searchEnabled = debouncedQuery.length >= 2;

  const { data, isFetching } = useQuery<MentionSearchResponse>({
    queryKey: ["/api/mentions/search", debouncedQuery],
    enabled: searchEnabled && !!activeMention,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/mentions/search?q=${encodeURIComponent(debouncedQuery)}`,
      );
      return res.json() as Promise<MentionSearchResponse>;
    },
  });

  const people = data?.people ?? [];
  const users = data?.users ?? [];
  const suggestionCount = people.length + users.length;

  const selectMention = useCallback(
    (item: MentionSuggestionItem, insert: (nextValue: string, nextCursor: number) => void) => {
      if (!activeMention) return;
      const before = value.slice(0, activeMention.start);
      const after = value.slice(cursor);
      const insertion = `@${item.display} `;
      const nextValue = `${before}${insertion}${after}`;
      const nextCursor = before.length + insertion.length;

      setMentions((prev) => {
        const key = `${item.type}:${item.id}`;
        if (prev.some((m) => `${m.type}:${m.id}` === key)) return prev;
        return [...prev, { type: item.type, id: item.id, display: item.display }];
      });

      insert(nextValue, nextCursor);
      setActiveIndex(0);
    },
    [activeMention, value, cursor],
  );

  const clearMentions = useCallback(() => {
    setMentions([]);
    setActiveIndex(0);
  }, []);

  const moveActiveIndex = useCallback(
    (delta: number) => {
      if (suggestionCount === 0) return;
      setActiveIndex((i) => (i + delta + suggestionCount) % suggestionCount);
    },
    [suggestionCount],
  );

  return {
    mentions,
    clearMentions,
    activeMention,
    people,
    users,
    isFetching,
    activeIndex,
    setActiveIndex,
    selectMention,
    moveActiveIndex,
    suggestionCount,
    isOpen: !!activeMention,
  };
}
