import { useEffect } from "react";

/**
 * Smoothly scroll to the element matching `window.location.hash` once
 * it appears in the DOM.
 *
 * Why a custom hook instead of relying on the browser:
 *   - Vite + Wouter is a SPA; the browser only honours hash fragments
 *     on full page loads, not on `pushState` route transitions.
 *   - PredictPage renders its sections (jackpot, updown, h2h, race,
 *     community) lazily once data loads. A naive "scroll on mount"
 *     fires before the target exists, so we keep retrying for a
 *     bounded window.
 *   - A sticky header occupies ~56px at the top; we honour CSS
 *     `scroll-margin-top` so each section can opt into its own
 *     visual offset (kept in `client/src/index.css`).
 *
 * Pass the dependency array of "things that affect rendering of the
 * target element" — typically the same data flags that guard the
 * sections — so we re-attempt the scroll when the section finally
 * mounts.
 */
export function useScrollToHash(deps: ReadonlyArray<unknown> = []) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.location.hash;
    if (!raw) return;
    const id = raw.replace(/^#/, "");
    if (!id) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 25; // ~5 seconds at 200ms intervals

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) {
        window.setTimeout(tryScroll, 200);
      }
    };

    // Defer one tick so React has flushed the initial render before
    // we look up the element.
    const handle = window.setTimeout(tryScroll, 0);

    const handleHashChange = () => {
      attempts = 0;
      tryScroll();
    };
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      window.removeEventListener("hashchange", handleHashChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
