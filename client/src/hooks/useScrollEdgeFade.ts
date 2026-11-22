import { useEffect, useState, type RefObject } from "react";
import {
  measureScrollEdge,
  scrollEdgeMaskClass,
  type ScrollEdge,
} from "@/lib/scrollEdgeFade";

/**
 * Track which sides of a horizontal scroller still have more to reveal.
 * Updates on scroll, element resize, child changes, and window resize.
 */
export function useScrollEdgeFade(ref: RefObject<HTMLElement | null>) {
  const [edge, setEdge] = useState<ScrollEdge>("none");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measureScrollEdge({
          scrollLeft: el.scrollLeft,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        });
        setEdge((prev) => (prev === next ? prev : next));
      });
    };

    const ro = new ResizeObserver(update);
    const observeChildren = () => {
      for (const child of Array.from(el.children)) {
        ro.observe(child);
      }
    };

    update();
    ro.observe(el);
    observeChildren();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    const mo = new MutationObserver(() => {
      observeChildren();
      update();
    });
    mo.observe(el, { childList: true });

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);

  return { edge, maskClass: scrollEdgeMaskClass(edge) };
}
