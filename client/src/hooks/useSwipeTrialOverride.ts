import { useState } from "react";
import { useSearch } from "wouter";
import { readSwipeTrialOverride } from "@/lib/swipeTrial";

/**
 * Preview switch for the mixed-feed swipe trial.
 * `?swipeTrial=1` turns it on and stores `voxdex_swipe_trial`; `=0` clears it.
 * With neither, the trial stays off on web and the installed PWA.
 */
export function useSwipeTrialOverride(): boolean {
  const search = useSearch();
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return readSwipeTrialOverride(window.localStorage, window.location.search);
  });

  const [seenSearch, setSeenSearch] = useState(search);
  if (search !== seenSearch) {
    setSeenSearch(search);
    if (typeof window !== "undefined") {
      setEnabled(readSwipeTrialOverride(window.localStorage, search));
    }
  }

  return enabled;
}
