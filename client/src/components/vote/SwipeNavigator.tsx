import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { animate, motion, useDragControls, useMotionValue, type PanInfo } from "framer-motion";
import {
  SWIPE_CLICK_SUPPRESS_MS,
  SWIPE_COMMIT_OFFSET_PX,
  SWIPE_COMMIT_VELOCITY_PX_PER_S,
  SWIPE_TAP_SLOP_PX,
  pointerStartsInScreenEdge,
  pointerTargetYieldsSwipeNav,
  swipeCommitDirection,
  type SwipeDirection,
} from "@/components/vote/swipeGesture";

interface SwipeNavigatorProps {
  /** Called when user swipes right (drag x > 0). Wire to "previous card". */
  onSwipeRight: () => void;
  /** Called when user swipes left (drag x < 0). Wire to "next card". */
  onSwipeLeft: () => void;
  /** If true, swipe-right is a no-op (rubber-band rebound only). */
  disableRight?: boolean;
  /** If true, swipe-left is a no-op (rubber-band rebound only). */
  disableLeft?: boolean;
  /** Ignore drags that start inside this selector (e.g. horizontal chip rows). */
  ignoreSelector?: string;
  /** Horizontal drag distance (px) required to commit navigation. */
  commitOffsetPx?: number;
  /**
   * Ignore pointerdowns this close to either screen edge. Detail pages
   * leave this at 0. The mixed-feed trial passes the system-gesture inset.
   */
  edgeInsetPx?: number;
  /** Let a mouse drag start. The preview override uses this; native stays coarse-only. */
  allowFinePointer?: boolean;
  /** Commit-sized swipe that hits a disabled edge (rubber-band only). */
  onEdgeBounce?: (direction: SwipeDirection) => void;
  /** First time this gesture passes the tap slop on the horizontal axis. */
  onHorizontalIntent?: (direction: SwipeDirection) => void;
  /**
   * Slide the child to the neighbor instead of snapping back to the same
   * page. Detail pages leave this off and navigate after a rubber-band.
   */
  paging?: boolean;
  /** Changes when the resting page changes, so the drag offset can reset. */
  pageKey?: string;
  /** Return false to ignore the gesture (discussion shell, blocked overlay). */
  canStart?: (clientX: number) => boolean;
  /** True from pointerdown through the settle animation. */
  onGestureActiveChange?: (active: boolean) => void;
  children: ReactNode;
  className?: string;
}

export interface SwipeNavigatorHandle {
  /** Briefly reveal the next card's edge, then settle. */
  peekNext: () => void;
  /** Animate one page, or rubber-band when that direction is disabled. */
  slide: (direction: SwipeDirection) => void;
}

/** Distance (px) the user must drag horizontally to commit a navigation. */
const COMMIT_OFFSET_PX = SWIPE_COMMIT_OFFSET_PX;
/** Velocity (px/s) that triggers a fast-flick navigation under the offset
 * threshold. Lets a quick thumb flick advance a card even if the finger
 * doesn't physically travel 80px. */
const COMMIT_VELOCITY_PX_PER_S = SWIPE_COMMIT_VELOCITY_PX_PER_S;

const PAGE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Touch-only horizontal swipe wrapper for the Vote detail pages.
 *
 * Why touch-only: desktop users have keyboard + on-screen arrow buttons.
 * Enabling drag on a mouse pointer would let an accidental click-drag
 * navigate to the next card while the user thinks they're text-selecting.
 * `pointer: coarse` is the standard CSS feature query for primary touch
 * input — it's true on phones and tablets, false on desktops/laptops
 * (even hybrid laptops with a touchscreen typically report `pointer:
 * fine` because the mouse is the primary pointer). The mixed-feed trial
 * sets `allowFinePointer` so a narrow browser preview can drag with a mouse.
 *
 * Why drag-direction-locked: a vertical scroll through long card content
 * shouldn't trigger horizontal nav. framer-motion's `dragDirectionLock`
 * picks an axis on the first few pixels of movement and ignores the
 * other — so a near-vertical swipe always wins for scroll, and only
 * deliberate horizontal swipes trigger navigation.
 *
 * Why rubber-band even when disabled: showing the rebound on an edge
 * (first or last card in the list) gives the user explicit "you're at
 * the edge" feedback rather than a dead-zone gesture.
 *
 * Why nested horizontal scrollers are excluded: pointerdown starts a
 * framer-motion drag on the whole detail surface, and a long enough
 * horizontal drag calls onSwipeLeft/Right. The surface's touch-action
 * is pan-y, so the browser leaves that horizontal gesture to script
 * and the carousel never pans — the pager changes cards instead.
 * Gestures that start inside a region that can actually scroll
 * sideways, or on anything marked `data-no-swipe-nav`, skip the drag
 * so the row scrolls natively. Vertical swipes elsewhere still scroll
 * the page because the surface keeps `touch-action: pan-y` and
 * dragDirectionLock.
 *
 * `paging` is the in-place variant for one mixed-feed slot: the drag
 * reveals the neighbor, a commit slides it into the slot, and the
 * parent swaps the resting card before the offset resets.
 */
