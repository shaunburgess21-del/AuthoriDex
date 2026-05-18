import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { notificationPreferences, notifications, notificationMarketMutes, profiles } from "@shared/schema";
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
  | "position_move_alert"
  | "weekly_pnl_digest"
  | "favorite_rank_cross"
  | "favorite_hot_mover"
  | "favorite_new_market"
  | "comment_reply"
  | "comment_upvote_milestone"
  | "rank_up"
  | "streak_milestone"
  | "credits_low"
  | "credits_granted"
  | "badge_awarded"
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
  position_move_alert: { category: "predictions", priority: 0 },
  weekly_pnl_digest: { category: "predictions", priority: 1 },
  favorite_rank_cross: { category: "favorites", priority: 0 },
  favorite_hot_mover: { category: "favorites", priority: 0 },
  favorite_new_market: { category: "favorites", priority: 0 },
  comment_reply: { category: "social", priority: 0 },
  comment_upvote_milestone: { category: "social", priority: 0 },
  rank_up: { category: "account", priority: 1 },
  streak_milestone: { category: "account", priority: 0 },
  credits_low: { category: "account", priority: 0 },
  credits_granted: { category: "account", priority: 1 },
  badge_awarded: { category: "account", priority: 1 },
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
  /**
   * Market this notification is about. When set, the dispatcher checks
   * the user's `notification_market_mutes` list and short-circuits if
   * the market is muted — composing with the category-level toggles.
   * Use the market's primary key (`prediction_markets.id`), not its
   * slug, so jackpot/H2H/Race etc. all use the same lookup column.
   */
  marketId?: string;
  /**
   * Opt-in: when the idempotency key already exists, UPDATE
   * `title / body / metadata` in place instead of `DO NOTHING`.
   *
   * Used by the closing-soon milestone derivation so a row keyed on
   * (user, variant, milestone) can stay current as the time-remaining
   * label drifts ("Entries close in 4h" → "Entries close in 2h")
   * without re-marking the row unread or bumping `created_at`. We
   * deliberately do NOT include `priority / read_at / seen_at /
   * dismissed_at / created_at` in the update set, and the update is
   * suppressed entirely if the row was already dismissed — actively
   * swiping a row away should not be undone by the next cron tick.
   *
   * Defaults to false; every existing call site keeps `DO NOTHING`
   * semantics.
   */
  refreshOnConflict?: boolean;
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
 * Returns true when the target user is an agent profile. Agents never
 * read notifications, so writing rows for them is pure storage cost
 * (~56 agents x ~30 markets/week of dead rows). Gating at the
 * dispatcher covers every notification kind, including future ones,
 * without each call site having to remember the check.
 *
 * Fail-OPEN: if the lookup blips, we'd rather deliver an extra ping
 * to an agent (silently absorbed in DB) than drop a human's.
 */
async function isAgentProfile(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ isAgent: profiles.isAgent })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return Boolean(row?.isAgent);
  } catch (err) {
    logger.warn({ err, userId }, "[notifications] agent lookup failed; defaulting to non-agent");
    return false;
  }
}

/**
 * Returns true when the user has explicitly muted this market. We
 * fail OPEN here too — a transient DB hiccup shouldn't silently drop
 * a notification (the worst case is the user gets a single ping they
 * thought they'd silenced; the right case is a genuine alert always
 * lands).
 */
