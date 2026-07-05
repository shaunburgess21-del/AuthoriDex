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
 * GATED TO iOS WebKit ONLY. On Chrome/Android, Samsung Internet,
 * Firefox Android, and other engines, `position: fixed; bottom: 0`
 * already tracks the visible bottom edge as the URL bar animates,
 * and `window.innerHeight` / `vv.height` desync for a few frames
 * during the URL-bar show/hide animation in BOTH directions:
 *   - scroll-up (URL bar reveals): vv.height shrinks before
 *     innerHeight does → transient negative delta → translate UP
 *     would lift the nav off the bottom (visible gap above the
 *     system gesture bar).
 *   - scroll-down (URL bar collapses): vv.height grows before
 *     innerHeight does → transient positive delta → translate DOWN
 *     would push the nav below the visible area (nav appears to
 *     disappear for a few seconds until innerHeight catches up).
 * Both manifest as user-visible jitter. On non-iOS we therefore
 * return 0 unconditionally and rely on `bottom: 0` + safe-area-inset.
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
 *
 * Settle pass: event-driven samples can land mid-toolbar-animation
 * while `vv.height` and `window.innerHeight` are desynced. If no
 * further event fires after the viewports converge, that stale delta
 * would stick and the nav would stay detached until the next scroll.
 * So every scheduled measurement also (re)starts a trailing timer
 * that re-measures ~250ms after events go quiet, once the browser
 * has settled on final viewport numbers.
 */
export function useVisualViewportOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const isIOSWebKit =
      /iP(ad|hone|od)/.test(navigator.platform) ||
      (navigator.userAgent.includes("Mac") && "ontouchend" in document);
    if (!isIOSWebKit) return;

    let frame = 0;
    let settleTimer = 0;
    const update = () => {
      frame = 0;
      const delta = vv.offsetTop + vv.height - window.innerHeight;
      const next = Math.abs(delta) > 150 ? 0 : Math.round(delta);
      setOffset((prev) => (prev === next ? prev : next));
    };

    const SETTLE_MS = 250;
    const schedule = () => {
      // Trailing settle pass — see the "Settle pass" note above.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(update, SETTLE_MS);
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
      window.clearTimeout(settleTimer);
    };
  }, []);

  return offset;
}
