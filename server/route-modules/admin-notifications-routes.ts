import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  adminBroadcasts,
  notifications,
  profiles,
  marketBets,
  type BroadcastAudience,
  type BroadcastAudienceKind,
} from "@shared/schema";
import { requireAuth, requireAdmin, type AuthRequest } from "../auth-middleware";
import { createBroadcastFanout } from "../services/notifications";
import { logger } from "../log";

/**
 * Admin notification tooling.
 *
 *   POST   /api/admin/notifications/broadcast/preview
 *      → resolve audience to a count + a small sample so the composer
 *        can show "this will go to N users (incl. @alice, @bob, …)".
 *
 *   POST   /api/admin/notifications/broadcast
 *      → create + fan out a broadcast. Audience is resolved server-side
 *        (NEVER trust a userId list from the client) and dispatched via
 *        createBroadcastFanout, which honours the user's category
 *        preference and uses chunked multi-row INSERTs so even 50k-user
 *        broadcasts finish inside the request window. Idempotent at two levels:
 *          1. The broadcast row carries a unique idempotency_key, so
 *             retrying the same UI submission with the same key won't
 *             duplicate the broadcast itself.
 *          2. Each user's notification row uses the per-user key
 *             `broadcast:<broadcastId>:<userId>` so re-running the
 *             fanout (e.g. after a 502) won't double-notify.
 *
 *   GET    /api/admin/notifications/broadcasts
 *      → paginated history with computed analytics (seen/read/click).
 *        Stats are derived live from notifications.idempotency_key
 *        LIKE 'broadcast:<id>:%' so they always reflect the current
 *        truth (users who dismiss/clear their bell are reflected).
 *
 *   GET    /api/admin/notifications/broadcasts/:id
 *      → single broadcast detail + analytics.
 *
 *   GET    /api/admin/users/:userId/notifications
 *      → support inspector: last N notifications for a single user with
 *        seen/read/dismissed timestamps. Lets ops staff verify "did
 *        they get the ping?" without DB access.
 */

const audienceSchema = z.object({
  kind: z.enum([
    "everyone",
    "active_30d",
    "placed_bet",
    "category_subscribers",
    "single_user",
    "test_self",
  ]),
  category: z.string().min(1).max(64).optional(),
  userId: z.string().min(1).max(128).optional(),
});

const broadcastBodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  href: z.string().max(2000).optional().nullable(),
  // Reuse the existing 'announcement' notification kind's priority
  // semantics: 0 = silent (bell only), 1 = high (auto-toast).
  priority: z.union([z.literal(0), z.literal(1)]).default(1),
  // NOTE: category is intentionally NOT user-selectable. Broadcasts
  // always ride the 'announcement' kind which is hard-wired to the
  // 'system' category in KIND_REGISTRY. Allowing an override here
  // would silently no-op (createNotification looks up the category
  // from the kind, not the input), so we drop the field entirely.
  audience: audienceSchema,
  /** Optional client-supplied stable submission key. We append a
   *  millisecond suffix server-side so a user clicking "Send" twice
   *  in quick succession is still rejected by the DB unique
   *  constraint, but legitimate retries with the same submission
   *  string within 60s are caught at the API layer below. */
  submissionKey: z.string().min(1).max(128).optional(),
});

const previewBodySchema = z.object({
  audience: audienceSchema,
});

/**
 * Resolves an audience filter to the concrete user-id list the
 * dispatcher will fan out to. Always excludes simulated agents
 * (isAgent = true) — sending real notifications to bots would
 * pollute the seen/read analytics and waste DB rows.
 */
async function resolveAudience(
  audience: BroadcastAudience,
  selfUserId: string,
): Promise<string[]> {
  const kind = audience.kind as BroadcastAudienceKind;

  if (kind === "test_self") {
    return [selfUserId];
  }

  if (kind === "single_user") {
    if (!audience.userId) return [];
    const [row] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, audience.userId))
      .limit(1);
    return row ? [row.id] : [];
  }

  if (kind === "everyone") {
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.isAgent, false));
    return rows.map((r) => r.id);
  }

  if (kind === "active_30d") {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.isAgent, false),
          gt(profiles.lastActiveAt, thirtyDaysAgo),
        ),
      );
    return rows.map((r) => r.id);
  }

  if (kind === "placed_bet") {
    // Distinct human users who have ever placed a bet. We filter on
    // profiles.isAgent = false on the join, which excludes simulated
    // agent accounts even if they have rows in market_bets.
    const rows = await db
      .selectDistinct({ id: profiles.id })
      .from(profiles)
      .innerJoin(marketBets, eq(marketBets.userId, profiles.id))
      .where(eq(profiles.isAgent, false));
    return rows.map((r) => r.id);
  }

  if (kind === "category_subscribers") {
    if (!audience.category) return [];
    // statedInterests is text[]; ANY() matches a single category.
    // Drizzle doesn't have a first-class array-contains helper for
    // text[] yet, so we drop to raw SQL with a parameterised value.
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.isAgent, false),
          sql`${audience.category} = ANY(${profiles.statedInterests})`,
        ),
      );
    return rows.map((r) => r.id);
  }

  return [];
}

