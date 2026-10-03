/**
 * Pure helpers for the account-deletion lifecycle. Lives in its own
 * module with NO side-effect imports (no `../db`, no schema, no
 * sentry, no Supabase) so unit tests can pin the policy without
 * opening a database connection or calling Auth.
 *
 * See `account-deletion.ts` for the live DB-reading shell and
 * `account-deletion-execute.ts` for the Auth-delete ordering.
 */

/** 7-day soft-delete window in milliseconds. Exported so the route
 *  handler can include it in the user-facing response. */
export const DELETION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Stored comment body after the author is permanently deleted.
 *  The comment row stays so the thread still exists. */
export const DELETED_COMMENT_BODY = "[deleted]";

/** Public author label once the profile is no longer identifiable.
 *  Not a username, so it is not a profile link. */
export const DELETED_AUTHOR_LABEL = "[deleted user]";

/**
 * Tombstone usernames are `deleted_` plus 32 hex chars (a UUID with
 * the dashes removed). That is 40 characters. The public username
 * setter only allows 3–30 characters, so a real member cannot choose
 * this shape. It is the marker that erasure has started, including
 * the gap before `deletedAt` is stamped.
 */
const ANONYMISED_USERNAME = /^deleted_[0-9a-f]{32}$/;

export function isAnonymisedUsername(username: string | null | undefined): boolean {
  return typeof username === "string" && ANONYMISED_USERNAME.test(username);
}

export function formatAnonymisedUsername(hex32: string): string {
  const username = `deleted_${hex32}`;
  if (!isAnonymisedUsername(username)) {
    throw new Error("anonymised username must be deleted_ plus 32 hex chars");
  }
  return username;
}

/**
 * Pure helper: given `now` and the two profile timestamps, returns
 * whether the sweeper would consider the row overdue. Mirrors the
 * SQL predicate used by `processOverdueAccountDeletions`.
 *
 * Rules:
 *   - `deletedAt` set → never overdue (already finalised, idempotent skip).
 *   - `scheduledFor` null → never overdue (no deletion pending).
 *   - `scheduledFor` in the past or equal to now → overdue.
 *   - `scheduledFor` in the future → not overdue (still in window).
 */
export function isOverdue(input: {
  now: Date;
  scheduledFor: Date | null;
  deletedAt: Date | null;
}): boolean {
  const { now, scheduledFor, deletedAt } = input;
  if (deletedAt) return false;
  if (!scheduledFor) return false;
  return scheduledFor.getTime() <= now.getTime();
}

export function isErasureStarted(input: {
  username: string | null;
  deletedAt: Date | null;
}): boolean {
  if (input.deletedAt) return false;
  return isAnonymisedUsername(input.username);
}

/**
 * Sign-in is rejected once erasure has started and after `deletedAt`
 * is stamped. During the 7-day window the username is unchanged, so
 * sign-in and cancellation still work.
 */
export function shouldRejectSignIn(profile: {
  username: string | null;
  deletedAt: Date | string | null;
} | null | undefined): boolean {
  if (!profile) return false;
  if (profile.deletedAt) return true;
  return isAnonymisedUsername(profile.username);
}

/** A deleted public profile is not found and is not navigable. */
export function isPublicProfileUnavailable(profile: {
  username?: string | null;
  deletedAt?: Date | string | null;
} | null | undefined): boolean {
  if (!profile) return false;
  if (profile.deletedAt) return true;
  return isAnonymisedUsername(profile.username ?? null);
}

export function presentPublicAuthor(input: {
  username: string | null;
  avatarUrl: string | null;
  rank: string | null;
}): { username: string | null; avatarUrl: string | null; rank: string | null; deleted: boolean } {
  if (isAnonymisedUsername(input.username)) {
    return {
      username: DELETED_AUTHOR_LABEL,
      avatarUrl: null,
      rank: null,
      deleted: true,
    };
  }
  return {
    username: input.username,
    avatarUrl: input.avatarUrl,
    rank: input.rank,
    deleted: false,
  };
}

