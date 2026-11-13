/**
 * Where Google sign-in runs, and which redirect it returns to.
 *
 * iOS uses ASWebAuthenticationSession (system auth sheet). Android keeps
 * the system browser. Web stays a same-tab redirect. Both native platforms
 * share `com.voxdex.app://login` and the PKCE exchange in `nativeOAuth.ts`.
 */

export const NATIVE_OAUTH_REDIRECT = "com.voxdex.app://login";

/** Scheme only. ASWebAuthenticationSession rejects a full callback URL here. */
export const NATIVE_OAUTH_CALLBACK_SCHEME = "com.voxdex.app";

export type NativeOAuthLaunch =
  | {
      kind: "web-redirect";
      redirectTo: string;
      skipBrowserRedirect: false;
    }
  | {
      kind: "system-browser";
      redirectTo: typeof NATIVE_OAUTH_REDIRECT;
      skipBrowserRedirect: true;
    }
  | {
      kind: "as-web-authentication-session";
      redirectTo: typeof NATIVE_OAUTH_REDIRECT;
      skipBrowserRedirect: true;
      callbackScheme: typeof NATIVE_OAUTH_CALLBACK_SCHEME;
    };

/** True only for the iOS shell. `Capacitor.getPlatform() === "ios"`. */
export function usesAsWebAuthenticationSession(platform: string): boolean {
  return platform === "ios";
}

export function nativeOAuthLaunchForPlatform(
  platform: string,
  webOrigin: string,
): NativeOAuthLaunch {
  if (usesAsWebAuthenticationSession(platform)) {
    return {
      kind: "as-web-authentication-session",
      redirectTo: NATIVE_OAUTH_REDIRECT,
      skipBrowserRedirect: true,
      callbackScheme: NATIVE_OAUTH_CALLBACK_SCHEME,
    };
  }
  if (platform === "android") {
    return {
      kind: "system-browser",
      redirectTo: NATIVE_OAUTH_REDIRECT,
      skipBrowserRedirect: true,
    };
  }
  return {
    kind: "web-redirect",
    redirectTo: `${webOrigin}/login`,
    skipBrowserRedirect: false,
  };
}

const USER_CANCEL_CODES = new Set([
  "cancelled",
  "canceled",
  "user_cancelled",
  "user_canceled",
]);

function readErrorText(error: unknown, key: "code" | "message"): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * System-sheet dismissal (Cancel / swipe down). Not an OAuth provider error:
 * those arrive as `com.voxdex.app://login?error=` and still surface a toast.
 */
export function isNativeOAuthUserCancel(error: unknown): boolean {
  const code = readErrorText(error, "code").trim().toLowerCase();
  if (USER_CANCEL_CODES.has(code)) return true;

  const message = readErrorText(error, "message").toLowerCase();
  if (message.includes("cancel")) return true;
  // ASWebAuthenticationSessionError.canceledLogin == 1, if Swift did not map it.
  if (message.includes("webauthenticationsession error 1")) return true;
  return false;
}