async function isMarketMuted(userId: string, marketId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ marketId: notificationMarketMutes.marketId })
      .from(notificationMarketMutes)
      .where(
        and(
          eq(notificationMarketMutes.userId, userId),
          eq(notificationMarketMutes.marketId, marketId),
        ),
      )
      .limit(1);
    return Boolean(row);
  } catch (err) {
    logger.warn({ err, userId, marketId }, "[notifications] mute lookup failed; defaulting to unmuted");
    return false;
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

  // Identity check first: agents never read notifications, so dropping
  // here saves the per-row prefs + mute lookups for the ~1680 agent
  // notifications/week the resolver fanouts would otherwise generate.
  if (await isAgentProfile(input.userId)) return null;

  const enabled = await isInAppEnabled(input.userId, meta.category);
  if (!enabled) return null;

  if (input.marketId) {
    const muted = await isMarketMuted(input.userId, input.marketId);
    if (muted) return null;
  }

  const priority = input.priority ?? meta.priority;

  try {
    const baseInsert = db
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
      });

    // Conflict policy: default keeps the long-standing DO NOTHING (a
    // re-fired event silently absorbs). With `refreshOnConflict` we
    // UPDATE only the content-bearing columns from EXCLUDED and gate
    // the update behind `dismissed_at IS NULL` so a user-dismissed
    // row cannot resurrect on the next tick. createdAt / readAt /
    // seenAt are intentionally absent from `set` so they stay
    // exactly as they were when the row was first inserted.
    const query = input.refreshOnConflict
      ? baseInsert.onConflictDoUpdate({
          target: [notifications.userId, notifications.idempotencyKey],
          set: {
            title: sql`EXCLUDED.title`,
            body: sql`EXCLUDED.body`,
            metadata: sql`EXCLUDED.metadata`,
          },
          setWhere: sql`${notifications.dismissedAt} IS NULL`,
        })
      : baseInsert.onConflictDoNothing({
          target: [notifications.userId, notifications.idempotencyKey],
        });

    const result = await query.returning({ id: notifications.id });

    // Note: with refreshOnConflict, returning the id on an UPDATE path
    // means the function returns "row exists" rather than "row was
    // freshly inserted." Callers (e.g. the closing-soon deriver) only
    // use the return value to count emissions, so this is harmless;
    // documented here so future call sites don't rely on the stricter
    // "newly inserted" semantic.
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

  // Filter to existing non-agent profiles in one round-trip. Drops
  // both deleted accounts (FK guard) and agent rows (storage noise —
  // see `isAgentProfile`). `createNotification` re-checks `is_agent`
  // per row as a safety net for any caller bypassing this batched
  // path.
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(inArray(profiles.id, userIds), eq(profiles.isAgent, false)));
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
 * Fast path for admin-authored broadcasts that need to fan out to
 * thousands of users in one request.
 *
 * `createNotificationsBulk` is fine for derivation jobs that produce
 * tens of insertions per event but does N round-trips for N users —
 * a 10k-user broadcast through it would take ~50s and stall the
 * Express request.
 *
 * This helper trades the per-user pref/market-mute lookups for two
 * batched ones, plus chunked multi-row INSERTs:
 *   1. ONE select on notification_preferences for the full userId list
 *      → drop opted-out users client-side.
 *   2. ONE select on profiles to drop deleted users (FK guard).
 *   3. INSERT ... VALUES (...), (...), ... ON CONFLICT DO NOTHING in
 *      500-row chunks; the existing `(user_id, idempotency_key)` unique
 *      constraint absorbs retries safely.
 *
 * Market-mutes don't apply (broadcasts have no `marketId`), so we
 * don't read that table. Returns the count of rows actually inserted.
 */
export interface BroadcastFanoutInput {
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  priority?: 0 | 1;
  metadata?: Record<string, unknown>;
  /**
   * Builds the per-user idempotency key. Required so re-running the
   * same broadcast (e.g. retry after a 502) cleanly no-ops.
   */
  buildIdempotencyKey: (userId: string) => string;
}

