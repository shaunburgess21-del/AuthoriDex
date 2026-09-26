import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { navigateInApp } from "@/lib/nativeDeepLinks";
import {
  NATIVE_EXTERNAL_ATTR,
  classifyExternalLink,
  type ExternalLinkDecision,
} from "@/lib/nativeExternalLink";

/**
 * Android-only click and `window.open` policy. No-op on web and iOS, so
 * `target="_blank"` on the website still opens a new tab. Does not register
 * `appUrlOpen` or `browserFinished` listeners — Phase 6 owns those.
 */

const SLOT_KEY = "__voxdexNativeExternalLinks";

function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

function applyDecision(decision: ExternalLinkDecision): void {
  switch (decision.kind) {
    case "passthrough":
    case "block":
      return;
    case "in_app":
      navigateInApp(decision.path);
      return;
    case "system":
      window.location.assign(decision.url);
      return;
    case "external":
      void Browser.open({ url: decision.url }).catch((error: unknown) => {
        console.error("[external-link] Browser.open failed:", error);
        window.location.assign(decision.url);
      });
      return;
  }
}

function onDocumentClick(event: MouseEvent): void {
  if (event.defaultPrevented) return;
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) return;
  const anchor = eventTarget.closest("a");
  if (!(anchor instanceof HTMLAnchorElement)) return;

  const href = anchor.getAttribute("href");
  if (href == null || href.trim() === "") return;

  const decision = classifyExternalLink(href, {
    currentOrigin: window.location.origin,
    baseHref: window.location.href,
    target: anchor.getAttribute("target"),
    forceExternal: anchor.hasAttribute(NATIVE_EXTERNAL_ATTR),
  });
  if (decision.kind === "passthrough") return;

  event.preventDefault();
  event.stopPropagation();
  applyDecision(decision);
}

function patchWindowOpen(): void {
  const original = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string): Window | null => {
    if (url == null || String(url).trim() === "") {
      return original(url, target, features);
    }
    const decision = classifyExternalLink(String(url), {
      currentOrigin: window.location.origin,
      baseHref: window.location.href,
      target,
      newContext: true,
    });
    if (decision.kind === "passthrough") {
      return original(String(url), target, features);
    }
    applyDecision(decision);
    return null;
  };
}

/** Idempotent. Safe to call from `main.tsx` on every platform. */
export function installNativeExternalLinkPolicy(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!isAndroidNative()) return;

  const slot = globalThis as typeof globalThis & { [SLOT_KEY]?: boolean };
  if (slot[SLOT_KEY]) return;
  slot[SLOT_KEY] = true;

  document.addEventListener("click", onDocumentClick, true);
  patchWindowOpen();
}
