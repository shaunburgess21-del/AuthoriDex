/**
 * User-facing nouns that should say "app" inside a Capacitor shell and
 * "site" on the website and PWA. Callers pass the platform flag so the
 * wording stays testable without a WebView. Both iOS and Android use
 * "app"; web stays "site".
 */
import { Capacitor } from "@capacitor/core";

export type SurfaceNoun = "app" | "site";

export function surfaceNoun(native: boolean): SurfaceNoun {
  return native ? "app" : "site";
}

/** Streak toast line under the day count. */
export function streakRewardTease(native: boolean): string {
  return `Take action on the ${surfaceNoun(native)} to earn Vox.`;
}

/** Admin sidebar control that leaves the dashboard for the public shell. */
export function backToSurfaceLabel(native: boolean): string {
  return `Back to ${native ? "App" : "Site"}`;
}

/** True on the iOS or Android Capacitor shell. Web and PWA stay false. */
export function isNativeSurface(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
