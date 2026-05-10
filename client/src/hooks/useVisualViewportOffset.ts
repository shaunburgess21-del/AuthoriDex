import { useEffect, useState } from "react";

/**
 * Tracks the px gap between the bottom of the layout viewport
 * (`window.innerHeight`) and the bottom of the visual viewport
 * (`window.visualViewport.height + offsetTop`).
 *
 * Why this exists:
 *   On mobile Chrome / iOS Safari (and Chrome iOS, which uses WebKit)
 *   `position: fixed; bottom: 0` is anchored to the layout viewport,
 *   not the visual viewport. When the browser's bottom toolbar
 *   collapses on scroll-down, the visual viewport grows but the
 *   layout viewport stays the same — leaving a transparent strip
 *   between a fixed-bottom element and the new visible bottom edge.
 *   Consumers translate themselves up by this offset so they stay
 *   glued to the actual visible bottom edge during the toolbar's
 *   show/hide animation.
 *
 * Soft-keyboard guard:
 *   When the on-screen keyboard opens, `vv.height` shrinks by
 *   ~250-350px. We deliberately cap the returned offset at
 *   <100px so callers don't fly up on top of the keyboard —
 *   conventional bottom nav bars hide behind the keyboard rather
 *   than dodging it.
 *
 * Returns 0 when the API is unavailable (older browsers, SSR) so
 * callers fall through to plain `bottom: 0` behaviour.
 */
export function useVisualViewportOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const raw = window.innerHeight - vv.height - vv.offsetTop;
      const next = raw > 0 && raw < 100 ? Math.round(raw) : 0;
      setOffset((prev) => (prev === next ? prev : next));
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);

    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return offset;
}
