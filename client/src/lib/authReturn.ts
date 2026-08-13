import type { SnapSectionType } from "@/components/snap-scroll/VoteSnapScrollView";

/** Serializable Vote hub UI to restore after sign-in (see VotePage). */
export interface VoteResumePayload {
  inductionOverlayOpen: boolean;
  topicsOverlayOpen: boolean;
  matchupsOverlayOpen: boolean;
  opinionPollsOverlayOpen: boolean;
  ratingOverlayOpen: boolean;
  snapScrollOpen: boolean;
  snapScrollSection?: SnapSectionType;
  snapScrollInitialId?: string;
  /** Main window scroll Y when snap was opened (mobile). */
  savedWindowScrollY?: number;
  /** Quick Vote overlay was open when the user was sent to login. */
  quickVoteOpen?: boolean;
  /** Card visible in the Quick Vote overlay at redirect time. */
  quickVoteCardId?: string;
}

/**
 * Phase 4 — reason a user was redirected to /login. Surfaced as the `?reason=`
 * query param on the login URL and consumed by the SignupReasonModal (Stage 6)
 * to render the variant-A / variant-B copy. Also stashed in sessionStorage as
 * part of the snapshot so post-login flows can branch on it.
 */
export type AuthReason = "vote_limit_reached" | "predict_signup";

/**
 * Phase 4 — resumable action payload. When an anonymous user hits the vote
 * budget gate (or any future gate), the page captures enough context here for
 * the post-signup flow to land them back on the same card with the same vote
 * primed. Fields:
 *   - surfaceType: one of the 5 anon-eligible surfaces (matchup_poll,
 *     trending_poll, opinion_poll, induction, celebrity_person).
 *   - targetId: the matchupId / pollId / candidateId / personId.
 *   - cardRoute (optional): canonical client route for the card, e.g.
 *     /matchup/<id> or /people/<id>. Stage 7 uses this to navigate.
 *   - pendingVote (optional): the vote payload the user attempted, in
 *     surface-specific shape (option string, optionId, rating, etc.).
 *     `any` matches the brief; callers narrow at use site.
 *
 * `voteGate.checkVoteGate` returns the (surfaceType, targetId) skeleton on
 * gate-failure; calling pages fill in cardRoute and pendingVote before
 * handing the full payload to navigateToLogin.
 */
export interface ResumeAction {
  surfaceType: string;
  targetId: string;
  cardRoute?: string;
  pendingVote?: any;
}

const AUTH_RETURN_SNAPSHOT_KEY = "voxdex_auth_return_snapshot";

/** VotePage reads this once after auth to reopen overlays / snap. */
export const AUTH_APPLY_VOTE_UI_ONCE_KEY = "voxdex_apply_vote_ui_once";

/**
 * Phase 4 — set by redirectAfterLogin when the consumed snapshot carried a
 * resumeAction. Destination card pages (matchup / person / poll / induction
 * detail) read this once on mount and clear it; per-surface auto-open
 * consumers are Phase 4a follow-ups.
 *
 * Payload shape: Omit<ResumeAction, "cardRoute"> — cardRoute is consumed by
 * redirectAfterLogin to override the navigation target, so destination
 * pages don't need it (they already know their own route).
 */
export const AUTH_APPLY_RESUME_ACTION_ONCE_KEY =
  "voxdex_apply_resume_action_once";

/**
 * Quick Vote overlay hosts (Home + Vote) read this once after auth to reopen
 * the overlay at the card the user was on when the budget gate redirected
 * them. Payload: { cardId: string | null }.
 */
export const AUTH_APPLY_QUICK_VOTE_ONCE_KEY = "voxdex_apply_quick_vote_once";

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
  /**
   * Phase 4 — resumable vote action. Set when navigateToLogin is called with
   * a resumeAction payload; consumed by Stage 7's redirectAfterLogin
   * extension which navigates to cardRoute and auto-opens the original action.
   */
  resumeAction?: ResumeAction;
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

