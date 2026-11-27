import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeftRight } from "lucide-react";
import { WindowedDotIndicator } from "@/components/WindowedDotIndicator";
import {
  SwipeNavigator,
  type SwipeNavigatorHandle,
} from "@/components/vote/SwipeNavigator";
import { SWIPE_EDGE_INSET_PX, type SwipeDirection } from "@/components/vote/swipeGesture";
import { isDiscussionShellOpen } from "@/lib/discussionShell";
import { logFunnelEvent } from "@/lib/funnelTelemetry";
import {
  buildSameCategoryMatchupQueue,
  hasSeenSwipeTrialNudge,
  markSwipeTrialNudgeSeen,
  primaryCanonicalId,
  reconcileSwipeQueueIndex,
  stepSwipeQueueIndex,
  type SwipeTrialMatchup,
  type SwipeTrialStorage,
} from "@/lib/swipeTrial";
import { cn } from "@/lib/utils";

const SURFACE = "vote_feed";
const PEEK_DELAY_MS = 700;
const NUDGE_DISMISS_MS = 5000;
const SLOT_MEMORY_LIMIT = 80;

const slotMemory = new Map<string, string>();
let discoveryPeekClaim: string | null = null;
let discoveryPeekDone = false;
let nudgeShownLogged = false;

function rememberSlot(anchorId: string, matchupId: string): void {
  if (!anchorId || !matchupId) return;
  if (slotMemory.has(anchorId)) slotMemory.delete(anchorId);
  slotMemory.set(anchorId, matchupId);
  while (slotMemory.size > SLOT_MEMORY_LIMIT) {
    const oldest = slotMemory.keys().next().value;
    if (oldest == null) break;
    slotMemory.delete(oldest);
  }
}

function markInert(node: HTMLDivElement | null): void {
  if (node) node.inert = true;
}

function browserStorage(): SwipeTrialStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function startingIndex(ids: readonly string[], anchorId: string): number {
  const remembered = slotMemory.get(anchorId);
  if (remembered) {
    const found = ids.indexOf(remembered);
    if (found >= 0) return found;
  }
  const anchor = ids.indexOf(anchorId);
  return anchor >= 0 ? anchor : 0;
}

