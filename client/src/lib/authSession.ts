/** Persisted session key. Must match the Supabase client storageKey. */
export const SUPABASE_AUTH_STORAGE_KEY = "authoridex-auth";

/**
 * Anonymous voter id in localStorage. Same value as `FDX_SID_STORAGE_KEY`
 * in nativeOrigin.ts. Logout must not remove it — anon vote ownership is
 * the httpOnly `fdx_sid` cookie (and this native copy), not the Supabase session.
 */
export const ANON_VOTER_STORAGE_KEY = "voxdex_fdx_sid";

/** Cookie name used by the Express anon-voter middleware. Never an auth session. */
export const ANON_VOTER_COOKIE_NAME = "fdx_sid";

const PRESERVED_STORAGE_KEYS = new Set<string>([
  ANON_VOTER_STORAGE_KEY,
  ANON_VOTER_COOKIE_NAME,
]);

/**
 * sessionStorage keys that would resume a half-finished sign-in or send the
 * user back into an authenticated return path after they logged out.
 */
export const SIGNED_OUT_SESSION_KEYS = [
  "voxdex_pending_auth",
  "voxdex_auth_return_snapshot",
  "voxdex_auth_nav_intent",
  "voxdex_apply_vote_ui_once",
  "voxdex_apply_resume_action_once",
  "voxdex_apply_quick_vote_once",
] as const;

const SIGN_IN_METHODS = [
  "signInAnonymously",
  "signInWithPassword",
  "signInWithOAuth",
  "signInWithWeb3",
  "signInWithEthereum",
  "signInWithSolana",
  "signInWithIdToken",
  "signInWithOtp",
  "signInWithSSO",
  "signUp",
  "verifyOtp",
  "setSession",
] as const;

const AUTH_HASH_PARAMS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "provider_token",
  "provider_refresh_token",
  "type",
] as const;

/**
 * Query-key heads whose cached payload is the signed-in user, their profile,
 * or a ballot/order that includes that user. Matched as an exact head or a
 * child path so `/api/me` does not also drop `/api/media`.
 */
const PERSONAL_QUERY_HEADS = [
  "/api/me",
  "/api/profile/me",
  "/api/trending-polls",
  "/api/opinion-polls",
  "/api/matchups",
  "/api/vote/overall-ratings",
  "/api/celebrity",
  "/api/open-markets",
  "/api/notifications",
] as const;

/**
 * `off` — sign-in may persist a session.
 * `writes` — a logout has started. Reads still return the current session so
 * the client can revoke it. Writes of auth keys are dropped, which is what
 * stops an in-flight token refresh from saving a rotated session after
 * `SIGNED_OUT`.
 * `all` — local session is gone. Reads of auth keys return null so the next
 * `getSession()` (navigation, refetch, new code path) cannot hydrate the user.
 */
type SessionBlock = "off" | "writes" | "all";

let sessionBlock: SessionBlock = "off";

export function resetAuthSessionBlockForTests(): void {
  sessionBlock = "off";
}

/** Block auth-key writes. Reads still see the session so revoke can run. */
export function holdAuthWriteBlock(): void {
  if (sessionBlock === "off") sessionBlock = "writes";
}

/** Block auth-key reads and writes until the next explicit sign-in. */
export function holdAuthSessionBlock(): void {
  sessionBlock = "all";
}

export function releaseAuthSessionBlock(): void {
  sessionBlock = "off";
}

export function authSessionBlockActive(): boolean {
  return sessionBlock !== "off";
}

export function authSessionReadsBlocked(): boolean {
  return sessionBlock === "all";
}

/** A session-bearing auth event after logout is a refresh or replay, not a sign-in. */
export function shouldDiscardAuthRestore(hasSession: boolean): boolean {
  return hasSession && authSessionBlockActive();
}

/** In-flight profile responses must not paint an account that has since logged out. */
export function shouldApplyProfileResponse(requestEpoch: number, currentEpoch: number): boolean {
  return requestEpoch === currentEpoch && !authSessionBlockActive();
}

export interface AuthKeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/**
 * Storage passed to the Supabase client. Auth keys go through the logout
 * block; every other key (including `voxdex_fdx_sid`) is untouched.
 */
export function createGuardedAuthStorage<T extends AuthKeyValueStorage>(storage: T): AuthKeyValueStorage {
  return {
    getItem(key) {
      if (authSessionReadsBlocked() && isPersistedAuthStorageKey(key)) return null;
      return storage.getItem(key);
    },
    setItem(key, value) {
      if (authSessionBlockActive() && isPersistedAuthStorageKey(key)) return;
      return storage.setItem(key, value);
    },
    removeItem(key) {
      return storage.removeItem(key);
    },
  };
}

/**
 * Sign-in methods release the logout block before they persist a new session.
 * `exchangeCodeForSession` is intentionally not wrapped: a native OAuth return
 * that arrives after logout must not lift the block. A new Google sign-in
 * calls `signInWithOAuth` first, which does release it.
 */
