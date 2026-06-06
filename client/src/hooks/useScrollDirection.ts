import { useEffect, useRef, useState } from "react";

export type ScrollDirection = "up" | "down";

/**
 * Tracks the page scroll direction for semi-sticky bars (reveal on scroll-up,
 * hide on scroll-down). Ignores tiny jitters via a movement threshold and
 * always reports "up" while near the top so bars don't hide on initial load.
 */
export function useScrollDirection(threshold = 6): ScrollDirection {
  const [direction, setDirection] = useState<ScrollDirection>("up");
  const lastY = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  const ticking = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY.current;
        if (Math.abs(delta) >= threshold) {
          // Near the top we never hide.
          setDirection(y <= 64 || delta < 0 ? "up" : "down");
          lastY.current = y;
        }
        ticking.current = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return direction;
}