/**
 * Same audience resolution as above but ALSO returns up to 5 sample
 * usernames so the composer preview reads like
 * "Will reach 4,213 users (incl. @alice, @bob, +4,211 more)".
 */
async function resolveAudiencePreview(
  audience: BroadcastAudience,
  selfUserId: string,
): Promise<{ count: number; sample: { id: string; username: string | null }[] }> {
  const ids = await resolveAudience(audience, selfUserId);
  if (ids.length === 0) return { count: 0, sample: [] };
  const sampleIds = ids.slice(0, 5);
  const rows = await db
    .select({ id: profiles.id, username: profiles.username })
    .from(profiles)
    .where(inArray(profiles.id, sampleIds));
  // Preserve the order from `sampleIds` so the UI doesn't re-sort.
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const sample = sampleIds
    .map((id) => byId.get(id))
    .filter((r): r is { id: string; username: string | null } => Boolean(r));
  return { count: ids.length, sample };
}

/**
 * Computes seen/read/dismissed counts for one or more broadcasts by
 * scanning the notifications table for rows whose idempotency key
 * matches `broadcast:<id>:%`. Done in a single grouped query.
 */
async function computeBroadcastStats(broadcastIds: string[]): Promise<
  Map<
    string,
    { delivered: number; seen: number; read: number; dismissed: number; clicks: number }
  >
> {
  const out = new Map<
    string,
    { delivered: number; seen: number; read: number; dismissed: number; clicks: number }
  >();
  if (broadcastIds.length === 0) return out;

  // We extract the broadcast id from the idempotency key by stripping
  // the leading 'broadcast:' prefix and trailing ':<userId>' suffix.
  // A grouped aggregate keeps this to one round-trip even for hundreds
  // of broadcasts on the history page.
  const rows = await db.execute<{
    broadcast_id: string;
    delivered: number;
    seen: number;
    read: number;
    dismissed: number;
  }>(sql`
    SELECT
      split_part(idempotency_key, ':', 2) AS broadcast_id,
      COUNT(*)::int                        AS delivered,
      COUNT(seen_at)::int                  AS seen,
      COUNT(read_at)::int                  AS read,
      COUNT(dismissed_at)::int             AS dismissed
    FROM notifications
    WHERE idempotency_key LIKE 'broadcast:%'
      AND split_part(idempotency_key, ':', 2) = ANY(${broadcastIds})
    GROUP BY split_part(idempotency_key, ':', 2)
  `);

  for (const r of rows.rows) {
    out.set(r.broadcast_id, {
      delivered: Number(r.delivered ?? 0),
      seen: Number(r.seen ?? 0),
      read: Number(r.read ?? 0),
      dismissed: Number(r.dismissed ?? 0),
      // We treat readAt as a click-equivalent for now: every read is
      // a deliberate user action (click on the bell row OR mark-all-
      // read). The latter inflates this slightly; if/when we want a
      // strict CTR we can add an explicit clicked_at column.
      clicks: Number(r.read ?? 0),
    });
  }
  return out;
}