export function MatchupCategorySwipe<T extends SwipeTrialMatchup>({
  anchorId,
  items,
  resolveCanonicalId,
  gesturesEnabled,
  offerNudge,
  native,
  override,
  allowFinePointer,
  fallback,
  renderItem,
}: {
  anchorId: string;
  /** Already filtered (hidden, country, Not voted / eye, search, category). */
  items: readonly T[];
  resolveCanonicalId: (stored: string | null | undefined) => string;
  gesturesEnabled: boolean;
  /** This slot may show the one-time tip. Only the first swipable card should. */
  offerNudge: boolean;
  native: boolean;
  override: boolean;
  allowFinePointer: boolean;
  fallback: T;
  renderItem: (item: T, opts: { priority: boolean }) => ReactNode;
}) {
  const liveQueue = useMemo(
    () => buildSameCategoryMatchupQueue(items, anchorId, resolveCanonicalId),
    [anchorId, items, resolveCanonicalId],
  );
  const liveSignature = liveQueue.map((item) => item.id).join("\0");
  const [index, setIndex] = useState(() =>
    startingIndex(liveQueue.map((item) => item.id), anchorId),
  );
  const indexRef = useRef(index);
  const displayedIdRef = useRef(liveQueue[index]?.id ?? anchorId);
  const draggingRef = useRef(false);
  const frozenRef = useRef<readonly T[] | null>(null);
  const liveQueueRef = useRef(liveQueue);
  const justSwipedRef = useRef(false);
  const commitFromSwipeRef = useRef(true);
  const dismissTipRef = useRef<(reason: "dismissed" | "timeout" | "swipe") => void>(() => {});
  const tipOpenRef = useRef(false);
  liveQueueRef.current = liveQueue;

  const queue = frozenRef.current ?? liveQueue;
  const safeIndex = queue.length === 0 ? 0 : Math.min(index, queue.length - 1);
  const shown = queue[safeIndex] ?? fallback;
  const categoryId = primaryCanonicalId(fallback.category, resolveCanonicalId) ?? "";

  useEffect(() => {
    if (draggingRef.current) return;
    const ids = liveQueue.map((item) => item.id);
    const next = reconcileSwipeQueueIndex(ids, displayedIdRef.current, indexRef.current);
    const id = ids[next];
    if (id) {
      displayedIdRef.current = id;
      rememberSlot(anchorId, id);
    }
    indexRef.current = next;
    setIndex((current) => (current === next ? current : next));
  }, [anchorId, liveSignature, liveQueue]);

  const sourceMeta = useCallback(
    (extra?: Record<string, unknown>) => ({
      native,
      override,
      type: "matchup",
      category: categoryId,
      queueSize: queue.length,
      ...extra,
    }),
    [categoryId, native, override, queue.length],
  );

  const settleOn = useCallback(
    (nextIndex: number, sourceQueue: readonly T[]) => {
      const id = sourceQueue[nextIndex]?.id;
      if (!id) return;
      displayedIdRef.current = id;
      indexRef.current = nextIndex;
      rememberSlot(anchorId, id);
      setIndex(nextIndex);
    },
    [anchorId],
  );

  const releaseGesture = useCallback(() => {
    frozenRef.current = null;
    const ids = liveQueueRef.current.map((item) => item.id);
    const next = reconcileSwipeQueueIndex(ids, displayedIdRef.current, indexRef.current);
    const id = ids[next];
    if (id) {
      displayedIdRef.current = id;
      rememberSlot(anchorId, id);
    }
    indexRef.current = next;
    setIndex(next);
  }, [anchorId]);

  const onGestureActiveChange = useCallback(
    (active: boolean) => {
      if (active) {
        draggingRef.current = true;
        frozenRef.current = liveQueueRef.current;
        return;
      }
      draggingRef.current = false;
      releaseGesture();
    },
    [releaseGesture],
  );

  const logCommitted = useCallback(
    (direction: SwipeDirection, fromIndex: number, toIndex: number) => {
      if (!commitFromSwipeRef.current) {
        commitFromSwipeRef.current = true;
        return;
      }
      justSwipedRef.current = true;
      markSwipeTrialNudgeSeen(browserStorage());
      logFunnelEvent(
        "swipe_trial_swipe_committed",
        SURFACE,
        sourceMeta({ direction, fromIndex, toIndex }),
      );
    },
    [sourceMeta],
  );

  const onSwipeLeft = useCallback(() => {
    const source = frozenRef.current ?? liveQueueRef.current;
    const fromIndex = indexRef.current;
    const step = stepSwipeQueueIndex(fromIndex, source.length, "left");
    if (step.type !== "page") return;
    logCommitted("left", fromIndex, step.index);
    settleOn(step.index, source);
  }, [logCommitted, settleOn]);

  const onSwipeRight = useCallback(() => {
    const source = frozenRef.current ?? liveQueueRef.current;
    const fromIndex = indexRef.current;
    const step = stepSwipeQueueIndex(fromIndex, source.length, "right");
    if (step.type !== "page") return;
    logCommitted("right", fromIndex, step.index);
    settleOn(step.index, source);
  }, [logCommitted, settleOn]);

  const onEdgeBounce = useCallback(
    (direction: SwipeDirection) => {
      logFunnelEvent(
        "swipe_trial_edge_bounce",
        SURFACE,
        sourceMeta({ direction, fromIndex: indexRef.current }),
      );
    },
    [sourceMeta],
  );

  const onHorizontalIntent = useCallback(
    (direction: SwipeDirection) => {
      if (tipOpenRef.current) dismissTipRef.current("swipe");
      logFunnelEvent(
        "swipe_trial_swipe_started",
        SURFACE,
        sourceMeta({ direction, fromIndex: indexRef.current }),
      );
    },
    [sourceMeta],
  );

  const canStart = useCallback(() => !isDiscussionShellOpen(), []);

  const frameRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<SwipeNavigatorHandle>(null);
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  const [smoothHeight, setSmoothHeight] = useState(false);
  const previousHeightRef = useRef<number | null>(null);
  const [inView, setInView] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const tipDismissed = useRef(false);
  const peekedFor = useRef(new Set<string>());

  const paging = gesturesEnabled && queue.length >= 2;
  const hasNext = safeIndex < queue.length - 1;
  const displayedId = shown.id;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSmoothHeight(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || !paging) return;
    const apply = () => {
      const next = page.offsetHeight;
      if (next > 0) setFrameHeight((prev) => (prev === next ? prev : next));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(page);
    return () => observer.disconnect();
  }, [displayedId, paging]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || frameHeight == null) return;
    const previous = previousHeightRef.current;
    previousHeightRef.current = frameHeight;
    if (previous == null || previous === frameHeight) return;
    const box = frame.getBoundingClientRect();
    // A card fully above the viewport must not pull the page when its
    // height changes. A card on screen keeps its top and only the space
    // below it eases.
    if (box.bottom <= 0) window.scrollBy(0, frameHeight - previous);
  }, [frameHeight]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node || !paging) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.45));
      },
      { threshold: [0, 0.45, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [paging]);

  useEffect(() => {
    if (!paging || !inView || !hasNext) return;
    const id = displayedId;
    if (peekedFor.current.has(id)) return;
    const afterSwipe = justSwipedRef.current;
    if (!afterSwipe) {
      if (discoveryPeekDone) return;
      if (discoveryPeekClaim && discoveryPeekClaim !== anchorId) return;
      discoveryPeekClaim = anchorId;
    }
    const timer = window.setTimeout(() => {
      if (draggingRef.current) return;
      peekedFor.current.add(id);
      if (!afterSwipe) discoveryPeekDone = true;
      justSwipedRef.current = false;
      swipeRef.current?.peekNext();
    }, PEEK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (discoveryPeekClaim === anchorId && !discoveryPeekDone) discoveryPeekClaim = null;
    };
  }, [anchorId, displayedId, hasNext, inView, paging]);

  useEffect(() => {
    if (!offerNudge || !paging || !inView || tipOpen) return;
    if (hasSeenSwipeTrialNudge(browserStorage())) return;
    const timer = window.setTimeout(() => {
      if (hasSeenSwipeTrialNudge(browserStorage())) return;
      setTipOpen(true);
    }, PEEK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [inView, offerNudge, paging, tipOpen]);

  const dismissTip = useCallback(
    (reason: "dismissed" | "timeout" | "swipe") => {
      if (!tipOpenRef.current || tipDismissed.current) return;
      tipDismissed.current = true;
      tipOpenRef.current = false;
      markSwipeTrialNudgeSeen(browserStorage());
      setTipOpen(false);
      logFunnelEvent("swipe_trial_nudge_dismissed", SURFACE, sourceMeta({ reason }));
    },
    [sourceMeta],
  );
  dismissTipRef.current = dismissTip;
  tipOpenRef.current = tipOpen;

  useEffect(() => {
    if (!tipOpen) return;
    if (!nudgeShownLogged) {
      nudgeShownLogged = true;
      logFunnelEvent("swipe_trial_nudge_shown", SURFACE, sourceMeta());
    }
    const timer = window.setTimeout(() => dismissTip("timeout"), NUDGE_DISMISS_MS);
    const onPointerDown = (event: PointerEvent) => {
      const tip = frameRef.current?.querySelector("[data-swipe-trial-nudge]");
      if (tip && event.target instanceof Node && tip.contains(event.target)) return;
      if (frameRef.current && event.target instanceof Node && frameRef.current.contains(event.target)) {
        return;
      }
      dismissTip("dismissed");
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [dismissTip, sourceMeta, tipOpen]);

  const onDotClick = (slideIndex: number) => {
    if (slideIndex === safeIndex || draggingRef.current) return;
    if (Math.abs(slideIndex - safeIndex) === 1) {
      commitFromSwipeRef.current = false;
      swipeRef.current?.slide(slideIndex > safeIndex ? "left" : "right");
      return;
    }
    justSwipedRef.current = false;
    settleOn(slideIndex, queue);
  };

  const card = (
    <div ref={pageRef} className="min-w-0">
      {renderItem(shown, { priority: true })}
    </div>
  );

  if (!paging) {
    return renderItem(shown, { priority: true });
  }

  const previous = safeIndex > 0 ? queue[safeIndex - 1] : null;
  const next = hasNext ? queue[safeIndex + 1] : null;

  return (
    <div className="min-w-0" data-testid="matchup-category-swipe">
      <div
        ref={frameRef}
        className={cn(
          "relative min-w-0 overflow-hidden [overflow-anchor:none]",
          smoothHeight && "transition-[height] duration-300 ease-out motion-reduce:transition-none",
        )}
        style={frameHeight != null ? { height: frameHeight } : undefined}
        role="group"
        aria-roledescription="carousel"
        aria-label={`Head-to-head ${safeIndex + 1} of ${queue.length}`}
      >
        <SwipeNavigator
          ref={swipeRef}
          paging
          pageKey={displayedId}
          allowFinePointer={allowFinePointer}
          edgeInsetPx={SWIPE_EDGE_INSET_PX}
          disableLeft={!hasNext}
          disableRight={safeIndex <= 0}
          onSwipeLeft={onSwipeLeft}
          onSwipeRight={onSwipeRight}
          onEdgeBounce={onEdgeBounce}
          onHorizontalIntent={onHorizontalIntent}
          onGestureActiveChange={onGestureActiveChange}
          canStart={canStart}
          className="w-full"
        >
          <div className="relative w-full">
            {previous ? (
              <div
                ref={markInert}
                className="pointer-events-none absolute top-0 right-full w-full"
                aria-hidden
              >
                {renderItem(previous, { priority: false })}
              </div>
            ) : null}
            {card}
            {next ? (
              <div
                ref={markInert}
                className="pointer-events-none absolute top-0 left-full w-full"
                aria-hidden
              >
                {renderItem(next, { priority: false })}
              </div>
            ) : null}
          </div>
        </SwipeNavigator>
        <p className="sr-only" aria-live="polite">
          {`Head-to-head ${safeIndex + 1} of ${queue.length}`}
        </p>
        {tipOpen ? (
          <div
            role="status"
            data-swipe-trial-nudge=""
            data-testid="matchup-swipe-trial-nudge"
            className="absolute inset-x-3 bottom-3 z-20 rounded-xl border border-border bg-popover/95 px-3 py-2.5 text-left shadow-lg backdrop-blur-md"
            onClick={() => dismissTip("dismissed")}
          >
            <p className="flex items-center gap-1.5 text-[13px] font-medium leading-snug text-popover-foreground">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
              Swipe for more matchups
            </p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Left or right shows another head-to-head in this category. The rest of the list stays put.
            </p>
          </div>
        ) : null}
      </div>
      {queue.length >= 3 ? (
        <div data-no-swipe-nav="">
          <WindowedDotIndicator
            totalSlides={queue.length}
            activeIndex={safeIndex}
            accent="cyan"
            testIdPrefix="matchup-swipe-trial-dots"
            onDotClick={onDotClick}
          />
        </div>
      ) : null}
    </div>
  );
}
