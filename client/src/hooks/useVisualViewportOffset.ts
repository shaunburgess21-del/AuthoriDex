import { useEffect, useState } from "react";

/**
 * Tracks the **signed** px delta between the bottom of the visual
 * viewport and the bottom of the layout viewport so a fixed-bottom
 * element can stay glued to the visible bottom edge regardless of
 * which way the two viewports diverge.
 *
 *   delta = vv.offsetTop + vv.height - window.innerHeight
 *
 *   delta > 0  →  visual viewport extends BELOW the layout viewport.
 *                 Happens on Chrome iOS / iOS Safari when the bottom
 *                 toolbar collapses on scroll-down: the visible area
 *                 grows downward but `bottom: 0` of `position: fixed`
 *                 stays anchored to the (smaller) layout viewport,
 *                 leaving a gap. Consumers translate DOWN by +delta
 *                 to close it.
 *
 *   delta < 0  →  visual viewport ends ABOVE the layout viewport.
 *                 Happens when WebKit's URL bar is rendered as part
 *                 of the layout viewport: a `bottom: 0` element would
 *                 be off-screen below the visible area. Consumers
 *                 translate UP by `delta` (negative translateY).
 *
 *   |delta| > 150 → almost certainly the soft keyboard (typical
 *                  iOS keyboard is 250–350px). We deliberately
 *                  return 0 here so the nav stays behind the
 *                  keyboard rather than dodging on top of it; bottom
 *                  nav bars conventionally hide when the keyboard
 *                  opens.
 *
 * Returns 0 when the API is unavailable (older browsers, SSR) so
 * callers fall through to plain `bottom: 0` behaviour.
 *
 * Event sources (all rAF-throttled via `schedule`):
 *   - `vv.resize` fires when the toolbar finishes its show/hide
 *     animation (and on keyboard open/close).
 *   - `vv.scroll` fires on visual-viewport pans (pinch-zoom).
 *   - `window.scroll` ticks during the toolbar animation itself on
 *     WebKit; without it the nav would lag mid-scroll.
 *   - `window.resize` fires when `innerHeight` changes without a
 *     useful `vv.scroll` tick on some Chrome/WebKit builds.
 *   - `orientationchange` clears stale offsets after rotation.
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
      const delta = vv.offsetTop + vv.height - window.innerHeight;
      const next = Math.abs(delta) > 150 ? 0 : Math.round(delta);
      setOffset((prev) => (prev === next ? prev : next));
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return offset;
}