export type DeletionProfileSnapshot = {
  role: string;
  username: string | null;
  requestedAt: Date | null;
  scheduledFor: Date | null;
  deletedAt: Date | null;
  isAgent?: boolean;
  isHouse?: boolean;
};

export type DeletionRequestPlan =
  | { kind: "reject"; status: 409; error: string; message: string }
  | { kind: "already_pending"; requestedAt: Date; scheduledFor: Date }
  | { kind: "schedule"; requestedAt: Date; scheduledFor: Date };

const ADMIN_BLOCK = {
  kind: "reject" as const,
  status: 409 as const,
  error: "admin_self_deletion_blocked",
  message:
    "Admins cannot self-delete. Ask another admin to demote your role first, then retry the deletion.",
};

const PROTECTED_BLOCK = {
  kind: "reject" as const,
  status: 409 as const,
  error: "protected_account",
  message: "This account cannot be deleted.",
};

const FINALISED_BLOCK = {
  kind: "reject" as const,
  status: 409 as const,
  error: "already_finalised",
  message: "This account has already been deleted.",
};

const ERASURE_BLOCK = {
  kind: "reject" as const,
  status: 409 as const,
  error: "erasure_started",
  message: "Deletion has already started and can no longer be cancelled.",
};

export function planDeletionRequest(
  profile: DeletionProfileSnapshot,
  now: Date,
): DeletionRequestPlan {
  if (profile.deletedAt) return FINALISED_BLOCK;
  if (profile.role === "admin") return ADMIN_BLOCK;
  if (profile.role === "system" || profile.isAgent || profile.isHouse) return PROTECTED_BLOCK;
  if (isErasureStarted(profile)) return ERASURE_BLOCK;
  if (profile.requestedAt && profile.scheduledFor) {
    return {
      kind: "already_pending",
      requestedAt: profile.requestedAt,
      scheduledFor: profile.scheduledFor,
    };
  }
  return {
    kind: "schedule",
    requestedAt: now,
    scheduledFor: new Date(now.getTime() + DELETION_WINDOW_MS),
  };
}

export type DeletionCancelPlan =
  | { kind: "reject"; status: 409; error: string; message: string }
  | { kind: "noop" }
  | { kind: "cancel" };

export function planDeletionCancel(profile: DeletionProfileSnapshot): DeletionCancelPlan {
  if (profile.deletedAt) {
    return {
      kind: "reject",
      status: 409,
      error: "already_finalised",
      message: "This account has already been deleted; the window to cancel has passed.",
    };
  }
  if (isErasureStarted(profile)) return ERASURE_BLOCK;
  if (!profile.requestedAt) return { kind: "noop" };
  return { kind: "cancel" };
}

export type AuthDeleteError = { status?: number; message?: string } | null | undefined;

/** A missing Auth user (404 / "not found") counts as success. */
export function classifyAuthDeleteError(
  error: AuthDeleteError,
): "deleted" | "already_missing" | "failed" {
  if (!error) return "deleted";
  const status = error.status;
  const msg = error.message ?? "";
  if (status === 404 || /user.*not.*found/i.test(msg)) return "already_missing";
  return "failed";
}

/** `deletedAt` is stamped only after Auth deletion succeeds or the user is already gone. */
export function shouldStampDeletedAt(
  outcome: "deleted" | "already_missing" | "failed",
): boolean {
  return outcome === "deleted" || outcome === "already_missing";
}

const IDENTIFYING_JSON_KEYS = new Set([
  "username",
  "userName",
  "email",
  "authEmail",
  "adminEmail",
  "fullName",
  "full_name",
  "phone",
  "phoneNumber",
  "phone_number",
  "recoveryEmail",
  "recovery_email",
  "avatarUrl",
  "avatar_url",
  "avatarSeed",
  "avatar_seed",
  "bio",
  "ip",
  "ipAddress",
  "ip_address",
  "userAgent",
  "user_agent",
  "deviceId",
  "device_id",
  "sessionId",
  "session_id",
  "referralCode",
  "referral_code",
  "dateOfBirth",
  "date_of_birth",
  "socialXHandle",
  "socialInstagramHandle",
  "token",
  "tokenHash",
  "token_hash",
]);