export async function createBroadcastFanout(
  input: BroadcastFanoutInput,
): Promise<number> {
  if (input.userIds.length === 0) return 0;

  const meta = KIND_REGISTRY[input.kind];
  if (!meta) {
    logger.warn({ kind: input.kind }, "[notifications] unknown kind in fanout");
    return 0;
  }

  const priority = input.priority ?? meta.priority;
  const inAppColumn = CATEGORY_TO_IN_APP_COLUMN[meta.category];

  // 1. FK + agent guard — drop deleted accounts AND agent profiles
  // in one round-trip. Agents never read notifications; broadcasts
  // (admin announcements, etc.) addressed to "all users" must not
  // bloat the table with thousands of dead agent rows.
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(inArray(profiles.id, input.userIds), eq(profiles.isAgent, false)));
  let eligible = existing.map((r) => r.id);
  if (eligible.length === 0) return 0;

  // 2. Pref lookup — drop ids whose <category>InApp is explicitly false.
  // Users without a prefs row default to enabled (we don't auto-create
  // here; first read of /api/me/notification-preferences does that).
  const prefRows = await db
    .select({
      userId: notificationPreferences.userId,
      flag: notificationPreferences[inAppColumn] as unknown as typeof notificationPreferences.systemInApp,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, eligible));
  const optedOut = new Set(
    prefRows.filter((r) => r.flag === false).map((r) => r.userId),
  );
  if (optedOut.size > 0) {
    eligible = eligible.filter((id) => !optedOut.has(id));
  }
  if (eligible.length === 0) return 0;

  // 3. Chunked bulk insert. 500 rows/INSERT keeps each statement under
  // typical query-size limits (Postgres default `max_stack_depth` and
  // `extended-query-protocol` can choke on > ~32k parameters, and we
  // emit ~10 columns per row → 5000 params per statement is comfortable).
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < eligible.length; i += CHUNK) {
    const chunk = eligible.slice(i, i + CHUNK);
    const values = chunk.map((userId) => ({
      userId,
      kind: input.kind,
      category: meta.category,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      priority,
      metadata: (input.metadata ?? null) as Record<string, unknown> | null,
      idempotencyKey: input.buildIdempotencyKey(userId),
    }));

    try {
      const result = await db
        .insert(notifications)
        .values(values)
        .onConflictDoNothing({
          target: [notifications.userId, notifications.idempotencyKey],
        })
        .returning({ id: notifications.id });
      inserted += result.length;
    } catch (err) {
      // Per-chunk failure tolerance: log and continue. This is rarely
      // the right call for transactional writes, but a notification
      // fanout that partially succeeds is strictly better than one
      // that aborts mid-broadcast.
      logger.warn(
        { err, chunkSize: chunk.length, kind: input.kind },
        "[notifications] broadcast chunk insert failed; continuing",
      );
    }
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

/**
 * Mark every unread notification in a groupKey as read.
 *
 * Companion to `flattenNotifications`'s client-side collapse: when the
 * user clicks the collapsed head row in the panel, the badge should
 * drop by the full count of unread rows in that group — not just the
 * visible head — otherwise the unread count diverges from the user's
 * perception ("I just dealt with this market"). We also set `seen_at`
 * here for parity with the per-row helper above.
 *
 * Read state is per-row by design, so this is a bulk UPDATE rather
 * than a denormalised flag on the group. Callers should not pass
 * empty / null groupKey — the route validates the input.
 */
export async function markNotificationGroupRead(
  userId: string,
  groupKey: string,
): Promise<number> {
  const now = new Date();
  const result = await db
    .update(notifications)
    .set({ readAt: now, seenAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.groupKey, groupKey),
        isNull(notifications.readAt),
      ),
    )
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

/**
 * Soft-dismiss every undismissed notification in a groupKey.
 *
 * Without this, dismissing the head row of a collapsed group would
 * "roll back" the inbox to the next-older milestone (whose body is
 * already stale because the deriver doesn't refresh rows outside the
 * active milestone bucket). Group-dismiss matches the user's intent of
 * "I'm done with this whole thing."
 */
export async function dismissNotificationGroup(
  userId: string,
  groupKey: string,
): Promise<number> {
  const now = new Date();
  const result = await db
    .update(notifications)
    .set({ dismissedAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.groupKey, groupKey),
        isNull(notifications.dismissedAt),
      ),
    )
    .returning({ id: notifications.id });
  return result.length;
}
