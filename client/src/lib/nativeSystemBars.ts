import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

/**
 * Match Android status/navigation icon contrast to the web theme.
 * SystemBarsStyle.Dark means light icons on a dark background.
 * No-op on web, PWA, and iOS — the website theme is unchanged.
 */
export function syncAndroidSystemBars(theme: "light" | "dark"): void {
  if (Capacitor.getPlatform() !== "android") return;
  void SystemBars.setStyle({
    style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  }).catch(() => {
    // Icon contrast is cosmetic; a bridge that is not ready yet should not reject the page.
  });
}