export function stashAuthReturnSnapshot(opts?: {
  voteUi?: VoteResumePayload | null;
  resumeAction?: ResumeAction;
}): void {
  let returnPath =
    window.location.pathname + window.location.search + window.location.hash;
  if (window.location.pathname === "/login") {
    returnPath = "/";
  }
  const snap: StoredSnapshot = {
    returnPath,
    ts: Date.now(),
    ...(opts?.voteUi != null ? { voteUi: opts.voteUi } : {}),
    ...(opts?.resumeAction != null ? { resumeAction: opts.resumeAction } : {}),
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

  // Default target: the path the user was on before being redirected.
  // /login-prefixed paths collapse to "/" to prevent post-auth loops.
  const sanitizedReturn = sanitizeReturnPath(snap.returnPath);
  let target =
    !sanitizedReturn || /^\/login(?:[/?#]|$)/.test(sanitizedReturn)
      ? "/"
      : sanitizedReturn;

  // Phase 4 — resumeAction.cardRoute overrides target so the user lands
  // on the originally-attempted card (D9). Falls through to returnPath
  // default if cardRoute is missing or fails sanitisation.
  if (snap.resumeAction?.cardRoute) {
    const sanitizedCard = sanitizeReturnPath(snap.resumeAction.cardRoute);
    if (sanitizedCard && !/^\/login(?:[/?#]|$)/.test(sanitizedCard)) {
      target = sanitizedCard;
    }
  }

  if (snap.voteUi && target.startsWith("/vote")) {
    try {
      sessionStorage.setItem(
        AUTH_APPLY_VOTE_UI_ONCE_KEY,
        JSON.stringify(snap.voteUi),
      );
    } catch {
      /* ignore */
    }
  }

  // Quick Vote overlay restore — hosts live on Home ("/") and Vote ("/vote").
  // Sibling to the /vote branch above: a quickVote payload carries all VotePage
  // overlay flags as false, so both consumers can run without conflict.
  if (
    snap.voteUi?.quickVoteOpen &&
    (target === "/" || target.startsWith("/vote"))
  ) {
    try {
      sessionStorage.setItem(
        AUTH_APPLY_QUICK_VOTE_ONCE_KEY,
        JSON.stringify({ cardId: snap.voteUi.quickVoteCardId ?? null }),
      );
    } catch {
      /* ignore */
    }
  }

  // Phase 4 — stash resumeAction payload (sans cardRoute, already consumed)
  // for the destination card's mount-time consumer. Per-surface auto-open
  // consumers are Phase 4a follow-ups; this commit preserves the payload
  // so a later commit can wire each card's auto-open behaviour without
  // re-touching the redirect path.
  if (snap.resumeAction) {
    try {
      const { cardRoute: _consumed, ...payload } = snap.resumeAction;
      sessionStorage.setItem(
        AUTH_APPLY_RESUME_ACTION_ONCE_KEY,
        JSON.stringify(payload),
      );
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
 * Stash current URL (+ optional Vote UI / resumeAction) then navigate to login.
 * Supabase redirect allowlist must include `${origin}/login` if using Google OAuth with this flow.
 *
 * Phase 4 additions:
 *   - `reason`: serialised to the `?reason=` URL query param so SignupReasonModal
 *     (Stage 6) can render the matching variant. Also stashed in the snapshot
 *     for any post-login flow that wants to branch on it.
 *   - `resumeAction`: serialised to sessionStorage via the snapshot. Stage 7's
 *     redirectAfterLogin extension consumes this to land the user back on the
 *     original card with their original action primed.
 *
 * The `?reason=` query string format is the contract Stage 6 reads from —
 * don't change values without updating the modal in lockstep.
 */
export function navigateToLogin(
  setLocation: AuthSetLocation,
  opts?: {
    mode?: "signup";
    voteUi?: VoteResumePayload | null;
    reason?: AuthReason;
    resumeAction?: ResumeAction;
  },
): void {
  stashAuthReturnSnapshot({
    ...(opts?.voteUi != null ? { voteUi: opts.voteUi } : {}),
    ...(opts?.resumeAction != null ? { resumeAction: opts.resumeAction } : {}),
  });
  markAuthNavIntent();
  const qs = new URLSearchParams();
  if (opts?.mode === "signup") qs.set("mode", "signup");
  if (opts?.reason) qs.set("reason", opts.reason);
  const q = qs.toString();
  setLocation(q ? `/login?${q}` : "/login");
}
