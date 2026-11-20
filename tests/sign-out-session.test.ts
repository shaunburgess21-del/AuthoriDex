/**
 * Logout must end the Supabase session for good.
 *
 * auth-js can emit SIGNED_OUT and then still persist a rotated session when a
 * token refresh resolves in the middle of sign-out (the refresh's setItem runs
 * after _removeSession, or the lock does not exclude it — Capacitor WebViews
 * included). The next getSession() on a click, navigation, or reload then
 * hydrates the account. These tests pin the guard that drops that write, the
 * anon voter id that must survive, and the caches/URL fragments that would
 * bring the user back.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ANON_VOTER_COOKIE_NAME,
  ANON_VOTER_STORAGE_KEY,
  SIGNED_OUT_SESSION_KEYS,
  SUPABASE_AUTH_STORAGE_KEY,
  authSessionBlockActive,
  authSessionReadsBlocked,
  clearSignedOutLocalStorage,
  clearSignedOutSessionStorage,
  createGuardedAuthStorage,
  hasPersistedAuthSession,
  holdAuthWriteBlock,
  isPersistedAuthStorageKey,
  isPersonalizedVoteStorageKey,
  readStoredAuthUserId,
  releaseAuthSessionBlock,
  releaseAuthSessionBlockOnSignIn,
  resetAuthSessionBlockForTests,
  shouldApplyProfileResponse,
  shouldDiscardAuthRestore,
  shouldDropQueryOnSignOut,
  stripAuthCallbackFromHref,
  tearDownAuthSession,
  type ListableStorage,
} from "../client/src/lib/authSession";
import { FDX_SID_STORAGE_KEY } from "../client/src/lib/nativeOrigin";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function memoryStorage(): ListableStorage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

test.beforeEach(() => {
  resetAuthSessionBlockForTests();
});

test("anon voter storage key matches the native fdx_sid copy", () => {
  assert.equal(ANON_VOTER_STORAGE_KEY, FDX_SID_STORAGE_KEY);
  assert.equal(ANON_VOTER_COOKIE_NAME, "fdx_sid");
  assert.equal(isPersistedAuthStorageKey(ANON_VOTER_STORAGE_KEY), false);
  assert.equal(isPersistedAuthStorageKey(ANON_VOTER_COOKIE_NAME), false);
});

test("auth keys include the app session, its verifier, and legacy sb- tokens", () => {
  assert.equal(isPersistedAuthStorageKey(SUPABASE_AUTH_STORAGE_KEY), true);
  assert.equal(isPersistedAuthStorageKey(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`), true);
  assert.equal(isPersistedAuthStorageKey(`${SUPABASE_AUTH_STORAGE_KEY}-user`), true);
  assert.equal(isPersistedAuthStorageKey("sb-projectref-auth-token"), true);
  assert.equal(isPersistedAuthStorageKey("sb-projectref-auth-token-code-verifier"), true);
  assert.equal(isPersistedAuthStorageKey("theme"), false);
  assert.equal(isPersistedAuthStorageKey("voxdex_referral_code"), false);
  assert.equal(isPersonalizedVoteStorageKey("sentiment-vote-person-1"), true);
  assert.equal(isPersonalizedVoteStorageKey("vote_person-1"), true);
  assert.equal(isPersonalizedVoteStorageKey("authoridex-has-ever-voted"), false);
});

test("clearing signed-out storage keeps the anon voter id and unrelated keys", () => {
  const storage = memoryStorage();
  storage.setItem(SUPABASE_AUTH_STORAGE_KEY, "{\"access_token\":\"a\"}");
  storage.setItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`, "\"verifier\"");
  storage.setItem("sb-abc-auth-token", "{\"access_token\":\"legacy\"}");
  storage.setItem("sentiment-vote-1", "4");
  storage.setItem("vote_celeb", "2");
  storage.setItem(ANON_VOTER_STORAGE_KEY, "11111111-1111-4111-8111-111111111111");
  storage.setItem(ANON_VOTER_COOKIE_NAME, "cookie-copy");
  storage.setItem("theme", "dark");
  storage.setItem("voxdex_referral_code", "{\"code\":\"abc\"}");

  const removed = clearSignedOutLocalStorage(storage);

  assert.equal(storage.getItem(SUPABASE_AUTH_STORAGE_KEY), null);
  assert.equal(storage.getItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`), null);
  assert.equal(storage.getItem("sb-abc-auth-token"), null);
  assert.equal(storage.getItem("sentiment-vote-1"), null);
  assert.equal(storage.getItem("vote_celeb"), null);
  assert.equal(storage.getItem(ANON_VOTER_STORAGE_KEY), "11111111-1111-4111-8111-111111111111");
  assert.equal(storage.getItem(ANON_VOTER_COOKIE_NAME), "cookie-copy");
  assert.equal(storage.getItem("theme"), "dark");
  assert.equal(storage.getItem("voxdex_referral_code"), "{\"code\":\"abc\"}");
  assert.ok(removed.includes(SUPABASE_AUTH_STORAGE_KEY));
  assert.equal(removed.includes(ANON_VOTER_STORAGE_KEY), false);
});

test("session leftovers from an in-progress sign-in are dropped", () => {
  const removed: string[] = [];
  const storage = {
    removeItem(key: string) {
      removed.push(key);
    },
  };
  clearSignedOutSessionStorage(storage);
  assert.deepEqual(removed, [...SIGNED_OUT_SESSION_KEYS]);
  assert.ok(SIGNED_OUT_SESSION_KEYS.includes("voxdex_pending_auth"));
  assert.ok(SIGNED_OUT_SESSION_KEYS.includes("voxdex_auth_return_snapshot"));
});

test("a refresh write during sign-out does not restore the session", async () => {
  const raw = memoryStorage();
  raw.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify({
    access_token: "old-access",
    refresh_token: "old-refresh",
    user: { id: "user-1" },
  }));
  raw.setItem(ANON_VOTER_STORAGE_KEY, "anon-sid");
  const guarded = createGuardedAuthStorage(raw);
  let sawOldToken = false;

  const auth = {
    async signOut(options?: { scope?: "global" | "local" | "others" }) {
      if (options?.scope === "global") {
        const current = raw.getItem(SUPABASE_AUTH_STORAGE_KEY);
        sawOldToken = Boolean(current && current.includes("old-access"));
        raw.removeItem(SUPABASE_AUTH_STORAGE_KEY);
        // The in-flight refresh commits after removal, through the client storage.
        await guarded.setItem(
          SUPABASE_AUTH_STORAGE_KEY,
          JSON.stringify({ access_token: "rotated-access", refresh_token: "rotated-refresh" }),
        );
        return { error: null };
      }
      return { error: null };
    },
  };

  await tearDownAuthSession(auth, raw);

  assert.equal(sawOldToken, true);
  assert.equal(raw.getItem(SUPABASE_AUTH_STORAGE_KEY), null);
  assert.equal(await guarded.getItem(SUPABASE_AUTH_STORAGE_KEY), null);
  assert.equal(authSessionReadsBlocked(), true);
  assert.equal(shouldDiscardAuthRestore(true), true);
  assert.equal(raw.getItem(ANON_VOTER_STORAGE_KEY), "anon-sid");
  assert.equal(hasPersistedAuthSession(), false);
});

test("a failed server revoke still clears the local session", async () => {
  const raw = memoryStorage();
  raw.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify({ access_token: "still-here" }));
  raw.setItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`, "\"pkce\"");
  let localCalls = 0;

  await tearDownAuthSession({
    async signOut(options) {
      if (options?.scope === "global") return { error: { message: "offline" } };
      localCalls += 1;
      raw.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      return { error: null };
    },
  }, raw);

  assert.equal(localCalls, 1);
  assert.equal(raw.getItem(SUPABASE_AUTH_STORAGE_KEY), null);
  assert.equal(raw.getItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`), null);
  assert.equal(authSessionReadsBlocked(), true);
});

test("sign-out still clears storage when the auth client throws", async () => {
  const raw = memoryStorage();
  raw.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify({ access_token: "x" }));
  raw.setItem("sb-ref-auth-token", JSON.stringify({ access_token: "legacy" }));

  await tearDownAuthSession({
    async signOut() {
      throw new Error("network down");
    },
  }, raw);

  assert.equal(raw.getItem(SUPABASE_AUTH_STORAGE_KEY), null);
  assert.equal(raw.getItem("sb-ref-auth-token"), null);
});

test("the write block drops auth saves and still allows the anon voter id", async () => {
  const raw = memoryStorage();
  const guarded = createGuardedAuthStorage(raw);
  holdAuthWriteBlock();

  await guarded.setItem(SUPABASE_AUTH_STORAGE_KEY, "{\"access_token\":\"nope\"}");
  await guarded.setItem(ANON_VOTER_STORAGE_KEY, "keep-me");
  await guarded.setItem("theme", "light");

  assert.equal(raw.getItem(SUPABASE_AUTH_STORAGE_KEY), null);
  assert.equal(raw.getItem(ANON_VOTER_STORAGE_KEY), "keep-me");
  assert.equal(raw.getItem("theme"), "light");
  assert.equal(authSessionBlockActive(), true);
  assert.equal(authSessionReadsBlocked(), false);
});

test("sign-in releases the block; a native code exchange does not", async () => {
  const auth = {
    async signInWithPassword() {
      return authSessionBlockActive() ? "blocked" : "open";
    },
    async signInWithOAuth() {
      return authSessionBlockActive() ? "blocked" : "open";
    },
    async exchangeCodeForSession() {
      return authSessionBlockActive() ? "blocked" : "open";
    },
  };
  releaseAuthSessionBlockOnSignIn(auth);
  holdAuthWriteBlock();

  assert.equal(await auth.signInWithPassword(), "open");
  assert.equal(authSessionBlockActive(), false);

  holdAuthWriteBlock();
  assert.equal(await auth.signInWithOAuth(), "open");
  assert.equal(authSessionBlockActive(), false);

  holdAuthWriteBlock();
  assert.equal(await auth.exchangeCodeForSession(), "blocked");
  assert.equal(authSessionBlockActive(), true);

  releaseAuthSessionBlock();
  const raw = memoryStorage();
  const guarded = createGuardedAuthStorage(raw);
  await guarded.setItem(SUPABASE_AUTH_STORAGE_KEY, "{\"access_token\":\"fresh\"}");
  assert.match(raw.getItem(SUPABASE_AUTH_STORAGE_KEY) ?? "", /fresh/);
});

test("profile responses and stored user ids are ignored once logout starts", () => {
  const storage = memoryStorage();
  storage.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify({
    access_token: "a",
    user: { id: "user-1" },
  }));
  assert.equal(shouldApplyProfileResponse(3, 3), true);
  assert.equal(shouldApplyProfileResponse(3, 4), false);
  assert.equal(readStoredAuthUserId(storage), "user-1");

  holdAuthWriteBlock();
  assert.equal(shouldApplyProfileResponse(3, 3), false);
  assert.equal(shouldDiscardAuthRestore(true), true);
  assert.equal(shouldDiscardAuthRestore(false), false);
  // Writes are blocked but the stored id is still readable until seal.
  assert.equal(readStoredAuthUserId(storage), "user-1");
});

test("auth callback URLs are stripped and ordinary hashes stay", () => {
  assert.equal(
    stripAuthCallbackFromHref("https://voxdex.com/login#access_token=tok&refresh_token=ref&expires_in=3600&token_type=bearer&type=signup"),
    "https://voxdex.com/login",
  );
  assert.equal(
    stripAuthCallbackFromHref("https://voxdex.com/login?code=pkce-code&mode=signup"),
    "https://voxdex.com/login?mode=signup",
  );
  assert.equal(stripAuthCallbackFromHref("https://voxdex.com/#leaderboard"), null);
  assert.equal(stripAuthCallbackFromHref("https://voxdex.com/person/ada#comment-9"), null);
  assert.equal(stripAuthCallbackFromHref("https://voxdex.com/vote?code=not-login"), null);
});

test("sign-out drops personalized caches and leaves public celebrity profiles", () => {
  assert.equal(shouldDropQueryOnSignOut(["/api/profile/me"]), true);
  assert.equal(shouldDropQueryOnSignOut(["/api/me/votes", "all"]), true);
  assert.equal(shouldDropQueryOnSignOut(["/api/me/predictions"]), true);
  assert.equal(shouldDropQueryOnSignOut(["/api/matchups/user-votes"]), true);
  assert.equal(shouldDropQueryOnSignOut(["/api/trending-polls"]), true);
  assert.equal(shouldDropQueryOnSignOut(["/api/open-markets", "predict-page"]), true);
  assert.equal(shouldDropQueryOnSignOut(["notifications", "list"]), true);
  assert.equal(shouldDropQueryOnSignOut(["/api/celebrity"]), true);
  assert.equal(shouldDropQueryOnSignOut(["/api/celebrity-profile", "person-1"]), false);
  assert.equal(shouldDropQueryOnSignOut(["/api/media"]), false);
  assert.equal(shouldDropQueryOnSignOut(["/api/leaderboard"]), false);
});

test("native oauth return checks the logout block before exchanging a code", () => {
  const source = readFileSync(join(root, "client/src/lib/nativeOAuth.ts"), "utf8");
  const guard = source.indexOf("if (authSessionBlockActive()) return;");
  const exchange = source.indexOf("exchangeCodeForSession");
  assert.ok(guard > 0);
  assert.ok(exchange > guard);
});

test("log out marks the user signed out before awaiting the client", () => {
  const source = readFileSync(join(root, "client/src/contexts/AuthContext.tsx"), "utf8");
  const signOut = source.slice(source.indexOf("const signOut = async"));
  const mark = signOut.indexOf("markSignedOutLocally");
  const teardown = signOut.indexOf("await tearDownAuthSession");
  assert.ok(mark > 0);
  assert.ok(teardown > mark);
  assert.equal(signOut.includes("fdx_sid"), false);
});
