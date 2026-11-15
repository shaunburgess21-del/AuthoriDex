import type { ReactNode } from "react";
import { motion } from "framer-motion";

// Vote-hub "Not voted" mode card transition. A voted card dwells on its
// results, then shrinks + drifts toward the filter toggle while fading out;
// the grid reflows the next card into the vacated slot.
const HIDE_EXIT_REST = { opacity: 1, scale: 1, x: 0, y: 0 } as const;
const HIDE_EXIT_FLY = { opacity: 0, scale: 0.12, x: -160, y: -200 } as const;
const HIDE_EXIT_FLY_TRANSITION = { duration: 0.45, ease: "easeIn" } as const;
const HIDE_EXIT_SETTLE_TRANSITION = { duration: 0.2, ease: "easeOut" } as const;
const HIDE_EXIT_LAYOUT_TRANSITION = { duration: 0.3, ease: "easeOut" } as const;

/**
 * Card wrapper for the Vote-hub Hidden-mode transition. The outer layer owns
 * the grid `layout` reflow (so neighbours slide into the vacated slot on
 * desktop); the inner layer plays the shrink + drift-toward-the-toggle fly.
 * On mobile the fly + layout are disabled — the carousel advance (slideNext)
 * provides the exit motion instead.
 */
export function HideExitCard({
  isMobile,
  exiting,
  children,
}: {
  isMobile: boolean;
  exiting: boolean;
  children: ReactNode;
}) {
  const flying = exiting && !isMobile;
  return (
    <motion.div
      layout={isMobile ? false : "position"}
      transition={HIDE_EXIT_LAYOUT_TRANSITION}
      className="h-full"
    >
      <motion.div
        className="h-full"
        style={{ transformOrigin: "top left" }}
        animate={flying ? HIDE_EXIT_FLY : HIDE_EXIT_REST}
        transition={flying ? HIDE_EXIT_FLY_TRANSITION : HIDE_EXIT_SETTLE_TRANSITION}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
