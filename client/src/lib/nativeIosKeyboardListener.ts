import { Capacitor } from "@capacitor/core";
import {
  elementIsTextEntry,
  fieldNeedsScroll,
  snapTypeBlocksVerticalScroll,
} from "@/lib/nativeKeyboard";
import {
  IOS_KEYBOARD_ACCESSORY_VISIBLE,
  shouldInstallIosKeyboard,
} from "@/lib/iosKeyboard";

/**
 * iOS Capacitor keyboard. No-op on web, PWA, and Android.
 *
 * Native resize is configured in capacitor.config.ts. This listener
 * shows the accessory bar and, after the keyboard animation, scrolls a
 * focused field that is still covered (a nested scroller that did not
 * move with the WebView).
 */

const SLOT_KEY = "__voxdexIosKeyboard";

function isIosNative(): boolean {
  try {
    return shouldInstallIosKeyboard(Capacitor.isNativePlatform(), Capacitor.getPlatform());
  } catch {
    return false;
  }
}

function insideVerticalSnap(el: HTMLElement): boolean {
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    if (snapTypeBlocksVerticalScroll(getComputedStyle(parent).scrollSnapType)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function scrollFocusedField(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !elementIsTextEntry(active)) return;
  if (!active.isConnected || insideVerticalSnap(active)) return;
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const height = vv?.height ?? window.innerHeight;
  const rect = active.getBoundingClientRect();
  if (!fieldNeedsScroll(rect, { top, bottom: top + height })) return;
  active.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Idempotent. Safe to call from `main.tsx` on every platform. */
export function installIosKeyboard(): void {
  if (typeof window === "undefined") return;
  if (!isIosNative()) return;

  const slot = globalThis as typeof globalThis & { [SLOT_KEY]?: boolean };
  if (slot[SLOT_KEY]) return;
  slot[SLOT_KEY] = true;

  void import("@capacitor/keyboard")
    .then(({ Keyboard }) => {
      void Keyboard.setAccessoryBarVisible({
        isVisible: IOS_KEYBOARD_ACCESSORY_VISIBLE,
      }).catch(() => {
        // Accessory bar is iPhone-only. A missing implementation must not block typing.
      });
      return Keyboard.addListener("keyboardDidShow", () => {
        scrollFocusedField();
      });
    })
    .catch(() => {
      // The page still works if the plugin bridge is not ready.
    });
}