export function releaseAuthSessionBlockOnSignIn(auth: object): void {
  const target = auth as Record<string, unknown>;
  for (const name of SIGN_IN_METHODS) {
    const current = target[name];
    if (typeof current !== "function") continue;
    target[name] = function signInReleasingLogoutBlock(...args: unknown[]) {
      releaseAuthSessionBlock();
      return Reflect.apply(current, auth, args);
    };
  }
}

export interface ListableStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Supabase session, PKCE verifier, legacy `sb-*-auth-token` keys. Not the anon voter id. */
export function isPersistedAuthStorageKey(key: string): boolean {
  if (PRESERVED_STORAGE_KEYS.has(key)) return false;
  if (key === SUPABASE_AUTH_STORAGE_KEY || key.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}-`)) {
    return true;
  }
  return /^sb-.+-auth-token(?:$|-)/.test(key);
}

/** Device copies of this viewer's ballots. Not the anon "ever voted" nudge flag. */
export function isPersonalizedVoteStorageKey(key: string): boolean {
  return key.startsWith("sentiment-vote-") || key.startsWith("vote_");
}

export function clearPersistedAuthStorage(storage: ListableStorage): string[] {
  return removeMatchingKeys(storage, isPersistedAuthStorageKey);
}

export function clearPersonalizedVoteStorage(storage: ListableStorage): string[] {
  return removeMatchingKeys(storage, isPersonalizedVoteStorageKey);
}

export function clearSignedOutLocalStorage(storage: ListableStorage): string[] {
  return removeMatchingKeys(
    storage,
    (key) => isPersistedAuthStorageKey(key) || isPersonalizedVoteStorageKey(key),
  );
}

export function clearSignedOutSessionStorage(storage: { removeItem(key: string): void }): void {
  for (const key of SIGNED_OUT_SESSION_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* private mode */
    }
  }
}

function removeMatchingKeys(storage: ListableStorage, match: (key: string) => boolean): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) keys.push(key);
  }
  const removed: string[] = [];
  for (const key of keys) {
    if (!match(key)) continue;
    storage.removeItem(key);
    removed.push(key);
  }
  return removed;
}

export function readStoredAuthUserId(storage: { getItem(key: string): string | null }): string | null {
  if (authSessionReadsBlocked()) return null;
  try {
    const raw = storage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } };
    return typeof parsed?.user?.id === "string" ? parsed.user.id : null;
  } catch {
    return null;
  }
}

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
  if (authSessionReadsBlocked()) return false;
  if (typeof window === "undefined") return true;
  try {
    return sessionJsonHasAccessToken(window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
  } catch {
    return true;
  }
}

export function shouldDropQueryOnSignOut(queryKey: readonly unknown[]): boolean {
  const head = typeof queryKey[0] === "string" ? queryKey[0] : "";
  if (head === "notifications") return true;
  return PERSONAL_QUERY_HEADS.some(
    (prefix) => head === prefix || head.startsWith(`${prefix}/`),
  );
}

/**
 * Remove an implicit-grant hash or a login PKCE `code` so a reload cannot
 * call `detectSessionInUrl` and create a new session. Other hashes
 * (`#leaderboard`, `#comment-…`) stay.
 * Returns null when nothing changed.
 */
export function stripAuthCallbackFromHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  let changed = false;
  if (url.hash.length > 1) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    if (hashParams.has("access_token") || hashParams.has("refresh_token")) {
      for (const key of AUTH_HASH_PARAMS) {
        if (hashParams.has(key)) {
          hashParams.delete(key);
          changed = true;
        }
      }
      const next = hashParams.toString();
      url.hash = next ? `#${next}` : "";
    }
  }
  const onLogin = url.pathname === "/login" || url.pathname.startsWith("/login/");
  if (onLogin && (url.searchParams.has("code") || url.searchParams.has("access_token"))) {
    url.searchParams.delete("code");
    url.searchParams.delete("access_token");
    url.searchParams.delete("refresh_token");
    changed = true;
  }
  return changed ? url.toString() : null;
}

export interface AuthTearDownClient {
  signOut(options?: { scope?: "global" | "local" | "others" }): Promise<{
    error: { message?: string } | null;
  }>;
  stopAutoRefresh?: () => Promise<void> | void;
}

/**
 * Revoke the Supabase refresh token, then drop the local session.
 * A global revoke that fails (offline, 5xx) still ends with a local sign-out.
 * Auth-key writes are blocked first so a refresh that resolves during the
 * logout request cannot persist the rotated session afterwards.
 */
export async function tearDownAuthSession(
  auth: AuthTearDownClient,
  storage: ListableStorage,
): Promise<void> {
  holdAuthWriteBlock();
  try {
    await auth.stopAutoRefresh?.();
  } catch {
    /* the write block still drops a refresh that already started */
  }
  try {
    const { error } = await auth.signOut({ scope: "global" });
    if (error) {
      await auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  } catch {
    await auth.signOut({ scope: "local" }).catch(() => undefined);
  } finally {
    holdAuthSessionBlock();
    clearPersistedAuthStorage(storage);
  }
}
