import { useRef, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "framer-motion";
import { Check, Mail, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Distance (px) the user must drag horizontally to commit an action. */
const COMMIT_OFFSET_PX = 80;
/** Velocity (px/s) that commits a fast flick under the offset threshold. */
const COMMIT_VELOCITY_PX_PER_S = 500;
/** Max drag distance before rubber-banding. */
const DRAG_LIMIT_PX = 100;
/** Horizontal movement above this suppresses the row click handler. */
export const SWIPE_CLICK_GUARD_PX = 10;
/** Delete affordance begins fading in after this much left/right drag (px). */
const DELETE_REVEAL_START_PX = 10;
/** Width of the red delete strip revealed beside the row. */
const DELETE_STRIP_WIDTH_PX = 64;

type SwipeAction = "read" | "delete";

interface NotificationSwipeableRowProps {
  invertSwipe: boolean;
  isUnread: boolean;
  disabled?: boolean;
  onToggleRead: () => void;
  onDismiss: () => void;
  /** Fired when a horizontal drag exceeds the click-guard threshold. */
  onDragConsumed?: () => void;
  children: ReactNode;
}

/**
 * Mobile-only reveal-behind swipe wrapper for notification rows.
 * Default: swipe right = toggle read/unread, swipe left = delete.
 * When `invertSwipe`, those directions swap.
 */
export function NotificationSwipeableRow({
  invertSwipe,
  isUnread,
  disabled = false,
  onToggleRead,
  onDismiss,
  onDragConsumed,
  children,
}: NotificationSwipeableRowProps) {
  const x = useMotionValue(0);
  const dragConsumedRef = useRef(false);

  const leftAction: SwipeAction = invertSwipe ? "read" : "delete";
  const rightAction: SwipeAction = invertSwipe ? "delete" : "read";

  const leftReveal = useTransform(x, [-DELETE_REVEAL_START_PX, -DRAG_LIMIT_PX], [0, 1]);
  const rightReveal = useTransform(x, [DELETE_REVEAL_START_PX, DRAG_LIMIT_PX], [0, 1]);

  const commitSwipe = (direction: "left" | "right") => {
    const action = direction === "right" ? rightAction : leftAction;
    if (action === "read") {
      onToggleRead();
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
      <div
        className="absolute inset-0 flex justify-between pointer-events-none"
        aria-hidden="true"
      >
        {leftAction === "delete" ? (
          <DeleteStrip reveal={leftReveal} side="left" />
        ) : (
          <ReadStrip reveal={leftReveal} side="left" isUnread={isUnread} />
        )}
        {rightAction === "delete" ? (
          <DeleteStrip reveal={rightReveal} side="right" />
        ) : (
          <ReadStrip reveal={rightReveal} side="right" isUnread={isUnread} />
        )}
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

function DeleteStrip({
  reveal,
  side,
}: {
  reveal: MotionValue<number>;
  side: "left" | "right";
}) {
  const iconScale = useTransform(reveal, [0, 1], [0.55, 1]);
  const labelOpacity = useTransform(reveal, [0.5, 1], [0, 1]);

  return (
    <motion.div
      style={{ opacity: reveal, width: DELETE_STRIP_WIDTH_PX }}
      className={cn(
        "flex shrink-0 items-center justify-center bg-red-600 dark:bg-red-700",
        side === "left" ? "order-first" : "order-last",
      )}
    >
      <motion.div
        style={{ scale: iconScale }}
        className="flex flex-col items-center gap-0.5 text-white"
      >
        <Trash2 className="h-6 w-6" aria-hidden="true" />
        <motion.span
          style={{ opacity: labelOpacity }}
          className="text-[10px] font-semibold leading-none"
        >
          Delete
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

function ReadStrip({
  reveal,
  side,
  isUnread,
}: {
  reveal: MotionValue<number>;
  side: "left" | "right";
  isUnread: boolean;
}) {
  return (
    <motion.div
      style={{ opacity: reveal }}
      className={cn(
        "flex flex-1 items-center px-4 min-w-[72px]",
        side === "left" ? "justify-start" : "justify-end",
        isUnread
          ? "bg-emerald-600 dark:bg-emerald-700"
          : "bg-slate-500 dark:bg-slate-600",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-white text-xs font-semibold",
          side === "right" && "flex-row-reverse",
        )}
      >
        {isUnread ? (
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span>{isUnread ? "Read" : "Unread"}</span>
      </div>
    </motion.div>
  );
}
