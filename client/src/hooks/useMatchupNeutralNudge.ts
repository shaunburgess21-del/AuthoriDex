import { useEffect, useRef, useState } from "react";

import {
  consumeMatchupNeutralHesitation,
  consumeMatchupNeutralMorph,
  hasGuaranteedShimmer,
  isHesitationPossible,
  isMorphPossible,
  markGuaranteedShimmer,
} from "@/lib/matchup-neutral-nudge";

const MORPH_DURATION_MS = 2000;
const MORPH_FLASH_MS = 1500;
/** Card must stay ≥55% visible this long before morph budget is consumed,
 * so a fast scroll-past doesn't burn a nudge nobody saw. */
const MORPH_DWELL_MS = 600;
const HESITATION_DELAY_MS = 4000;
const HESITATION_LABEL_DURATION_MS = 3000;
const SHIMMER_DWELL_MS = 600;
const SHIMMER_DURATION_MS = 900;
const SHIMMER_REPEAT_MS = 10_000;
const IN_VIEW_RATIO = 0.55;

/** Mobile: higher-frequency education while dwelling on a card. */
const MOBILE_HESITATION_DELAY_MS = 2000;
const MOBILE_HESITATION_LABEL_DURATION_MS = 3500;
const MOBILE_SHIMMER_REPEAT_MS = 5000;
const MOBILE_MORPH_REPEAT_MS = 8000;
const MOBILE_BUBBLE_REPEAT_MS = 12000;

/** Desktop: hover-intent nudges replace scroll-based morph/label. */
const DESKTOP_HOVER_MORPH_DELAY_MS = 400;
const DESKTOP_HOVER_BUBBLE_DELAY_MS = 1000;
const DESKTOP_HOVER_BUBBLE_MAX_MS = 4000;

export interface MatchupNeutralNudgeOptions {
  morph?: boolean;
  hesitation?: boolean;
  shimmer?: boolean;
  isMobile?: boolean;
}

const DEFAULT_NUDGE_OPTIONS: Required<MatchupNeutralNudgeOptions> = {
  morph: true,
  hesitation: true,
  shimmer: true,
  isMobile: false,
};

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