/** Structural bet fields that are the historical result, not identity. */
const BET_KEEP_KEYS = new Set([
  "predictedScore",
  "confidence",
  "scoreAtEntry",
  "actionId",
  "costBasis",
  "realisedPnl",
  "postTradePrice",
  "direction",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function collectProfileIdentifiers(
  profile: {
    username?: string | null;
    fullName?: string | null;
    recoveryEmail?: string | null;
    phoneNumber?: string | null;
    referralCode?: string | null;
    socialXHandle?: string | null;
    socialInstagramHandle?: string | null;
  },
  authEmail: string | null,
): string[] {
  const raw = [
    profile.username,
    profile.fullName,
    profile.recoveryEmail,
    profile.phoneNumber,
    profile.referralCode,
    profile.socialXHandle,
    profile.socialInstagramHandle,
    authEmail,
  ];
  const out: string[] = [];
  for (const value of raw) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length < 3) continue;
    if (isAnonymisedUsername(trimmed)) continue;
    if (out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    out.push(trimmed);
  }
  return out;
}

export function redactIdentifyingText(value: string, identifiers: string[]): string | null {
  let next = value;
  for (const id of identifiers) {
    if (id.length < 3) continue;
    next = next.replace(new RegExp(escapeRegExp(id), "gi"), "");
  }
  const trimmed = next.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function scrubIdentifyingJson(value: unknown, identifiers: string[]): unknown {
  if (typeof value === "string") return redactIdentifyingText(value, identifiers);
  if (Array.isArray(value)) return value.map((item) => scrubIdentifyingJson(item, identifiers));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTIFYING_JSON_KEYS.has(key)) continue;
    out[key] = scrubIdentifyingJson(child, identifiers);
  }
  return out;
}

export function scrubBetMetadata(metadata: unknown, identifiers: string[]): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return scrubIdentifyingJson(metadata, identifiers);
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(metadata as Record<string, unknown>)) {
    if (!BET_KEEP_KEYS.has(key)) continue;
    out[key] = scrubIdentifyingJson(child, identifiers);
  }
  return out;
}

/**
 * Suggestion text stays when it is the suggested option. If the text
 * is the suggester's own name, email, or username, clear it. The
 * suggester username itself is cleared by anonymising the profile
 * (the admin list joins `profiles.username`).
 */
export function suggestionNameAfterErasure(name: string, identifiers: string[]): string {
  const normalized = name.trim().toLowerCase();
  const identifies = identifiers.some((id) => id.trim().toLowerCase() === normalized);
  return identifies ? DELETED_COMMENT_BODY : name;
}

export function buildAnonymisedProfilePatch(anonymousUsername: string): Record<string, unknown> {
  return {
    username: anonymousUsername,
    fullName: null,
    avatarUrl: null,
    avatarSeed: null,
    bio: null,
    dateOfBirth: null,
    gender: null,
    countryOfOrigin: null,
    countryOfResidence: null,
    ethnicity: null,
    recoveryEmail: null,
    recoveryEmailVerified: false,
    recoveryEmailVerifyCodeHash: null,
    recoveryEmailVerifyExpiresAt: null,
    phoneNumber: null,
    socialXHandle: null,
    socialInstagramHandle: null,
    occupationIndustry: null,
    profileBannerUrl: null,
    profileTheme: null,
    isPublic: false,
    positionsPublic: false,
    profileFieldsPublic: false,
    dobPublic: false,
    genderPublic: false,
    countryPublic: false,
    ethnicityPublic: false,
    socialHandlesPublic: false,
    occupationPublic: false,
    predictCredits: 0,
    xpPoints: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastLoginDate: null,
    referralCode: null,
    referredBy: null,
    firstActionAt: null,
    referralCreditFiredAt: null,
    statedInterests: [],
    rank: "Citizen",
    highestRank: null,
    winRate: 0,
    totalVotes: 0,
    totalPredictions: 0,
    lastActiveAt: null,
    role: "user",
  };
}

/** Account-specific rows with no reason to survive. Profile columns
 *  (streaks, Vox balance, referrals, interests) are cleared by
 *  `buildAnonymisedProfilePatch`. Votes, poll responses, matchup
 *  votes, and predictions are intentionally absent. */
