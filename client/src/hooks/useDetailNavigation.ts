import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  type VoteListHistoryState,
  type VoteListNavType,
  VOTE_DETAIL_PATH_PREFIX,
  mergeVoteListIntoHistory,
} from "@/lib/voteListNavigation";

function readContext(
  listType: VoteListNavType,
  urlSlug: string | undefined,
): { voteList: VoteListHistoryState; index: number } | null {
  if (!urlSlug) return null;
  const raw = window.history.state as { voteList?: VoteListHistoryState } | null;
  const vl = raw?.voteList;
  if (!vl || vl.type !== listType || !Array.isArray(vl.slugs)) return null;
  const idx = vl.slugs.indexOf(urlSlug);
  if (idx < 0) return null;
  return { voteList: vl, index: idx };
}

export function useDetailNavigation(urlSlug: string | undefined, listType: VoteListNavType) {
  const [, setLocation] = useLocation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onPop = () => setTick((t) => t + 1);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const snapshot = useMemo(() => {
    void tick;
    return readContext(listType, urlSlug);
  }, [listType, urlSlug, tick]);

  const prevSlug = snapshot && snapshot.index > 0 ? snapshot.voteList.slugs[snapshot.index - 1] : null;
  const nextSlug =
    snapshot && snapshot.index < snapshot.voteList.slugs.length - 1
      ? snapshot.voteList.slugs[snapshot.index + 1]
      : null;
  const total = snapshot?.voteList.slugs.length ?? 0;
  const currentIndex = snapshot ? snapshot.index + 1 : 0;
  const showNav = !!snapshot && total > 1;

  const prefix = VOTE_DETAIL_PATH_PREFIX[listType];

  const navigateToSlug = useCallback(
    (slug: string) => {
      if (!snapshot) return;
      const nextList: VoteListHistoryState = {
        ...snapshot.voteList,
        currentSlug: slug,
      };
      const path =
        listType === "matchup"
          ? `${prefix}${encodeURIComponent(slug)}`
          : `${prefix}${slug}`;
      setLocation(path);
      mergeVoteListIntoHistory(nextList);
    },
    [listType, prefix, setLocation, snapshot],
  );

  const goPrev = useCallback(() => {
    if (prevSlug) navigateToSlug(prevSlug);
  }, [navigateToSlug, prevSlug]);

  const goNext = useCallback(() => {
    if (nextSlug) navigateToSlug(nextSlug);
  }, [navigateToSlug, nextSlug]);

  return {
    showNav,
    prevSlug,
    nextSlug,
    total,
    currentIndex,
    goPrev,
    goNext,
  };
}