export function useMatchupNeutralNudge(
  matchupId: string,
  hasVoted: boolean,
  options: MatchupNeutralNudgeOptions = DEFAULT_NUDGE_OPTIONS,
) {
  const { morph, hesitation, shimmer, isMobile } = { ...DEFAULT_NUDGE_OPTIONS, ...options };
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [showMorph, setShowMorph] = useState(false);
  const [showVsShimmer, setShowVsShimmer] = useState(false);
  const [showHesitationLabel, setShowHesitationLabel] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const node = cardRef.current;
    const useScrollMorph = isMobile && morph;
    const useScrollHesitation = isMobile && hesitation;
    const useDesktopHover = !isMobile && !hasVoted && (morph || hesitation);
    const morphEligible =
      useScrollMorph && !prefersReducedMotion && !hasVoted && isMorphPossible(matchupId, isMobile);
    const hesitationEligible =
      useScrollHesitation && !hasVoted && isHesitationPossible(matchupId, isMobile);
    const shimmerEligible = shimmer && !prefersReducedMotion;
    const needsObserver =
      shimmerEligible || morphEligible || hesitationEligible || useDesktopHover;

    const hesitationDelayMs = isMobile ? MOBILE_HESITATION_DELAY_MS : HESITATION_DELAY_MS;
    const hesitationLabelDurationMs = isMobile
      ? MOBILE_HESITATION_LABEL_DURATION_MS
      : HESITATION_LABEL_DURATION_MS;
    const shimmerRepeatMs = isMobile ? MOBILE_SHIMMER_REPEAT_MS : SHIMMER_REPEAT_MS;

    if (!node || !needsObserver) {
      setShowMorph(false);
      setShowVsShimmer(false);
      setShowHesitationLabel(false);
      return;
    }

    // In-view is tracked in plain variables driven by the shared observer —
    // never React state — so scrolling causes zero card re-renders. The only
    // setState calls happen when a nudge actually becomes visible/hidden.
    let inView = false;
    let isHovered = false;
    let morphDone = !morphEligible;
    let hesitationDone = !hesitationEligible;
    let hesitationFired = false;
    let bubbleRepeatArmed = false;
    let dwellTimeout: number | null = null;
    let morphHideTimeout: number | null = null;
    let morphRepeatTimeout: number | null = null;
    let hesitationDelayTimeout: number | null = null;
    let hesitationHideTimeout: number | null = null;
    let bubbleRepeatTimeout: number | null = null;
    let shimmerDwellTimeout: number | null = null;
    let shimmerHideTimeout: number | null = null;
    let shimmerRepeatTimeout: number | null = null;
    let hoverMorphDelayTimeout: number | null = null;
    let hoverBubbleDelayTimeout: number | null = null;
    let hoverBubbleMaxTimeout: number | null = null;
    let hoverShimmerHideTimeout: number | null = null;

    const cancelMorph = (hide = true) => {
      if (dwellTimeout !== null) {
        window.clearTimeout(dwellTimeout);
        dwellTimeout = null;
      }
      if (morphRepeatTimeout !== null) {
        window.clearTimeout(morphRepeatTimeout);
        morphRepeatTimeout = null;
      }
      if (morphHideTimeout !== null) {
        window.clearTimeout(morphHideTimeout);
        morphHideTimeout = null;
        if (hide) setShowMorph(false);
      } else if (hide) {
        setShowMorph(false);
      }
    };

    const cancelHesitation = (hide = true) => {
      if (hesitationDelayTimeout !== null) {
        window.clearTimeout(hesitationDelayTimeout);
        hesitationDelayTimeout = null;
      }
      if (bubbleRepeatTimeout !== null) {
        window.clearTimeout(bubbleRepeatTimeout);
        bubbleRepeatTimeout = null;
      }
      if (hesitationHideTimeout !== null) {
        window.clearTimeout(hesitationHideTimeout);
        hesitationHideTimeout = null;
      }
      if (hide) setShowHesitationLabel(false);
    };

    const cancelShimmer = (hide = true) => {
      if (shimmerDwellTimeout !== null) {
        window.clearTimeout(shimmerDwellTimeout);
        shimmerDwellTimeout = null;
      }
      if (shimmerHideTimeout !== null) {
        window.clearTimeout(shimmerHideTimeout);
        shimmerHideTimeout = null;
      }
      if (shimmerRepeatTimeout !== null) {
        window.clearTimeout(shimmerRepeatTimeout);
        shimmerRepeatTimeout = null;
      }
      if (hide) setShowVsShimmer(false);
    };

    const cancelDesktopHover = () => {
      if (hoverMorphDelayTimeout !== null) {
        window.clearTimeout(hoverMorphDelayTimeout);
        hoverMorphDelayTimeout = null;
      }
      if (hoverBubbleDelayTimeout !== null) {
        window.clearTimeout(hoverBubbleDelayTimeout);
        hoverBubbleDelayTimeout = null;
      }
      if (hoverBubbleMaxTimeout !== null) {
        window.clearTimeout(hoverBubbleMaxTimeout);
        hoverBubbleMaxTimeout = null;
      }
      if (hoverShimmerHideTimeout !== null) {
        window.clearTimeout(hoverShimmerHideTimeout);
        hoverShimmerHideTimeout = null;
      }
      cancelMorph();
      cancelHesitation();
      setShowVsShimmer(false);
    };

    const flashMorph = (durationMs: number, scheduleRepeat = false) => {
      setShowMorph(true);
      morphHideTimeout = window.setTimeout(() => {
        morphHideTimeout = null;
        setShowMorph(false);
        if (scheduleRepeat && inView && isMobile && !hasVoted && morph) {
          morphRepeatTimeout = window.setTimeout(() => {
            morphRepeatTimeout = null;
            if (inView && !hasVoted) flashMorph(MORPH_FLASH_MS, true);
          }, MOBILE_MORPH_REPEAT_MS);
        }
      }, durationMs);
    };

    const showBubble = (durationMs: number, scheduleRepeat = false) => {
      setShowHesitationLabel(true);
      hesitationHideTimeout = window.setTimeout(() => {
        hesitationHideTimeout = null;
        setShowHesitationLabel(false);
        if (scheduleRepeat && inView && isMobile && !hasVoted && hesitation) {
          armBubbleRepeat();
        }
      }, durationMs);
    };

    const armBubbleRepeat = () => {
      bubbleRepeatArmed = true;
      bubbleRepeatTimeout = window.setTimeout(() => {
        bubbleRepeatTimeout = null;
        if (!inView || hasVoted || !bubbleRepeatArmed) return;
        startBubbleRepeatCountdown();
      }, MOBILE_BUBBLE_REPEAT_MS);
    };

    const startBubbleRepeatCountdown = () => {
      if (hesitationDelayTimeout !== null) window.clearTimeout(hesitationDelayTimeout);
      hesitationDelayTimeout = window.setTimeout(() => {
        hesitationDelayTimeout = null;
        if (!inView || hasVoted) return;
        showBubble(hesitationLabelDurationMs, true);
      }, hesitationDelayMs);
    };

    const runShimmerBurst = (isGuaranteed: boolean) => {
      if (isGuaranteed) markGuaranteedShimmer(matchupId);
      setShowVsShimmer(true);
      shimmerHideTimeout = window.setTimeout(() => {
        shimmerHideTimeout = null;
        setShowVsShimmer(false);
        if (!inView || hasVoted) return;
        shimmerRepeatTimeout = window.setTimeout(() => {
          shimmerRepeatTimeout = null;
          if (inView && !hasVoted) runShimmerBurst(false);
        }, shimmerRepeatMs);
      }, SHIMMER_DURATION_MS);
    };

    const scheduleShimmer = () => {
      if (!shimmerEligible || !inView) return;

      const needsGuaranteed = !hasGuaranteedShimmer(matchupId);
      if (!needsGuaranteed && hasVoted) return;

      const delay = needsGuaranteed ? SHIMMER_DWELL_MS : shimmerRepeatMs;
      shimmerDwellTimeout = window.setTimeout(() => {
        shimmerDwellTimeout = null;
        if (!inView) return;
        runShimmerBurst(needsGuaranteed);
      }, delay);
    };

    const startHesitationCountdown = () => {
      if (hesitationDelayTimeout !== null) window.clearTimeout(hesitationDelayTimeout);
      hesitationDelayTimeout = window.setTimeout(() => {
        hesitationDelayTimeout = null;
        if (!consumeMatchupNeutralHesitation(matchupId, isMobile)) {
          if (!isHesitationPossible(matchupId, isMobile)) {
            hesitationDone = true;
            unsubscribeActivity(onActivity);
          }
          return;
        }
        hesitationFired = true;
        setShowHesitationLabel(true);
        setShowVsShimmer(true);
        hesitationHideTimeout = window.setTimeout(() => {
          hesitationHideTimeout = null;
          setShowHesitationLabel(false);
          setShowVsShimmer(false);
          if (isMobile && inView && !hasVoted) {
            armBubbleRepeat();
          } else {
            hesitationDone = true;
            unsubscribeActivity(onActivity);
          }
        }, hesitationLabelDurationMs);
      }, hesitationDelayMs);
    };

    const onActivity = () => {
      if (!inView || hasVoted) return;
      if (bubbleRepeatArmed) {
        if (bubbleRepeatTimeout !== null) {
          window.clearTimeout(bubbleRepeatTimeout);
          bubbleRepeatTimeout = null;
        }
        armBubbleRepeat();
        if (hesitationDelayTimeout !== null) {
          window.clearTimeout(hesitationDelayTimeout);
          hesitationDelayTimeout = null;
        }
        startBubbleRepeatCountdown();
        return;
      }
      if (!hesitationFired && !hesitationDone) startHesitationCountdown();
    };

    const onMouseEnter = () => {
      if (!useDesktopHover || prefersReducedMotion) return;
      isHovered = true;

      hoverMorphDelayTimeout = window.setTimeout(() => {
        hoverMorphDelayTimeout = null;
        if (!isHovered) return;
        if (morph) flashMorph(MORPH_FLASH_MS);
        if (shimmerEligible) {
          setShowVsShimmer(true);
          hoverShimmerHideTimeout = window.setTimeout(() => {
            hoverShimmerHideTimeout = null;
            if (!isHovered) setShowVsShimmer(false);
          }, SHIMMER_DURATION_MS);
        }
      }, DESKTOP_HOVER_MORPH_DELAY_MS);

      if (hesitation) {
        hoverBubbleDelayTimeout = window.setTimeout(() => {
          hoverBubbleDelayTimeout = null;
          if (!isHovered) return;
          setShowHesitationLabel(true);
          hoverBubbleMaxTimeout = window.setTimeout(() => {
            hoverBubbleMaxTimeout = null;
            if (isHovered) setShowHesitationLabel(false);
          }, DESKTOP_HOVER_BUBBLE_MAX_MS);
        }, DESKTOP_HOVER_BUBBLE_DELAY_MS);
      }
    };

    const onMouseLeave = () => {
      isHovered = false;
      cancelDesktopHover();
    };

    const onInViewChange = (next: boolean) => {
      if (next === inView) return;
      inView = next;

      if (inView) {
        if (!morphDone) {
          dwellTimeout = window.setTimeout(() => {
            dwellTimeout = null;
            if (!consumeMatchupNeutralMorph(matchupId, isMobile)) {
              if (!isMorphPossible(matchupId, isMobile)) morphDone = true;
              return;
            }
            morphDone = true;
            flashMorph(MORPH_DURATION_MS, isMobile);
          }, MORPH_DWELL_MS);
        }
        if (!hesitationDone) {
          subscribeActivity(onActivity);
          startHesitationCountdown();
        } else if (isMobile && hesitation && bubbleRepeatArmed) {
          subscribeActivity(onActivity);
          armBubbleRepeat();
        } else if (isMobile && morph && morphDone && !hasVoted) {
          morphRepeatTimeout = window.setTimeout(() => {
            morphRepeatTimeout = null;
            if (inView && !hasVoted) flashMorph(MORPH_FLASH_MS, true);
          }, MOBILE_MORPH_REPEAT_MS);
        }
        scheduleShimmer();
      } else {
        cancelMorph();
        cancelHesitation();
        cancelShimmer();
        bubbleRepeatArmed = false;
        unsubscribeActivity(onActivity);
        if (isHovered) onMouseLeave();
      }
    };

    observeCard(node, onInViewChange);

    if (useDesktopHover) {
      node.addEventListener("mouseenter", onMouseEnter);
      node.addEventListener("mouseleave", onMouseLeave);
    }

    return () => {
      unobserveCard(node);
      unsubscribeActivity(onActivity);
      if (useDesktopHover) {
        node.removeEventListener("mouseenter", onMouseEnter);
        node.removeEventListener("mouseleave", onMouseLeave);
      }
      cancelMorph();
      cancelHesitation();
      cancelShimmer();
      cancelDesktopHover();
      setShowMorph(false);
    };
  }, [hasVoted, hesitation, isMobile, matchupId, morph, prefersReducedMotion, shimmer]);

  return {
    cardRef,
    showMorph,
    showVsShimmer,
    showHesitationLabel,
    prefersReducedMotion,
  };
}
