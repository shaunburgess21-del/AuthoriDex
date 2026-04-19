import type { SnapSectionType } from "@/components/snap-scroll/VoteSnapScrollView";

/** Serializable Vote hub UI to restore after sign-in (see VotePage). */
export interface VoteResumePayload {
  inductionOverlayOpen: boolean;
  topicsOverlayOpen: boolean;
  matchupsOverlayOpen: boolean;
  opinionPollsOverlayOpen: boolean;
  valuePerceptionOverlayOpen: boolean;
  snapScrollOpen: boolean;
  snapScrollSection?: SnapSectionType;
  snapScrollInitialId?: string;
  /** Main window scroll Y when snap was opened (mobile). */
  savedWindowScrollY?: number;
}

const AUTH_RETURN_SNAPSHOT_KEY = "voxdex_auth_return_snapshot";

/** VotePage reads this once after auth to reopen overlays / snap. */
export const AUTH_APPLY_VOTE_UI_ONCE_KEY = "voxdex_apply_vote_ui_once";

/**
 * Ephemeral flag set by `navigateToLogin` (and pre-OAuth) to indicate the current /login
 * visit is part of an intentional auth flow. LoginPage consumes this on mount to decide
 * whether a pending snapshot is fresh (keep) or stale from an earlier session (clear).
 */
const AUTH_NAV_INTENT_KEY = "voxdex_auth_nav_intent";

const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

interface StoredSnapshot {
  returnPath: string;
  voteUi?: VoteResumePayload | null;
  ts: number;
}

export type AuthSetLocation = (to: string, opts?: { replace?: boolean }) => void;

/**
 * Same-origin in-app path only. Rejects protocol-relative, control chars, and any path
 * whose URL resolution escapes the current origin (belt-and-suspenders vs. smuggling).
 */
export function sanitizeReturnPath(input: string | null | undefined): string | null {
  if (input == null) return null;
  const p = input.trim();
  if (!p.startsWith("/")) return null;
  if (p.startsWith("//")) return null;
  if (p.startsWith("/\\")) return null;
  if (/[\x00-\x1f\x7f]/.test(p)) return null;
  if (p.length > 4000) return null;
  try {
    const resolved = new URL(p, window.location.origin);
    if (resolved.origin !== window.location.origin) return null;
  } catch {
    return null;
  }
  return p;
}

export function stashAuthReturnSnapshot(opts?: { voteUi?: VoteResumePayload | null }): void {
  let returnPath =
    window.location.pathname + window.location.search + window.location.hash;
  if (window.location.pathname === "/login") {
    returnPath = "/";
  }
  const snap: StoredSnapshot = {
    returnPath,
    ts: Date.now(),
    ...(opts?.voteUi != null ? { voteUi: opts.voteUi } : {}),
  };
  try {
    sessionStorage.setItem(AUTH_RETURN_SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Read and remove the pre-login snapshot. Returns null if missing, invalid, or expired.
 */
export function consumeAuthReturnSnapshotForLoginSuccess(): StoredSnapshot | null {
  const raw = sessionStorage.getItem(AUTH_RETURN_SNAPSHOT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(AUTH_RETURN_SNAPSHOT_KEY);
  try {
    const o = JSON.parse(raw) as StoredSnapshot;
    if (!o || typeof o.returnPath !== "string") return null;
    if (typeof o.ts === "number" && Date.now() - o.ts > SNAPSHOT_TTL_MS) return null;
    return o;
  } catch {
    return null;
  }
}

/** True if a redirect snapshot is waiting (used to avoid OAuth/email double-consume races). */
export function hasPendingAuthReturnSnapshot(): boolean {
  return sessionStorage.getItem(AUTH_RETURN_SNAPSHOT_KEY) != null;
}

/**
 * After successful authentication: go to stashed path (default `/`) and queue Vote UI if needed.
 * Defensive: any `/login`-prefixed target is coerced to `/` to prevent redirect loops.
 */
export function redirectAfterLogin(setLocation: AuthSetLocation): void {
  const snap = consumeAuthReturnSnapshotForLoginSuccess();
  if (!snap) {
    setLocation("/", { replace: true });
    return;
  }
  const sanitized = sanitizeReturnPath(snap.returnPath);
  const target =
    !sanitized || /^\/login(?:[/?#]|$)/.test(sanitized) ? "/" : sanitized;
  if (snap.voteUi && target.startsWith("/vote")) {
    try {
      sessionStorage.setItem(AUTH_APPLY_VOTE_UI_ONCE_KEY, JSON.stringify(snap.voteUi));
    } catch {
      /* ignore */
    }
  }
  setLocation(target, { replace: true });
}

/**
 * Mark the /login visit that is about to happen as intentional (not a bookmark/refresh).
 * LoginPage consumes this on mount; its absence triggers stale-snapshot cleanup.
 */
export function markAuthNavIntent(): void {
  try {
    sessionStorage.setItem(AUTH_NAV_INTENT_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Called by LoginPage on mount. If the intent flag isn't present, the /login visit was a
 * bookmark, refresh, or external link — any pending snapshot is from a prior session and
 * should be discarded so the user isn't silently redirected to unrelated pages on sign-in.
 */
export function clearStaleAuthReturnSnapshotOnDirectVisit(): void {
  let hadIntent = false;
  try {
    hadIntent = sessionStorage.getItem(AUTH_NAV_INTENT_KEY) === "1";
    sessionStorage.removeItem(AUTH_NAV_INTENT_KEY);
  } catch {
    /* ignore */
  }
  if (!hadIntent) {
    try {
      sessionStorage.removeItem(AUTH_RETURN_SNAPSHOT_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stash current URL (+ optional Vote UI) then navigate to login.
 * Supabase redirect allowlist must include `${origin}/login` if using Google OAuth with this flow.
 */
export function navigateToLogin(
  setLocation: AuthSetLocation,
  opts?: { mode?: "signup"; voteUi?: VoteResumePayload | null },
): void {
  stashAuthReturnSnapshot(opts?.voteUi != null ? { voteUi: opts.voteUi } : {});
  markAuthNavIntent();
  const qs = new URLSearchParams();
  if (opts?.mode === "signup") qs.set("mode", "signup");
  const q = qs.toString();
  setLocation(q ? `/login?${q}` : "/login");
}
