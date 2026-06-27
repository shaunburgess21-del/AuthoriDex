import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, type PanInfo } from "framer-motion";

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
  children: ReactNode;
  className?: string;
}

/** Distance (px) the user must drag horizontally to commit a navigation. */
const COMMIT_OFFSET_PX = 80;
/** Velocity (px/s) that triggers a fast-flick navigation under the offset
 * threshold. Lets a quick thumb flick advance a card even if the finger
 * doesn't physically travel 80px. */
const COMMIT_VELOCITY_PX_PER_S = 500;

/**
 * Touch-only horizontal swipe wrapper for the Vote detail pages.
 *
 * Why touch-only: desktop users have keyboard + on-screen arrow buttons.
 * Enabling drag on a mouse pointer would let an accidental click-drag
 * navigate to the next card while the user thinks they're text-selecting.
 * `pointer: coarse` is the standard CSS feature query for primary touch
 * input — it's true on phones and tablets, false on desktops/laptops
 * (even hybrid laptops with a touchscreen typically report `pointer:
 * fine` because the mouse is the primary pointer).
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
 */
export function SwipeNavigator({
  onSwipeRight,
  onSwipeLeft,
  disableRight = false,
  disableLeft = false,
  ignoreSelector,
  commitOffsetPx = COMMIT_OFFSET_PX,
  children,
  className,
}: SwipeNavigatorProps) {
  const [isTouch, setIsTouch] = useState(false);
  const ignoredGestureRef = useRef(false);

  useEffect(() => {
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
  }, []);

  if (!isTouch) {
    return <div className={className}>{children}</div>;
  }

  const handleDragStart = (event: MouseEvent | TouchEvent | PointerEvent) => {
    ignoredGestureRef.current = false;
    if (!ignoreSelector) return;
    const target = event.target;
    if (target instanceof Element && target.closest(ignoreSelector)) {
      ignoredGestureRef.current = true;
    }
  };

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    if (ignoredGestureRef.current) {
      ignoredGestureRef.current = false;
      return;
    }

    const { offset, velocity } = info;
    const absX = Math.abs(offset.x);
    const absVx = Math.abs(velocity.x);

    if (absX < commitOffsetPx && absVx < COMMIT_VELOCITY_PX_PER_S) return;

    if (offset.x > 0) {
      if (!disableRight) onSwipeRight();
    } else {
      if (!disableLeft) onSwipeLeft();
    }
  };

  return (
    <motion.div
      drag="x"
      dragDirectionLock
      dragSnapToOrigin
      dragElastic={0.15}
      dragMomentum={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={className}
      style={{ touchAction: "pan-y" }}
    >
      {children}
    </motion.div>
  );
}