export const ACCOUNT_STATE_TABLES = [
  "xp_ledger",
  "user_badges",
  "user_category_engagement",
  "profile_item_privacy",
  "notification_preferences",
  "notification_market_mutes",
  "notifications",
  "email_unsubscribe_state",
  "user_rank_snapshots",
  "user_favourites",
] as const;

export type AccountStateTable = (typeof ACCOUNT_STATE_TABLES)[number];

export type ErasureWorld = {
  profile: {
    id: string;
    username: string | null;
    fullName: string | null;
    bio: string | null;
    recoveryEmail: string | null;
    phoneNumber: string | null;
    referralCode: string | null;
    predictCredits: number;
    xpPoints: number;
    currentStreak: number;
    avatarUrl: string | null;
    deletedAt: Date | null;
    isPublic: boolean;
  };
  comments: Array<{ id: string; userId: string; body: string }>;
  votes: Array<{ id: string; userId: string; choice: string }>;
  predictions: Array<{ id: string; userId: string; stake: number; betMetadata: unknown }>;
  ledger: Array<{ id: string; userId: string; amount: number; metadata: unknown }>;
  xp: Array<{ id: string; userId: string }>;
  preferences: Array<{ userId: string }>;
  suggestions: Array<{ id: string; suggestedBy: string; name: string }>;
  audit: Array<{
    id: string;
    targetId: string;
    adminId: string;
    adminEmail: string | null;
    previousData: unknown;
    metadata: unknown;
  }>;
  telemetry: Array<{
    id: string;
    userId: string | null;
    userAgent: string | null;
    metadata: unknown;
  }>;
};

/**
 * In-memory picture of permanent erasure BEFORE Auth deletion and
 * BEFORE `deletedAt` is stamped. Production applies the same helpers
 * inside the database transaction.
 */
export function applyErasurePlan(
  world: ErasureWorld,
  opts: { anonymousUsername: string; identifiers: string[] },
): ErasureWorld {
  const { anonymousUsername, identifiers } = opts;
  const userId = world.profile.id;
  const patch = buildAnonymisedProfilePatch(anonymousUsername);
  return {
    profile: {
      ...world.profile,
      username: patch.username as string,
      fullName: null,
      bio: null,
      recoveryEmail: null,
      phoneNumber: null,
      referralCode: null,
      predictCredits: 0,
      xpPoints: 0,
      currentStreak: 0,
      avatarUrl: null,
      isPublic: false,
      deletedAt: null,
    },
    comments: world.comments.map((row) =>
      row.userId === userId ? { ...row, body: DELETED_COMMENT_BODY } : row,
    ),
    votes: world.votes.map((row) => ({ ...row })),
    predictions: world.predictions.map((row) =>
      row.userId === userId
        ? { ...row, betMetadata: scrubBetMetadata(row.betMetadata, identifiers) }
        : row,
    ),
    ledger: world.ledger.map((row) =>
      row.userId === userId
        ? { ...row, metadata: scrubIdentifyingJson(row.metadata, identifiers) }
        : row,
    ),
    xp: world.xp.filter((row) => row.userId !== userId),
    preferences: world.preferences.filter((row) => row.userId !== userId),
    suggestions: world.suggestions.map((row) =>
      row.suggestedBy === userId
        ? { ...row, name: suggestionNameAfterErasure(row.name, identifiers) }
        : row,
    ),
    audit: world.audit.map((row) => {
      const aboutUser = row.targetId === userId || row.adminId === userId;
      if (!aboutUser) return row;
      return {
        ...row,
        adminEmail: row.adminId === userId ? null : row.adminEmail,
        previousData:
          row.targetId === userId
            ? scrubIdentifyingJson(row.previousData, identifiers)
            : row.previousData,
        metadata: scrubIdentifyingJson(row.metadata, identifiers),
      };
    }),
    telemetry: world.telemetry.map((row) =>
      row.userId === userId
        ? {
            ...row,
            userId: null,
            userAgent: null,
            metadata: scrubIdentifyingJson(row.metadata, identifiers),
          }
        : row,
    ),
  };
}
