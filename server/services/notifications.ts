import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { notificationPreferences, notifications, profiles } from "@shared/schema";
import { logger } from "../log";

/**
 * Notification kind registry.
 *
 * Source-of-truth mapping from kind → category + default priority.
 * The client-side registry (client/src/lib/notifications/registry.ts)
 * mirrors this for icon/accent rendering. Server only needs category
 * (for prefs lookup) and priority (for the high-priority toast hint
 * we surface via the realtime stream).
 *
 * Categories mirror notification_preferences columns:
 *   predictions | favorites | social | account | system
 */
export type NotificationKind =
  | "market_resolved"
  | "market_closing_soon"
  | "market_void_refund"
  | "favorite_rank_cross"
  | "favorite_hot_mover"
  | "favorite_new_market"
  | "comment_reply"
  | "comment_upvote_milestone"
  | "rank_up"
  | "streak_milestone"
  | "credits_low"
  | "credits_granted"
  | "announcement";

export type NotificationCategory =
  | "predictions"
  | "favorites"
  | "social"
  | "account"
  | "system";

interface KindMeta {
  category: NotificationCategory;
  priority: 0 | 1;
}

const KIND_REGISTRY: Record<NotificationKind, KindMeta> = {
  market_resolved: { category: "predictions", priority: 1 },
  market_closing_soon: { category: "predictions", priority: 0 },
  market_void_refund: { category: "predictions", priority: 1 },
  favorite_rank_cross: { category: "favorites", priority: 0 },
  favorite_hot_mover: { category: "favorites", priority: 0 },
  favorite_new_market: { category: "favorites", priority: 0 },
  comment_reply: { category: "social", priority: 0 },
  comment_upvote_milestone: { category: "social", priority: 0 },
  rank_up: { category: "account", priority: 1 },
  streak_milestone: { category: "account", priority: 0 },
  credits_low: { category: "account", priority: 0 },
  credits_granted: { category: "account", priority: 1 },
  announcement: { category: "system", priority: 1 },
};

export function getKindCategory(kind: NotificationKind): NotificationCategory {
  return KIND_REGISTRY[kind].category;
}

export function getKindPriority(kind: NotificationKind): 0 | 1 {
  return KIND_REGISTRY[kind].priority;
}

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  groupKey?: string;
  /**
   * Stable per-event key. Re-running the same fanout (e.g. derivation
   * job twice in the same hour) must produce the same key so the unique
   * (user_id, idempotency_key) constraint silently absorbs it.
   */
  idempotencyKey: string;
  /**
   * Optional override; defaults to the kind's registry priority.
   */
  priority?: 0 | 1;
}

const CATEGORY_TO_IN_APP_COLUMN: Record<NotificationCategory, keyof typeof notificationPreferences.$inferSelect> = {
  predictions: "predictionsInApp",
  favorites: "favoritesInApp",
  social: "socialInApp",
  account: "accountInApp",
  system: "systemInApp",
};

/**
 * Returns the user's effective in-app preference for a category.
 *
 * If no preferences row exists yet, defaults to `true` (categories all
 * default to enabled). We deliberately do NOT auto-create the row on
 * read here — the GET /api/me/notification-preferences endpoint owns
 * lazy creation so writes happen on a user-triggered request rather
 * than on every notification fanout.
 */
async function isInAppEnabled(userId: string, category: NotificationCategory): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);

    if (!row) return true;

    const column = CATEGORY_TO_IN_APP_COLUMN[category];
    return row[column] !== false;
  } catch (err) {
    // Fail-open: if the prefs table is briefly unavailable we still want
    // the user to receive their notification rather than silently drop.
    logger.warn({ err, userId, category }, "[notifications] prefs lookup failed; defaulting to enabled");
    return true;
  }
}

/**
 * Insert a notification with idempotency.
 *
 * - Short-circuits if the user has the category disabled.
 * - Skips inserts for inactive/deleted users (FK would fail anyway).
 * - Idempotent: ON CONFLICT (user_id, idempotency_key) DO NOTHING.
 *
 * Returns the inserted row id (or `null` if idempotency-suppressed
 * or user-prefs-suppressed). Callers should not rely on return value
 * for control flow — fire-and-forget is fine.
 */
export async function createNotification(input: CreateNotificationInput): Promise<string | null> {
  const meta = KIND_REGISTRY[input.kind];
  if (!meta) {
    logger.warn({ kind: input.kind }, "[notifications] unknown kind; ignoring");
    return null;
  }

  const enabled = await isInAppEnabled(input.userId, meta.category);
  if (!enabled) return null;

  const priority = input.priority ?? meta.priority;

  try {
    const result = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        kind: input.kind,
        category: meta.category,
        title: input.title,
        body: input.body,
        href: input.href,
        actorUserId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ?? null,
        priority,
        groupKey: input.groupKey,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({
        target: [notifications.userId, notifications.idempotencyKey],
      })
      .returning({ id: notifications.id });

    return result[0]?.id ?? null;
  } catch (err) {
    // Most likely cause: profile row was deleted between the upstream
    // event and our fanout. Log and swallow — notifications are
    // best-effort and should never break the originating flow.
    logger.warn({ err, userId: input.userId, kind: input.kind }, "[notifications] insert failed");
    return null;
  }
}

/**
 * Fan out the same notification to many users. Used by the announcement
 * tool and by derivation jobs that compute one event affecting N users
 * (e.g. a market_resolved fanning out to every winner/loser).
 *
 * Each user gets their own idempotency key (built via `keyFor(userId)`)
 * so re-runs are safe.
 */
export async function createNotificationsBulk(
  userIds: string[],
  build: (userId: string) => CreateNotificationInput,
): Promise<number> {
  if (userIds.length === 0) return 0;

  // Filter to existing profiles to avoid pointless FK-failure logs when
  // an upstream event references a user who has since deleted their
  // account. One round-trip; cheap.
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(inArray(profiles.id, userIds));
  const existingIds = new Set(existing.map((r) => r.id));

  let inserted = 0;
  for (const userId of userIds) {
    if (!existingIds.has(userId)) continue;
    const id = await createNotification(build(userId));
    if (id) inserted += 1;
  }
  return inserted;
}

/**
 * Read-side helpers (route handlers use these).
 */
export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date(), seenAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  return result.length > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const now = new Date();
  const result = await db
    .update(notifications)
    .set({ readAt: now, seenAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return result.length;
}

export async function markNotificationsSeen(userId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ seenAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.seenAt)))
    .returning({ id: notifications.id });
  return result.length;
}

export async function dismissNotification(userId: string, notificationId: string): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  return result.length > 0;
}