export const SwipeNavigator = forwardRef<SwipeNavigatorHandle, SwipeNavigatorProps>(
  function SwipeNavigator(props, ref) {
    const {
      allowFinePointer = false,
      paging = false,
      children,
      className,
    } = props;
    const [isTouch, setIsTouch] = useState(allowFinePointer);

    useEffect(() => {
      if (allowFinePointer) {
        setIsTouch(true);
        return;
      }
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return;
      }
      const mq = window.matchMedia("(pointer: coarse)");
      const update = () => setIsTouch(mq.matches);
      update();
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
      }
      // Older Safari fallback
      mq.addListener(update);
      return () => mq.removeListener(update);
    }, [allowFinePointer]);

    if (!isTouch) {
      return <div className={className}>{children}</div>;
    }

    if (paging) {
      return <PagingSwipeSurface ref={ref} {...props} />;
    }

    return <DetailSwipeSurface {...props} />;
  },
);

function DetailSwipeSurface({
  onSwipeRight,
  onSwipeLeft,
  disableRight = false,
  disableLeft = false,
  ignoreSelector,
  commitOffsetPx = COMMIT_OFFSET_PX,
  edgeInsetPx = 0,
  onEdgeBounce,
  children,
  className,
}: SwipeNavigatorProps) {
  const dragControls = useDragControls();

  // Manual drag initiation. Gestures that begin in a nested horizontal
  // scroller, on `[data-no-swipe-nav]`, or inside `ignoreSelector` never
  // start the page drag — the child's native overflow scroll handles them.
  // Do not preventDefault here; that would cancel the pan we just yielded.
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStartsInScreenEdge(event.clientX, window.innerWidth, edgeInsetPx)) return;
    if (pointerTargetYieldsSwipeNav(event.target, event.currentTarget, ignoreSelector)) {
      return;
    }
    dragControls.start(event);
  };

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    const direction = swipeCommitDirection(
      info.offset.x,
      info.velocity.x,
      commitOffsetPx,
      COMMIT_VELOCITY_PX_PER_S,
    );
    if (!direction) return;
    if (direction === "right") {
      if (disableRight) onEdgeBounce?.("right");
      else onSwipeRight();
    } else if (disableLeft) {
      onEdgeBounce?.("left");
    } else {
      onSwipeLeft();
    }
  };

  return (
    <motion.div
      drag="x"
      dragControls={dragControls}
      dragListener={false}
      dragDirectionLock
      dragSnapToOrigin
      dragElastic={0.15}
      dragMomentum={false}
      onPointerDown={handlePointerDown}
      onDragEnd={handleDragEnd}
      className={className}
      style={{ touchAction: "pan-y" }}
    >
      {children}
    </motion.div>
  );
}

