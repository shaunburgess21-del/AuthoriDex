import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Returns how many px to translate a top bar up, tied 1:1 to scroll delta and
 * clamped to the element's height. Always 0 near the top so it never hides on
 * load. Drives X-style scroll-linked hide/reveal.
 *
 * Optional `resetKey`: when it changes, the offset resets to 0 so the bar
 * re-reveals (e.g. on section-toggle or filter changes).
 */
/**
 * Imperative variant of `useScrollHideOffset`: instead of returning state (which
 * re-renders the whole page on every scroll frame), it writes `transform`,
 * `opacity` and `pointer-events` directly onto the element inside the rAF loop.
 * No CSS transition while tracking, so the bar follows the finger/wheel 1:1.
 *
 * Opacity fades proportionally because the bar parks under a translucent
 * blurred header and would otherwise ghost through it.
 *
 * `resetKey` changes (and entering the top zone) reveal the bar with a brief
 * eased transition that is cleared afterwards so it never affects tracking.
 */
export function useScrollHideTransform(ref: RefObject<HTMLElement>, resetKey?: unknown): void {
  const offsetRef = useRef(0);
  const lastY = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  const ticking = useRef(false);
  const clearTransitionTimer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(false);

  useEffect(() => {
    const apply = (el: HTMLElement, offset: number) => {
      const max = el.offsetHeight;
      el.style.transform = `translateY(-${offset}px)`;
      el.style.opacity = max > 0 ? String(1 - offset / max) : "1";
      el.style.pointerEvents = max > 0 && offset >= max ? "none" : "";
    };

    const revealSmoothly = (el: HTMLElement) => {
      offsetRef.current = 0;
      el.style.transition = "transform 150ms ease-out, opacity 150ms ease-out";
      apply(el, 0);
      clearTimeout(clearTransitionTimer.current);
      clearTransitionTimer.current = setTimeout(() => {
        el.style.transition = "";
      }, 180);
    };

    // Reset-key reveal (skip the initial mount — the bar starts visible).
    const el = ref.current;
    if (el && mounted.current) revealSmoothly(el);
    mounted.current = true;

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const target = ref.current;
        if (!target) return;
        const y = window.scrollY;
        const delta = y - lastY.current;
        lastY.current = y;
        if (y <= 64) {
          if (offsetRef.current !== 0) revealSmoothly(target);
          return;
        }
        const max = target.offsetHeight;
        const next = Math.min(max, Math.max(0, offsetRef.current + delta));
        if (next === offsetRef.current) return;
        offsetRef.current = next;
        apply(target, next);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(clearTransitionTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, resetKey]);
}

export function useScrollHideOffset(ref: RefObject<HTMLElement>, resetKey?: unknown): number {
  const [offset, setOffset] = useState(0);
  const lastY = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  const ticking = useRef(false);

  useEffect(() => {
    setOffset(0);
  }, [resetKey]);

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
