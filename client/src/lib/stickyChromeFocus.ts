/**
 * Vaul drawers default `autoFocus` to false and then prevent Radix from
 * moving focus. The vote chip bar (`sticky top-16`) keeps the focused
 * Categories button while the open drawer aria-hides the page, which is the
 * Chrome "Blocked aria-hidden" warning.
 *
 * Inert drops that focus before aria-hidden is applied. Wired drawers also
 * move focus into the overlay when it was sitting in the chip bar.
 */

export const STICKY_CHROME_SELECTOR = "[data-sticky-chrome], .sticky.top-16";

export const OPEN_OVERLAY_SELECTOR =
  "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']";

export function shouldMoveFocusIntoOverlay(input: {
  insideOverlay: boolean;
  inStickyChrome: boolean;
  /** Focus sits on body/documentElement, including right after inert blurred the chip bar. */
  displacedToTop: boolean;
  defaultPrevented: boolean;
}): boolean {
  if (input.insideOverlay) return false;
  // The chip bar is inside the tree the overlay is about to aria-hide.
  // Move even if a caller already cancelled Radix's default focus.
  if (input.inStickyChrome) return true;
  if (input.defaultPrevented) return false;
  return input.displacedToTop;
}

export function overlayIsOpen(doc: Pick<Document, "querySelector">): boolean {
  return doc.querySelector(OPEN_OVERLAY_SELECTOR) != null;
}

function chromeNodes(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll(STICKY_CHROME_SELECTOR)].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

/** Mark sticky chip bars inert while `overlay` is open, and clear them when it is not. */
export function syncStickyChromeInert(doc: Document, overlay: HTMLElement | null): void {
  for (const node of chromeNodes(doc)) {
    if (overlay && (overlay.contains(node) || node.contains(overlay))) {
      node.removeAttribute("inert");
      continue;
    }
    if (overlay) node.setAttribute("inert", "");
    else node.removeAttribute("inert");
  }
}

export function releaseStickyChromeOnOpen(event: Event): void {
  const content = event.currentTarget;
  if (!(content instanceof HTMLElement)) return;
  const active = document.activeElement;
  const inStickyChrome = active instanceof Element && !!active.closest(STICKY_CHROME_SELECTOR);
  const insideOverlay = active instanceof Node && content.contains(active);
  syncStickyChromeInert(document, content);
  if (!shouldMoveFocusIntoOverlay({
    insideOverlay,
    inStickyChrome,
    displacedToTop:
      active == null || active === document.body || active === document.documentElement,
    defaultPrevented: event.defaultPrevented,
  })) {
    return;
  }
  if (!content.hasAttribute("tabindex")) content.tabIndex = -1;
  content.focus({ preventScroll: true });
}

export function releaseStickyChromeOnClose(): void {
  const open = document.querySelector(OPEN_OVERLAY_SELECTOR);
  syncStickyChromeInert(document, open instanceof HTMLElement ? open : null);
}

/**
 * Safety net for drawers that don't go through the shared Content wrappers.
 * Sets inert when an overlay is open so focus cannot remain in the chip bar.
 * Does not move focus itself — that would run before Radix's onOpenAutoFocus
 * and skip the drawer's own focus target.
 */
export function bindStickyChromeFocusGuard(doc: Document = document): () => void {
  const sync = () => {
    const open = doc.querySelector(OPEN_OVERLAY_SELECTOR);
    syncStickyChromeInert(doc, open instanceof HTMLElement ? open : null);
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(STICKY_CHROME_SELECTOR)) return;
    const open = doc.querySelector(OPEN_OVERLAY_SELECTOR);
    if (!(open instanceof HTMLElement) || open.contains(target)) return;
    if (!open.hasAttribute("tabindex")) open.tabIndex = -1;
    open.focus({ preventScroll: true });
  };

  const observer = new MutationObserver(sync);
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-state"],
  });
  doc.addEventListener("focusin", onFocusIn, true);
  sync();

  return () => {
    observer.disconnect();
    doc.removeEventListener("focusin", onFocusIn, true);
    syncStickyChromeInert(doc, null);
  };
}