const PagingSwipeSurface = forwardRef<SwipeNavigatorHandle, SwipeNavigatorProps>(
  function PagingSwipeSurface(
    {
      onSwipeRight,
      onSwipeLeft,
      disableRight = false,
      disableLeft = false,
      ignoreSelector,
      commitOffsetPx = COMMIT_OFFSET_PX,
      edgeInsetPx = 0,
      onEdgeBounce,
      onHorizontalIntent,
      pageKey,
      canStart,
      onGestureActiveChange,
      children,
      className,
    },
    ref,
  ) {
    const dragControls = useDragControls();
    const rootRef = useRef<HTMLDivElement>(null);
    const x = useMotionValue(0);
    const widthRef = useRef(0);
    const [trackWidth, setTrackWidth] = useState(0);
    const generation = useRef(0);
    const animRef = useRef<{ stop: () => void } | null>(null);
    const intentSent = useRef(false);
    const suppressUntil = useRef(0);
    const activeRef = useRef(false);

    const setActive = (active: boolean) => {
      if (activeRef.current === active) return;
      activeRef.current = active;
      onGestureActiveChange?.(active);
    };

    useLayoutEffect(() => {
      const node = rootRef.current;
      if (!node) return;
      const apply = () => {
        const next = node.offsetWidth;
        widthRef.current = next;
        setTrackWidth((prev) => (prev === next ? prev : next));
      };
      apply();
      const observer = new ResizeObserver(apply);
      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    // The parent swaps in the card that just slid into place. Drop the
    // offset in the same frame so that card is already resting.
    useLayoutEffect(() => {
      generation.current += 1;
      animRef.current?.stop();
      animRef.current = null;
      x.set(0);
    }, [pageKey, x]);

    useEffect(() => {
      const node = rootRef.current;
      if (!node) return;
      const swallow = (event: Event) => {
        if (performance.now() < suppressUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      node.addEventListener("click", swallow, true);
      return () => node.removeEventListener("click", swallow, true);
    }, []);

    const measuredWidth = () => {
      const next = rootRef.current?.offsetWidth ?? widthRef.current;
      if (next > 0) widthRef.current = next;
      return widthRef.current;
    };

    const runAnimation = (target: number, onDone?: () => void) => {
      const gen = ++generation.current;
      animRef.current?.stop();
      const reduced = prefersReducedMotion();
      const controls = animate(x, target, {
        duration: reduced ? 0 : 0.32,
        ease: PAGE_EASE,
      });
      animRef.current = controls;
      void controls.then(() => {
        if (gen !== generation.current) return;
        animRef.current = null;
        onDone?.();
      }, () => {
        /* stopped */
      });
    };

    useImperativeHandle(
      ref,
      () => ({
        peekNext() {
          if (disableLeft || activeRef.current) return;
          if (prefersReducedMotion()) return;
          const width = measuredWidth();
          if (width <= 0) return;
          const peek = Math.min(24, Math.max(14, width * 0.07));
          runAnimation(-peek, () => {
            runAnimation(0);
          });
        },
        slide(direction) {
          const width = measuredWidth();
          const disabled = direction === "left" ? disableLeft : disableRight;
          if (disabled || width <= 0) {
            const bounce = Math.min(36, Math.max(18, (width || 120) * 0.08));
            const target = direction === "left" ? -bounce : bounce;
            setActive(true);
            runAnimation(target, () => {
              runAnimation(0, () => {
                onEdgeBounce?.(direction);
                setActive(false);
              });
            });
            return;
          }
          const target = direction === "left" ? -width : width;
          setActive(true);
          suppressUntil.current = performance.now() + SWIPE_CLICK_SUPPRESS_MS;
          runAnimation(target, () => {
            if (direction === "left") onSwipeLeft();
            else onSwipeRight();
            setActive(false);
          });
        },
      }),
      [disableLeft, disableRight, onEdgeBounce, onSwipeLeft, onSwipeRight, x],
    );

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerStartsInScreenEdge(event.clientX, window.innerWidth, edgeInsetPx)) return;
      if (canStart && !canStart(event.clientX)) return;
      if (pointerTargetYieldsSwipeNav(event.target, event.currentTarget, ignoreSelector)) {
        return;
      }
      generation.current += 1;
      animRef.current?.stop();
      animRef.current = null;
      intentSent.current = false;
      setActive(true);
      dragControls.start(event);
    };

    const noteIntent = (offsetX: number) => {
      if (intentSent.current) return;
      if (Math.abs(offsetX) < SWIPE_TAP_SLOP_PX) return;
      intentSent.current = true;
      suppressUntil.current = performance.now() + SWIPE_CLICK_SUPPRESS_MS;
      onHorizontalIntent?.(offsetX > 0 ? "right" : "left");
    };

    const handleDrag = (_event: unknown, info: PanInfo) => {
      noteIntent(info.offset.x);
    };

    const handleDragEnd = (_event: unknown, info: PanInfo) => {
      if (Math.abs(info.offset.x) >= SWIPE_TAP_SLOP_PX) {
        suppressUntil.current = performance.now() + SWIPE_CLICK_SUPPRESS_MS;
      }
      const direction = swipeCommitDirection(
        info.offset.x,
        info.velocity.x,
        commitOffsetPx,
        COMMIT_VELOCITY_PX_PER_S,
      );
      const width = measuredWidth();
      if (!direction) {
        runAnimation(0, () => setActive(false));
        return;
      }
      const disabled = direction === "right" ? disableRight : disableLeft;
      if (disabled || width <= 0) {
        runAnimation(0, () => {
          onEdgeBounce?.(direction);
          setActive(false);
        });
        return;
      }
      const target = direction === "left" ? -width : width;
      runAnimation(target, () => {
        if (direction === "left") onSwipeLeft();
        else onSwipeRight();
        setActive(false);
      });
    };

    const constraints = {
      left: disableLeft ? 0 : -trackWidth,
      right: disableRight ? 0 : trackWidth,
    };

    return (
      <motion.div
        ref={rootRef}
        drag="x"
        dragControls={dragControls}
        dragListener={false}
        dragDirectionLock
        dragConstraints={constraints}
        dragElastic={0.22}
        dragMomentum={false}
        style={{ x, touchAction: "pan-y" }}
        onPointerDown={handlePointerDown}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        className={className}
      >
        {children}
      </motion.div>
    );
  },
);
