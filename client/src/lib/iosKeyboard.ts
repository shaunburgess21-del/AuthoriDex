/**
 * iOS keyboard and input decisions. Pure so tests do not need a WebView.
 *
 * `resize: "native"` shrinks the WKWebView, which lifts fixed composers
 * and search fields with the keyboard. The accessory bar (previous / next
 * / Done) stays visible so a multiline comment can be dismissed. Android
 * does not read these flags: SystemBars still owns the IME inset, and
 * `resizeOnFullScreen` is intentionally absent from capacitor.config.ts.
 */

export const IOS_KEYBOARD_RESIZE = "native" as const;
export const IOS_KEYBOARD_BACKDROP = "dom" as const;
export const IOS_INPUT_MIN_FONT_PX = 16;

/** Show the iOS previous / next / Done bar above the keyboard. */
export const IOS_KEYBOARD_ACCESSORY_VISIBLE = true;

export function shouldInstallIosKeyboard(native: boolean, platform: string): boolean {
  return native && platform === "ios";
}

/** Static viewport content. Must allow pinch zoom. */
export function viewportAllowsUserZoom(content: string): boolean {
  const normalized = content.toLowerCase().replace(/\s+/g, "");
  if (!normalized.includes("viewport-fit=cover")) return false;
  if (normalized.includes("user-scalable=no") || normalized.includes("user-scalable=0")) return false;
  if (/maximum-scale=1(?:\.0+)?(?:[,;]|$)/.test(normalized)) return false;
  return true;
}
