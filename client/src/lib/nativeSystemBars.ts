import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

/**
 * Present on `<html>` only while the iOS Capacitor shell is running.
 * The website, PWA, and Android shell never receive it.
 */
export const IOS_SHELL_CLASS = "ios-shell";

export const IOS_SAFE_AREA_INSET_EDGES = ["top", "right", "bottom", "left"] as const;

export type IosSafeAreaInsetEdge = (typeof IOS_SAFE_AREA_INSET_EDGES)[number];

/**
 * Stylesheet text for one edge. `env()` stays live across rotation.
 * Capacitor's `--safe-area-inset-*` injection is Android-only.
 */
export function iosSafeAreaInsetDeclaration(edge: IosSafeAreaInsetEdge): string {
  return `--safe-area-inset-${edge}: env(safe-area-inset-${edge}, 0px);`;
}

/**
 * SystemBarsStyle.Dark means light icons on a dark background.
 * SystemBarsStyle.Light means dark icons on a light background.
 * Capacitor 8 uses that mapping on both Android and iOS.
 */
export function systemBarsStyleForTheme(theme: "light" | "dark"): SystemBarsStyle {
  return theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
}

/** Web and PWA stay on the default status-bar style. */
export function platformSyncsSystemBarStyle(platform: string): boolean {
  return platform === "android" || platform === "ios";
}

/** Native iOS shell only. Android keeps Capacitor's own inset variables. */
export function shouldApplyIosSafeAreaShell(platform: string, native: boolean): boolean {
  return native && platform === "ios";
}

export function applyIosSafeAreaShellClass(
  root: { classList: { add(token: string): void } },
  platform: string,
  native: boolean,
): boolean {
  if (!shouldApplyIosSafeAreaShell(platform, native)) return false;
  root.classList.add(IOS_SHELL_CLASS);
  return true;
}

/**
 * Match native status-bar icon contrast to the web theme, and mark the
 * iOS shell so CSS can map `env(safe-area-inset-*)` onto `--safe-area-inset-*`.
 *
 * Android still sends the same `SystemBars.setStyle` payload as before
 * (no `bar`, so status and navigation icons both follow the theme) and
 * does not receive `ios-shell`. Web and PWA return before the bridge call.
 * iOS `setStyle` only updates the status bar; the `bar` option is ignored there.
 */
export function syncNativeSystemBars(theme: "light" | "dark"): void {
  const platform = Capacitor.getPlatform();
  if (typeof document !== "undefined") {
    applyIosSafeAreaShellClass(
      document.documentElement,
      platform,
      platform === "ios" ? Capacitor.isNativePlatform() : false,
    );
  }
  if (!platformSyncsSystemBarStyle(platform)) return;
  void SystemBars.setStyle({
    style: systemBarsStyleForTheme(theme),
  }).catch(() => {
    // Icon contrast is cosmetic; a bridge that is not ready yet should not reject the page.
  });
}
