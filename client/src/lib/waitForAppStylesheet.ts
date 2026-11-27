const APP_CSS_TIMEOUT_MS = 8_000;

/**
 * Resolves when every non-blocking app stylesheet (class app-stylesheet)
 * has been promoted to rel=stylesheet, or when the timeout fires.
 * Dev and noscript pages have no such link and resolve immediately.
 * One frame after the sheets apply gives layout a chance to settle
 * before React replaces #boot-shell.
 */
export function waitForAppStylesheet(timeoutMs = APP_CSS_TIMEOUT_MS): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const deadline = Date.now() + timeoutMs;

  const applied = () => {
    const links = Array.from(document.querySelectorAll("link.app-stylesheet"));
    if (links.length === 0) return true;
    return links.every((node) => (node as HTMLLinkElement).rel === "stylesheet");
  };

  if (applied()) {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  return new Promise((resolve) => {
    const tick = () => {
      if (applied() || Date.now() >= deadline) {
        window.requestAnimationFrame(() => resolve());
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
}
