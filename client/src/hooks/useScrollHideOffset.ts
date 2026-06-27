import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Returns how many px to translate a top bar up, tied 1:1 to scroll delta and
 * clamped to the element's height. Always 0 near the top so it never hides on
 * load. Drives X-style scroll-linked hide/reveal.
 */
export function useScrollHideOffset(ref: RefObject<HTMLElement>): number {
  const [offset, setOffset] = useState(0);
  const lastY = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  const ticking = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY.current;
        lastY.current = y;
        const max = ref.current?.offsetHeight ?? 0;
        setOffset((prev) => (y <= 64 ? 0 : Math.min(max, Math.max(0, prev + delta))));
        ticking.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ref]);

  return offset;
}
