import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { notificationPreferences, notifications } from "@shared/schema";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsSeen,
  type NotificationCategory,
} from "../services/notifications";

/**
 * In-app notifications: list, badge count, mark read/seen/dismiss, and
 * per-user preferences. All endpoints require authentication. Inserts
 * are not exposed — the server is the only writer (synchronous fanout
 * + derivation jobs).
 *
 *   GET    /api/me/notifications?cursor=&category=&unreadOnly=
 *   GET    /api/me/notifications/unread-count
 *   POST   /api/me/notifications/seen
 *   POST   /api/me/notifications/read-all
 *   POST   /api/me/notifications/:id/read
 *   DELETE /api/me/notifications/:id
 *   GET    /api/me/notification-preferences
 *   PATCH  /api/me/notification-preferences
 */

const VALID_CATEGORIES = new Set<NotificationCategory>([
  "predictions",
  "favorites",
  "social",
  "account",
  "system",
]);

// Capped at 99 to keep the bell badge stable; the UI renders "9+" anyway.
const UNREAD_COUNT_CAP = 99;
// Page size for the inbox panel. Picked large enough to fill a tall
// desktop dropdown without an empty bottom but small enough that the
// realtime invalidation flow doesn't refetch a long list on every ping.
const LIST_PAGE_LIMIT = 25;

const PREFERENCE_FIELDS = [
  "predictionsInApp",
  "favoritesInApp",
  "socialInApp",
  "accountInApp",
  "systemInApp",
  "predictionsEmail",
  "favoritesEmail",
  "socialEmail",
  "accountEmail",
  "systemEmail",
  "predictionsPush",
  "favoritesPush",
  "socialPush",
  "accountPush",
  "systemPush",
] as const;

const updatePreferencesSchema = z
  .object(
    Object.fromEntries(
      PREFERENCE_FIELDS.map((field) => [field, z.boolean().optional()] as const),
    ) as Record<(typeof PREFERENCE_FIELDS)[number], z.ZodOptional<z.ZodBoolean>>,
  )
  .strict();

export function registerNotificationsRoutes(app: Express): void {
  // ── List notifications (paginated) ────────────────────────────────────
  // Cursor is the createdAt ISO string of the last-seen item. We sort
  // newest-first; the cursor lets us page backwards in time without
  // OFFSET-induced drift when new items arrive.
  app.get("/api/me/notifications", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const categoryParam = typeof req.query.category === "string" ? req.query.category : null;
      const unreadOnly = req.query.unreadOnly === "true" || req.query.unreadOnly === "1";
      const requestedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : LIST_PAGE_LIMIT;

      const conditions = [
        eq(notifications.userId, userId),
        isNull(notifications.dismissedAt),
      ];

      if (categoryParam && VALID_CATEGORIES.has(categoryParam as NotificationCategory)) {
        conditions.push(eq(notifications.category, categoryParam));
      }
      if (unreadOnly) {
        conditions.push(isNull(notifications.readAt));
      }
      if (cursor) {
        const parsed = new Date(cursor);
        if (!Number.isNaN(parsed.getTime())) {
          conditions.push(lt(notifications.createdAt, parsed));
        }
      }

      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.createdAt.toISOString() : null;

      res.json({
        items,
        nextCursor,
      });
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] list failed");
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // ── Unread count for the bell badge ───────────────────────────────────
  // Capped at UNREAD_COUNT_CAP so the badge never reads "247". The UI
  // renders "9+" once count >= 10. Returns `seenCount` separately so the
  // bell can clear the visual pulse the moment the user opens it without
  // also marking each row as read.
  app.get("/api/me/notifications/unread-count", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      const [unreadRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            isNull(notifications.dismissedAt),
          ),
        );

      const [unseenRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            isNull(notifications.seenAt),
            isNull(notifications.dismissedAt),
          ),
        );

      const unread = Math.min(unreadRow?.count ?? 0, UNREAD_COUNT_CAP);
      const unseen = Math.min(unseenRow?.count ?? 0, UNREAD_COUNT_CAP);
      res.json({ unread, unseen, cap: UNREAD_COUNT_CAP });
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] unread-count failed");
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // ── Mark all visible notifications as 'seen' (clears bell pulse) ─────
  app.post("/api/me/notifications/seen", requireAuth, async (req: AuthRequest, res) => {
    try {
      const updated = await markNotificationsSeen(req.userId!);
      res.json({ updated });
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] mark seen failed");
      res.status(500).json({ error: "Failed to mark notifications seen" });
    }
  });

  // ── Mark a single notification read ──────────────────────────────────
  app.post("/api/me/notifications/:id/read", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: "Notification id required" });
      const ok = await markNotificationRead(req.userId!, id);
      if (!ok) return res.status(404).json({ error: "Notification not found" });
      res.json({ success: true });
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] mark read failed");
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  });

  // ── Mark all notifications read ──────────────────────────────────────
  app.post("/api/me/notifications/read-all", requireAuth, async (req: AuthRequest, res) => {
    try {
      const updated = await markAllNotificationsRead(req.userId!);
      res.json({ updated });
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] mark all read failed");
      res.status(500).json({ error: "Failed to mark all notifications read" });
    }
  });

  // ── Soft-dismiss (hide from inbox, keep row for audit) ───────────────
  app.delete("/api/me/notifications/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: "Notification id required" });
      const ok = await dismissNotification(req.userId!, id);
      if (!ok) return res.status(404).json({ error: "Notification not found" });
      res.json({ success: true });
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] dismiss failed");
      res.status(500).json({ error: "Failed to dismiss notification" });
    }
  });

  // ── Preferences: GET (lazy-creates on first read) ────────────────────
  app.get("/api/me/notification-preferences", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      let [prefs] = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1);

      if (!prefs) {
        // Defaults are encoded in the table DDL (in-app=true, email/push=false).
        // Insert returns the row so we don't double-round-trip.
        const [created] = await db
          .insert(notificationPreferences)
          .values({ userId })
          .onConflictDoNothing({ target: notificationPreferences.userId })
          .returning();
        if (created) {
          prefs = created;
        } else {
          // Race: another concurrent request inserted first; re-read.
          [prefs] = await db
            .select()
            .from(notificationPreferences)
            .where(eq(notificationPreferences.userId, userId))
            .limit(1);
        }
      }

      res.json(prefs);
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] prefs GET failed");
      res.status(500).json({ error: "Failed to fetch notification preferences" });
    }
  });

  // ── Preferences: PATCH (partial update) ──────────────────────────────
  app.patch("/api/me/notification-preferences", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const parsed = updatePreferencesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid preference payload", details: parsed.error.format() });
      }

      // Filter out email/push toggles in v1 — the UI is disabled for
      // these channels, but a hostile client could PATCH them directly.
      // We accept them silently (so phase-2 rollout doesn't need a
      // breaking change) but currently no dispatcher reads those flags.
      const updates: Record<string, boolean | Date> = { ...parsed.data, updatedAt: new Date() };
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const [updated] = await db
        .insert(notificationPreferences)
        .values({ userId, ...parsed.data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: updates,
        })
        .returning();

      res.json(updated);
    } catch (error: any) {
      req.log?.error({ err: error }, "[notifications] prefs PATCH failed");
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  });
}