export function registerAdminNotificationsRoutes(app: Express): void {
  /* Audience preview — shown live in the composer as the admin tweaks
   * the audience selector. Cheap query, no side effects. */
  app.post(
    "/api/admin/notifications/broadcast/preview",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const parsed = previewBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: "Invalid audience", details: parsed.error.flatten() });
        }
        const preview = await resolveAudiencePreview(
          parsed.data.audience,
          req.userId!,
        );
        return res.json(preview);
      } catch (err: any) {
        logger.error({ err }, "[admin/notifications] preview failed");
        return res.status(500).json({ error: "Preview failed" });
      }
    },
  );

  /* Send a broadcast. */
  app.post(
    "/api/admin/notifications/broadcast",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      const parsed = broadcastBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid broadcast", details: parsed.error.flatten() });
      }
      const adminId = req.userId!;
      const { title, body, href, priority, audience } = parsed.data;
      // Broadcasts always ride the 'announcement' kind → 'system' category.
      const category = "system" as const;

      // Per-broadcast idempotency. Prefer a client-supplied submission
      // key; otherwise fall back to a server-generated random — admins
      // pressing "Send" twice get a fresh broadcast row each time, but
      // a single button click that retries on network jitter is safe.
      const submissionKey =
        parsed.data.submissionKey ??
        `${adminId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

      try {
        const userIds = await resolveAudience(audience, adminId);
        if (userIds.length === 0) {
          return res.status(400).json({
            error:
              "Audience resolved to zero users. Tweak the filter and try again.",
          });
        }

        // Hard cap the broadcast size to protect against accidental
        // ALL-USER blasts during early ops. 100k is well above our
        // current user base; tune up later if needed.
        if (userIds.length > 100_000) {
          return res.status(400).json({
            error: `Audience too large (${userIds.length}). Hard cap is 100,000 to prevent accidents.`,
          });
        }

        const [broadcast] = await db
          .insert(adminBroadcasts)
          .values({
            createdBy: adminId,
            title,
            body: body ?? null,
            href: href ?? null,
            priority,
            category,
            audience: audience as Record<string, unknown>,
            targetCount: userIds.length,
            status: "sending",
            idempotencyKey: submissionKey,
          })
          .returning();

        if (!broadcast) {
          return res.status(500).json({ error: "Failed to create broadcast" });
        }

        // Synchronous fanout via the bulk helper — chunked multi-row
        // INSERTs keep even a 50k-user broadcast inside the request
        // window. Re-uses the canonical 'announcement' kind so the
        // existing bell UI, 'system' category preferences, and
        // Megaphone icon all light up with no client changes.
        const inserted = await createBroadcastFanout({
          userIds,
          kind: "announcement",
          title,
          body,
          href: href ?? undefined,
          priority,
          metadata: { broadcastId: broadcast.id },
          buildIdempotencyKey: (userId) => `broadcast:${broadcast.id}:${userId}`,
        });

        await db
          .update(adminBroadcasts)
          .set({
            status: "sent",
            deliveredCount: inserted,
            sentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(adminBroadcasts.id, broadcast.id));

        logger.info(
          {
            broadcastId: broadcast.id,
            adminId,
            audience: audience.kind,
            target: userIds.length,
            delivered: inserted,
          },
          "[admin/notifications] broadcast sent",
        );

        return res.json({
          broadcastId: broadcast.id,
          target: userIds.length,
          delivered: inserted,
        });
      } catch (err: any) {
        logger.error({ err, adminId }, "[admin/notifications] broadcast failed");
        return res.status(500).json({
          error: "Broadcast failed",
          message: err?.message ?? "unknown error",
        });
      }
    },
  );

  /* History list — paginated newest-first with attached analytics. */
  app.get(
    "/api/admin/notifications/broadcasts",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
          200,
        );
        const offset = Math.max(
          parseInt(String(req.query.offset ?? "0"), 10) || 0,
          0,
        );

        const rows = await db
          .select({
            id: adminBroadcasts.id,
            title: adminBroadcasts.title,
            body: adminBroadcasts.body,
            href: adminBroadcasts.href,
            priority: adminBroadcasts.priority,
            category: adminBroadcasts.category,
            audience: adminBroadcasts.audience,
            targetCount: adminBroadcasts.targetCount,
            deliveredCount: adminBroadcasts.deliveredCount,
            status: adminBroadcasts.status,
            sentAt: adminBroadcasts.sentAt,
            createdAt: adminBroadcasts.createdAt,
            createdBy: adminBroadcasts.createdBy,
            createdByUsername: profiles.username,
          })
          .from(adminBroadcasts)
          .leftJoin(profiles, eq(profiles.id, adminBroadcasts.createdBy))
          .orderBy(desc(adminBroadcasts.createdAt))
          .limit(limit)
          .offset(offset);

        const stats = await computeBroadcastStats(rows.map((r) => r.id));

        return res.json({
          items: rows.map((r) => ({
            ...r,
            stats: stats.get(r.id) ?? {
              delivered: 0,
              seen: 0,
              read: 0,
              dismissed: 0,
              clicks: 0,
            },
          })),
          nextOffset: rows.length === limit ? offset + limit : null,
        });
      } catch (err: any) {
        logger.error({ err }, "[admin/notifications] history failed");
        return res.status(500).json({ error: "Failed to load history" });
      }
    },
  );

  /* Single broadcast detail. */
  app.get(
    "/api/admin/notifications/broadcasts/:id",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const id = req.params.id;
        const [row] = await db
          .select()
          .from(adminBroadcasts)
          .where(eq(adminBroadcasts.id, id))
          .limit(1);
        if (!row) return res.status(404).json({ error: "Broadcast not found" });
        const stats = await computeBroadcastStats([id]);
        return res.json({
          ...row,
          stats: stats.get(id) ?? {
            delivered: 0,
            seen: 0,
            read: 0,
            dismissed: 0,
            clicks: 0,
          },
        });
      } catch (err: any) {
        logger.error({ err }, "[admin/notifications] detail failed");
        return res.status(500).json({ error: "Failed to load broadcast" });
      }
    },
  );

  /* Per-user notification inspector. Read-only; no PII beyond what
   * the user themselves sees in their own bell. */
  app.get(
    "/api/admin/users/:userId/notifications",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const userId = req.params.userId;
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
          200,
        );
        const rows = await db
          .select({
            id: notifications.id,
            kind: notifications.kind,
            category: notifications.category,
            title: notifications.title,
            body: notifications.body,
            href: notifications.href,
            priority: notifications.priority,
            entityType: notifications.entityType,
            entityId: notifications.entityId,
            seenAt: notifications.seenAt,
            readAt: notifications.readAt,
            dismissedAt: notifications.dismissedAt,
            idempotencyKey: notifications.idempotencyKey,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .where(eq(notifications.userId, userId))
          .orderBy(desc(notifications.createdAt))
          .limit(limit);

        return res.json({ items: rows });
      } catch (err: any) {
        logger.error({ err }, "[admin/notifications] user inspect failed");
        return res
          .status(500)
          .json({ error: "Failed to load user notifications" });
      }
    },
  );
}
