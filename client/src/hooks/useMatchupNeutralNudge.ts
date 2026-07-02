import { useEffect, useRef, useState } from "react";

import {
  consumeMatchupNeutralHesitation,
  consumeMatchupNeutralMorph,
  isHesitationPossible,
  isMorphPossible,
} from "@/lib/matchup-neutral-nudge";

const MORPH_DURATION_MS = 2000;
/** Card must stay ≥55% visible this long before morph budget is consumed,
 * so a fast scroll-past doesn't burn a nudge nobody saw. */
const MORPH_DWELL_MS = 600;
const HESITATION_DELAY_MS = 4000;
const HESITATION_LABEL_DURATION_MS = 3000;
const IN_VIEW_RATIO = 0.55;

/**
 * Shared IntersectionObserver: one instance for every mounted matchup card
 * instead of one per card (the View All overlay mounts 100+ cards at once).
 */
type InViewCallback = (inView: boolean) => void;

const observedCards = new Map<Element, InViewCallback>();
let sharedObserver: IntersectionObserver | null = null;

function observeCard(element: Element, callback: InViewCallback): void {
  if (typeof IntersectionObserver === "undefined") return;

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          observedCards.get(entry.target)?.(
            entry.isIntersecting && entry.intersectionRatio >= IN_VIEW_RATIO,
          );
        }
      },
      { threshold: [0, IN_VIEW_RATIO] },
    );
  }

  observedCards.set(element, callback);
  sharedObserver.observe(element);
}

function unobserveCard(element: Element): void {
  if (!observedCards.delete(element)) return;
  sharedObserver?.unobserve(element);
  if (observedCards.size === 0 && sharedObserver) {
    sharedObserver.disconnect();
    sharedObserver = null;
  }
}

/**
 * Shared activity dispatcher: a single scroll + pointerdown listener pair on
 * window, attached while at least one in-view card is waiting on hesitation.
 * Capture phase catches nested scroll containers (View All overlay,
 * snap-scroll view), not just window scrolling.
 */
const activitySubscribers = new Set<() => void>();
let activityListenersAttached = false;

function notifyActivity(): void {
  for (const subscriber of activitySubscribers) subscriber();
}

function subscribeActivity(callback: () => void): void {
  activitySubscribers.add(callback);
  if (activityListenersAttached || typeof window === "undefined") return;
  window.addEventListener("scroll", notifyActivity, { capture: true, passive: true });
  window.addEventListener("pointerdown", notifyActivity, { capture: true, passive: true });
  activityListenersAttached = true;
}

function unsubscribeActivity(callback: () => void): void {
  if (!activitySubscribers.delete(callback)) return;
  if (activitySubscribers.size > 0 || !activityListenersAttached) return;
  window.removeEventListener("scroll", notifyActivity, { capture: true });
  window.removeEventListener("pointerdown", notifyActivity, { capture: true });
  activityListenersAttached = false;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return prefersReducedMotion;
}

export function useMatchupNeutralNudge(matchupId: string, hasVoted: boolean) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [showMorph, setShowMorph] = useState(false);
  const [showHesitationNudge, setShowHesitationNudge] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const node = cardRef.current;
    // Cheap in-memory eligibility gate: once session budgets are spent (the
    // common case), cards do no observer/timer/render work at all on scroll.
    const morphEligible = !prefersReducedMotion && isMorphPossible(matchupId);
    const hesitationEligible = isHesitationPossible(matchupId);

    if (!node || hasVoted || (!morphEligible && !hesitationEligible)) {
      setShowMorph(false);
      setShowHesitationNudge(false);
      return;
    }

    // In-view is tracked in plain variables driven by the shared observer —
    // never React state — so scrolling causes zero card re-renders. The only
    // setState calls happen when a nudge actually becomes visible/hidden.
    let inView = false;
    let morphDone = !morphEligible;
    let hesitationDone = !hesitationEligible;
    let hesitationFired = false;
    let dwellTimeout: number | null = null;
    let morphHideTimeout: number | null = null;
    let hesitationDelayTimeout: number | null = null;
    let hesitationHideTimeout: number | null = null;

    const cancelMorph = () => {
      if (dwellTimeout !== null) {
        window.clearTimeout(dwellTimeout);
        dwellTimeout = null;
      }
      if (morphHideTimeout !== null) {
        window.clearTimeout(morphHideTimeout);
        morphHideTimeout = null;
        setShowMorph(false);
      }
    };

    const cancelHesitation = () => {
      if (hesitationDelayTimeout !== null) {
        window.clearTimeout(hesitationDelayTimeout);
        hesitationDelayTimeout = null;
      }
      if (hesitationHideTimeout !== null) {
        window.clearTimeout(hesitationHideTimeout);
        hesitationHideTimeout = null;
      }
      setShowHesitationNudge(false);
    };

    const startHesitationCountdown = () => {
      if (hesitationDelayTimeout !== null) window.clearTimeout(hesitationDelayTimeout);
      hesitationDelayTimeout = window.setTimeout(() => {
        hesitationDelayTimeout = null;
        if (!consumeMatchupNeutralHesitation(matchupId)) {
          hesitationDone = true;
          unsubscribeActivity(onActivity);
          return;
        }
        hesitationFired = true;
        hesitationDone = true;
        setShowHesitationNudge(true);
        hesitationHideTimeout = window.setTimeout(() => {
          hesitationHideTimeout = null;
          setShowHesitationNudge(false);
          unsubscribeActivity(onActivity);
        }, HESITATION_LABEL_DURATION_MS);
      }, HESITATION_DELAY_MS);
    };

    // Hesitation means the page is *still* — restart the countdown on any
    // scroll or tap so mere visibility during active browsing never fires it.
    const onActivity = () => {
      if (inView && !hesitationFired && !hesitationDone) startHesitationCountdown();
    };

    const onInViewChange = (next: boolean) => {
      if (next === inView) return;
      inView = next;

      if (inView) {
        if (!morphDone) {
          // Dwell before consuming budget so a fast scroll-past never burns
          // a morph; consume at the moment the animation actually starts.
          dwellTimeout = window.setTimeout(() => {
            dwellTimeout = null;
            if (!consumeMatchupNeutralMorph(matchupId)) {
              // Failure may be the transient single-morph lock — only mark
              // done when the budget itself is spent, so a later view entry
              // can still morph.
              if (!isMorphPossible(matchupId)) morphDone = true;
              return;
            }
            morphDone = true;
            setShowMorph(true);
            morphHideTimeout = window.setTimeout(() => {
              morphHideTimeout = null;
              setShowMorph(false);
            }, MORPH_DURATION_MS);
          }, MORPH_DWELL_MS);
        }
        if (!hesitationDone) {
          subscribeActivity(onActivity);
          startHesitationCountdown();
        }
      } else {
        cancelMorph();
        cancelHesitation();
        unsubscribeActivity(onActivity);
      }
    };

    observeCard(node, onInViewChange);

    return () => {
      unobserveCard(node);
      unsubscribeActivity(onActivity);
      cancelMorph();
      cancelHesitation();
      setShowMorph(false);
    };
  }, [hasVoted, matchupId, prefersReducedMotion]);

  return {
    cardRef,
    showMorph,
    showHesitationNudge,
    prefersReducedMotion,
  };
}
