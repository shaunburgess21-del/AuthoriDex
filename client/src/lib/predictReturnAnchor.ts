/**
 * Predict-page return anchor.
 *
 * When a user taps a card on /predict to open a detail page, we stash the
 * card's data-testid in sessionStorage. When /predict mounts again (typically
 * after the user presses Back from the detail page) we read the anchor and
 * scroll the matching card just below the sticky header stack.
 *
 * Pairs with `history.scrollRestoration = "manual"` set in App.tsx so the
 * browser doesn't race our explicit logic with a stale Y value.
 */

const KEY = "predict-return-anchor";
// Expire anchors quickly so a stale value can't trigger an unwanted scroll
// when the user returns to /predict much later via a different route
// (e.g. detail page → /home → /predict from bottom nav).
const TTL_MS = 5 * 60 * 1000;

export function setPredictReturnAnchor(testId: string): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ testId, ts: Date.now() }),
    );
  } catch {
    // sessionStorage may be unavailable (private mode in some browsers);
    // fall through silently — we'll just lose the anchor on Back.
  }
}

export function consumePredictReturnAnchor(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { testId?: string; ts?: number };
    if (!parsed?.testId || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > TTL_MS) return null;
    return parsed.testId;
  } catch {
    return null;
  }
}

/**
 * Scroll the matching card just below the sticky header stack.
 * Polls briefly because cards rehydrate from React Query and may not be in
 * the DOM on the first frame after mount.
 */
export function scrollToPredictAnchor(testId: string, maxMs = 2500): void {
  // Snap to top first so any stale browser-restored Y is cleared.
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });

  const start = performance.now();
  const tick = () => {
    const el = document.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
    if (el) {
      const header = document.querySelector("header");
      const headerH = header ? header.getBoundingClientRect().height : 0;
      // At most one secondary bar below the main nav: filter pills, weekly timer,
      // or world-markets splitter (pre-timer scope releases filters before timer).
      const stickyOffset = 64; // top-16
      const isStuckAtOffset = (node: HTMLElement) => {
        const top = node.getBoundingClientRect().top;
        return top >= stickyOffset - 2 && top <= stickyOffset + 2;
      };
      const filterBar = document.querySelector<HTMLElement>(
        '[data-testid="predict-section-filter-bar"]',
      );
      const filterBarH =
        filterBar && isStuckAtOffset(filterBar)
          ? filterBar.getBoundingClientRect().height
          : 0;
      const predictBars = Array.from(
        document.querySelectorAll<HTMLElement>("[data-sticky-predict-bar]"),
      );
      const predictBarH = predictBars.reduce((sum, b) => {
        if (isStuckAtOffset(b)) {
          return sum + b.getBoundingClientRect().height;
        }
        return sum;
      }, 0);
      const stickyH = filterBarH + predictBarH;
      const top =
        el.getBoundingClientRect().top + window.scrollY - headerH - stickyH - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      return;
    }
    if (performance.now() - start < maxMs) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}
