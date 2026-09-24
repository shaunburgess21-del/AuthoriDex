import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { getSupabase } from "@/lib/supabase";

/** Custom scheme registered on iOS and Android. Allowlist in Supabase Auth. */
export const NATIVE_OAUTH_REDIRECT = "com.voxdex.app://login";

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Google returns to the custom scheme, not the WebView URL. Exchange the
 * PKCE code that `signInWithOAuth({ skipBrowserRedirect: true })` stored
 * in this WebView's localStorage.
 */
export function installNativeOAuthListener(): void {
  if (!Capacitor.isNativePlatform()) return;

  void App.addListener("appUrlOpen", async ({ url }) => {
    if (!url.startsWith("com.voxdex.app://")) return;
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) {
        console.error("[oauth] native code exchange failed:", error.message);
      }
    } catch (error) {
      console.error("[oauth] native code exchange failed:", error);
    } finally {
      await Browser.close().catch(() => {
        /* browser may already be closed */
      });
    }
  });
}
