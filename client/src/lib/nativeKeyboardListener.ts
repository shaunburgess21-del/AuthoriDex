import { Capacitor } from "@capacitor/core";
import {
  ANDROID_KEYBOARD_OPEN_CLASS,
  KEYBOARD_KEEP_FOCUS_SELECTOR,
  blurTextEntry,
  elementIsTextEntry,
  fieldNeedsScroll,
  reduceKeyboardViewport,
  shouldBlurTextEntryOnPathChange,
  shouldDismissKeyboardOnPointer,
  snapTypeBlocksVerticalScroll,
  type KeyboardViewportState,
} from "@/lib/nativeKeyboard";

/**
 * Survives Vite re-evaluating this module. See nativeBackListener.
 */
const SLOT_KEY = "__voxdexAndroidKeyboard";

interface KeyboardSlot {
  installed: boolean;
  restoreHistory: (() => void) | null;
}

function keyboardSlot(): KeyboardSlot {
  const g = globalThis as typeof globalThis & { [SLOT_KEY]?: KeyboardSlot };
  if (!g[SLOT_KEY]) {
    g[SLOT_KEY] = { installed: false, restoreHistory: null };
  }
  return g[SLOT_KEY];
}

function elementFromEventTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function insideVerticalSnap(el: HTMLElement): boolean {
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    if (snapTypeBlocksVerticalScroll(getComputedStyle(parent).scrollSnapType)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function scrollFieldIntoView(el: HTMLElement): void {
  if (!el.isConnected || insideVerticalSnap(el)) return;
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const height = vv?.height ?? window.innerHeight;
  const rect = el.getBoundingClientRect();
  if (!fieldNeedsScroll(rect, { top, bottom: top + height })) return;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function installPathnameBlur(slot: KeyboardSlot): void {
  let lastPath = window.location.pathname;
  const onPathMaybeChanged = () => {
    const next = window.location.pathname;
    const before = lastPath;
    lastPath = next;
    if (shouldBlurTextEntryOnPathChange(before, next, elementIsTextEntry(document.activeElement))) {
      blurTextEntry(document.activeElement);
    }
  };

  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);
  history.pushState = ((...args: Parameters<History["pushState"]>) => {
    originalPush(...args);
    onPathMaybeChanged();
  }) as History["pushState"];
  history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    originalReplace(...args);
    onPathMaybeChanged();
  }) as History["replaceState"];
  window.addEventListener("popstate", onPathMaybeChanged);

  slot.restoreHistory = () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", onPathMaybeChanged);
  };
}

export function removeNativeKeyboardListener(): void {
  const slot = keyboardSlot();
  slot.restoreHistory?.();
  slot.restoreHistory = null;
  slot.installed = false;
  if (typeof document !== "undefined") {
    document.documentElement.classList.remove(ANDROID_KEYBOARD_OPEN_CLASS);
  }
}

/**
 * Android Capacitor only. Tracks IME overlap, hides the bottom nav via
 * `html.android-keyboard-open`, scrolls a focused field into view, and
 * dismisses the keyboard on pathname changes and empty-space taps.
 */
export function installNativeKeyboardListener(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  const slot = keyboardSlot();
  if (slot.installed) return;
  slot.installed = true;

  const state: KeyboardViewportState = { closedInnerHeight: window.innerHeight };
  let frame = 0;
  let scrollTimer = 0;
  let orientationTimer = 0;

  const sync = () => {
    frame = 0;
    const vv = window.visualViewport;
    const active = document.activeElement;
    const next = reduceKeyboardViewport(state, {
      innerHeight: window.innerHeight,
      visualHeight: vv?.height ?? window.innerHeight,
      textEntryFocused: elementIsTextEntry(active),
    });
    state.closedInnerHeight = next.closedInnerHeight;
    document.documentElement.classList.toggle(ANDROID_KEYBOARD_OPEN_CLASS, next.open);
    if (next.open && active instanceof HTMLElement) scrollFieldIntoView(active);
  };

  const scheduleSync = () => {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(sync);
  };

  const scheduleScroll = () => {
    window.clearTimeout(scrollTimer);
    scheduleSync();
    scrollTimer = window.setTimeout(sync, 300);
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = elementFromEventTarget(event.target);
    const targetKeepsFocus = Boolean(target?.closest(KEYBOARD_KEEP_FOCUS_SELECTOR));
    if (
      !shouldDismissKeyboardOnPointer({
        textEntryFocused: elementIsTextEntry(document.activeElement),
        targetKeepsFocus,
      })
    ) {
      return;
    }
    blurTextEntry(document.activeElement);
  };

  const onFocusIn = () => {
    if (!elementIsTextEntry(document.activeElement)) return;
    scheduleScroll();
  };

  const onOrientation = () => {
    window.clearTimeout(orientationTimer);
    // Wait until the new layout viewport has settled, then treat that
    // height as closed. Resetting immediately races the resize.
    orientationTimer = window.setTimeout(() => {
      state.closedInnerHeight = window.innerHeight;
      sync();
    }, 350);
  };

  installPathnameBlur(slot);
  sync();
  window.visualViewport?.addEventListener("resize", scheduleSync);
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("orientationchange", onOrientation);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("pointerdown", onPointerDown, true);

  const restoreHistory = slot.restoreHistory;
  slot.restoreHistory = () => {
    restoreHistory?.();
    window.visualViewport?.removeEventListener("resize", scheduleSync);
    window.removeEventListener("resize", scheduleSync);
    window.removeEventListener("orientationchange", onOrientation);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("pointerdown", onPointerDown, true);
    if (frame !== 0) window.cancelAnimationFrame(frame);
    window.clearTimeout(scrollTimer);
    window.clearTimeout(orientationTimer);
    document.documentElement.classList.remove(ANDROID_KEYBOARD_OPEN_CLASS);
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeNativeKeyboardListener();
  });
}

installNativeKeyboardListener();
