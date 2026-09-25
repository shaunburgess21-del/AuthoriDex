/**
 * Parses the `com.voxdex.app://login` return from the system browser.
 * `exchangeCodeForSession` needs the PKCE `code` query value alone.
 * Passing the whole URL makes the token request fail.
 */
export type NativeOAuthCallback =
  | { status: "code"; code: string }
  | { status: "error"; message: string }
  | { status: "ignore" };

const NATIVE_SCHEME = "com.voxdex.app:";
const NATIVE_HOST = "login";

function readParam(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseNativeOAuthCallback(url: string): NativeOAuthCallback {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "ignore" };
  }

  if (parsed.protocol !== NATIVE_SCHEME || parsed.hostname !== NATIVE_HOST) {
    return { status: "ignore" };
  }

  const queryError =
    readParam(parsed.searchParams, "error_description") ??
    readParam(parsed.searchParams, "error");
  if (queryError) {
    return { status: "error", message: queryError };
  }

  const code = readParam(parsed.searchParams, "code");
  if (code) {
    return { status: "code", code };
  }

  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const hashError = readParam(hash, "error_description") ?? readParam(hash, "error");
  if (hashError) {
    return { status: "error", message: hashError };
  }

  if (readParam(hash, "access_token")) {
    return {
      status: "error",
      message: "Google sign-in could not be completed. Try again.",
    };
  }

  return { status: "ignore" };
}
