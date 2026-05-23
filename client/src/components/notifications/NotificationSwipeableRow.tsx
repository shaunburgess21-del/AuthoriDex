import { useRef, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Distance (px) the user must drag horizontally to commit an action. */
const COMMIT_OFFSET_PX = 80;
/** Velocity (px/s) that commits a fast flick under the offset threshold. */
const COMMIT_VELOCITY_PX_PER_S = 500;
/** Max drag distance before rubber-banding. */
const DRAG_LIMIT_PX = 100;
/** Horizontal movement above this suppresses the row click handler. */
export const SWIPE_CLICK_GUARD_PX = 10;

type SwipeAction = "read" | "delete";

interface NotificationSwipeableRowProps {
  invertSwipe: boolean;
  isUnread: boolean;
  disabled?: boolean;
  onMarkRead: () => void;
  onDismiss: () => void;
  /** Fired when a horizontal drag exceeds the click-guard threshold. */
  onDragConsumed?: () => void;
  children: ReactNode;
}

/**
 * Mobile-only reveal-behind swipe wrapper for notification rows.
 * Default: swipe right = mark read, swipe left = delete.
 * When `invertSwipe`, those directions swap.
 */
export function NotificationSwipeableRow({
  invertSwipe,
  isUnread,
  disabled = false,
  onMarkRead,
  onDismiss,
  onDragConsumed,
  children,
}: NotificationSwipeableRowProps) {
  const x = useMotionValue(0);
  const dragConsumedRef = useRef(false);

  const leftAction: SwipeAction = invertSwipe ? "read" : "delete";
  const rightAction: SwipeAction = invertSwipe ? "delete" : "read";

  const leftReveal = useTransform(x, [-DRAG_LIMIT_PX, 0], [1, 0]);
  const rightReveal = useTransform(x, [0, DRAG_LIMIT_PX], [0, 1]);

  const commitSwipe = (direction: "left" | "right") => {
    const action = direction === "right" ? rightAction : leftAction;
    if (action === "read") {
      if (!isUnread) {
        void animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
        return;
      }
      onMarkRead();
      void animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
      return;
    }
    onDismiss();
    void animate(x, direction === "left" ? -DRAG_LIMIT_PX * 2 : DRAG_LIMIT_PX * 2, {
      type: "tween",
      duration: 0.15,
    });
  };

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    const { offset, velocity } = info;

    if (Math.abs(offset.x) > SWIPE_CLICK_GUARD_PX && !dragConsumedRef.current) {
      dragConsumedRef.current = true;
      onDragConsumed?.();
    }

    const absX = Math.abs(offset.x);
    const absVx = Math.abs(velocity.x);
    const committed =
      absX >= COMMIT_OFFSET_PX || absVx >= COMMIT_VELOCITY_PX_PER_S;

    if (!committed) {
      void animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
      return;
    }

    if (offset.x > 0) {
      commitSwipe("right");
    } else {
      commitSwipe("left");
    }
  };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex pointer-events-none" aria-hidden="true">
        <SwipeActionPane action={leftAction} reveal={leftReveal} side="left" />
        <SwipeActionPane action={rightAction} reveal={rightReveal} side="right" />
      </div>

      <motion.div
        drag={disabled ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: -DRAG_LIMIT_PX, right: DRAG_LIMIT_PX }}
        dragElastic={0.2}
        dragMomentum={false}
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={handleDragEnd}
        className={cn("relative bg-background", disabled && "pointer-events-none")}
      >
        {children}
      </motion.div>
    </div>
  );
}

function SwipeActionPane({
  action,
  reveal,
  side,
}: {
  action: SwipeAction;
  reveal: ReturnType<typeof useTransform<number, number>>;
  side: "left" | "right";
}) {
  const isRead = action === "read";
  return (
    <motion.div
      style={{ opacity: reveal }}
      className={cn(
        "flex-1 flex items-center px-4",
        side === "left" ? "justify-start" : "justify-end",
        isRead
          ? "bg-emerald-600 dark:bg-emerald-700"
          : "bg-red-600 dark:bg-red-700",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-white text-xs font-semibold",
          side === "right" && "flex-row-reverse",
        )}
      >
        {isRead ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{isRead ? "Read" : "Delete"}</span>
      </div>
    </motion.div>
  );
}
