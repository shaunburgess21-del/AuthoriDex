/** Persisted session key. Must match the Supabase client storageKey. */
export const SUPABASE_AUTH_STORAGE_KEY = "authoridex-auth";

/**
 * True when stored Supabase session JSON includes an access token.
 * A parse failure returns true so a real session is never treated as logged out.
 */
export function sessionJsonHasAccessToken(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown };
    return typeof parsed?.access_token === "string" && parsed.access_token.length > 0;
  } catch {
    return true;
  }
}

export function hasPersistedAuthSession(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return sessionJsonHasAccessToken(window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
  } catch {
    return true;
  }
}
