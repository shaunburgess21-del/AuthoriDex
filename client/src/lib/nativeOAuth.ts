import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { mapAuthError } from "@/lib/authErrors";
import { parseNativeOAuthCallback, type NativeOAuthCallback } from "@/lib/nativeOAuthCallback";
import { SUPABASE_AUTH_STORAGE_KEY, getSupabase } from "@/lib/supabase";

/** Custom scheme registered on Android. Allowlist in Supabase Auth. */
export const NATIVE_OAUTH_REDIRECT = "com.voxdex.app://login";

/** Fired when the native Google browser flow ends (success, error, or cancel). */
export const NATIVE_OAUTH_SETTLED_EVENT = "voxdex-native-oauth-settled";

const CODE_VERIFIER_KEY = `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`;
const CANCEL_GRACE_MS = 1000;

const SLOT_KEY = "__voxdexNativeOAuth";

let pending = false;
let handlingReturn = false;
let cancelTimer: ReturnType<typeof setTimeout> | null = null;
const seenReturns = new Set<string>();

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

function settleNativeOAuth(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NATIVE_OAUTH_SETTLED_EVENT));
}

function clearCancelTimer(): void {
  if (cancelTimer !== null) {
    clearTimeout(cancelTimer);
    cancelTimer = null;
  }
}

/** Call immediately before `Browser.open` so closing Custom Tabs can unlock the UI. */
export function beginNativeOAuthBrowser(): void {
  pending = true;
  clearCancelTimer();
}

/** Call when `Browser.open` fails before a return URL can arrive. */
export function abortNativeOAuthBrowser(): void {
  if (handlingReturn) return;
  pending = false;
  clearCancelTimer();
  settleNativeOAuth();
}

async function closeOAuthBrowser(): Promise<void> {
  await Browser.close().catch(() => {
    /* Custom Tab may already be gone */
  });
}

async function completeNativeOAuthReturn(parsed: NativeOAuthCallback): Promise<void> {
  try {
    if (parsed.status === "error") {
      toast.error("Google sign-in failed", { description: parsed.message });
      return;
    }
    if (parsed.status !== "code") return;

    const supabase = await getSupabase();
    let verifier: string | null = null;
    try {
      verifier = window.localStorage.getItem(CODE_VERIFIER_KEY);
    } catch {
      verifier = null;
    }

    if (!verifier) {
      const { data } = await supabase.auth.getSession();
      if (!data.session && pending) {
        toast.error("Google sign-in failed", {
          description: "The sign-in session expired. Try again.",
        });
      }
      return;
    }

    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error) {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const mapped = mapAuthError(error);
        toast.error("Google sign-in failed", { description: mapped.message });
      } else {
        console.error("[oauth] native code exchange failed:", error.message);
      }
    }
  } catch (error) {
    console.error("[oauth] native code exchange failed:", error);
    const mapped = mapAuthError(error);
    toast.error("Google sign-in failed", { description: mapped.message });
  } finally {
    handlingReturn = false;
    pending = false;
    await closeOAuthBrowser();
    settleNativeOAuth();
  }
}

function onNativeOAuthUrl(url: string): void {
  const parsed = parseNativeOAuthCallback(url);
  if (parsed.status === "ignore") return;

  const key = parsed.status === "code" ? parsed.code : url;
  if (seenReturns.has(key)) return;
  seenReturns.add(key);

  handlingReturn = true;
  clearCancelTimer();
  void completeNativeOAuthReturn(parsed);
}

function onBrowserFinished(): void {
  if (!pending || handlingReturn) return;
  clearCancelTimer();
  cancelTimer = setTimeout(() => {
    cancelTimer = null;
    if (handlingReturn || !pending) return;
    pending = false;
    settleNativeOAuth();
  }, CANCEL_GRACE_MS);
}

/**
 * Google returns to the custom scheme, not the WebView URL. Exchange the
 * PKCE code that `signInWithOAuth({ skipBrowserRedirect: true })` stored
 * in this WebView's localStorage, then close the system browser.
 */
export function installNativeOAuthListener(): void {
  if (!Capacitor.isNativePlatform()) return;

  const slot = globalThis as typeof globalThis & { [SLOT_KEY]?: boolean };
  if (slot[SLOT_KEY]) return;
  slot[SLOT_KEY] = true;

  void App.addListener("appUrlOpen", ({ url }) => {
    onNativeOAuthUrl(url);
  });

  void Browser.addListener("browserFinished", () => {
    onBrowserFinished();
  });

  // Cold start delivers the VIEW intent before JS listeners exist. Capacitor
  // retains `appUrlOpen`, and `getLaunchUrl` is the same URI if that event
  // was already consumed. Duplicate codes are ignored.
  void App.getLaunchUrl()
    .then((launch) => {
      if (launch?.url) onNativeOAuthUrl(launch.url);
    })
    .catch(() => {
      /* no launch url */
    });
}
