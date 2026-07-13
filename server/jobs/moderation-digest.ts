/**
 * Daily content-moderation digest.
 *
 * Surfaces pending review-queue items and recent user comment reports to
 * OPS_ALERT_EMAILS via sendOpsAlert. Read-only — never mutates content.
 *
 * Scheduling: once daily (see server/index.ts) + POST /api/cron/moderation-digest.
 */

import { desc, eq, gte, sql } from "drizzle-orm";

import { db, withDbAdvisoryLock } from "../db";
import { commentReports, moderationEvents } from "@shared/schema";
import { log } from "../log";
import {
  getAdminBaseUrl,
  sendOpsAlert,
  type OpsAlert,
  type OpsAlertItem,
  type OpsAlertSection,
} from "../services/ops-alerts";

const MODERATION_DIGEST_LOCK_KEY = 5_220;

export interface ModerationDigestResult {
  pendingQueue: number;
  autoHidePending: number;
  reviewPending: number;
  reports24h: number;
  alert: { delivered: number; skipped: number; failed: number };
}

function adminModerationUrl(tab: "queue" | "reports" | "comments" = "queue"): string {
  return `${getAdminBaseUrl()}/admin?section=moderation&tab=${tab}`;
}

function dateKeyUtc(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function runModerationDigestOnce(): Promise<ModerationDigestResult> {
  const pending = await db
    .select({
      id: moderationEvents.id,
      contentType: moderationEvents.contentType,
      decision: moderationEvents.decision,
      sampleText: moderationEvents.sampleText,
      matchedCategories: moderationEvents.matchedCategories,
      createdAt: moderationEvents.createdAt,
    })
    .from(moderationEvents)
    .where(eq(moderationEvents.status, "pending"))
    .orderBy(desc(moderationEvents.createdAt))
    .limit(50);

  const autoHidePending = pending.filter((p) => p.decision === "auto_hide").length;
  const reviewPending = pending.filter((p) => p.decision === "review").length;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [reportCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentReports)
    .where(gte(commentReports.createdAt, since));
  const reports24h = reportCountRow?.count ?? 0;

  const queueItems: OpsAlertItem[] = pending.slice(0, 15).map((row) => {
    const cats = Array.isArray(row.matchedCategories)
      ? row.matchedCategories.slice(0, 3).join(", ")
      : "";
    const snippet = (row.sampleText || "").slice(0, 80);
    return {
      text: `${row.decision} · ${row.contentType}`,
      detail: `${cats ? `${cats} — ` : ""}${snippet || "(no sample)"}`,
      url: adminModerationUrl("queue"),
    };
  });

  const sections: OpsAlertSection[] = [
    {
      emoji: "🛡️",
      heading: "Pending review queue",
      items: queueItems,
      emptyText: "Queue is clear.",
    },
  ];

  if (reports24h > 0) {
    sections.push({
      emoji: "🚩",
      heading: "User comment reports (last 24h)",
      items: [
        {
          text: `${reports24h} report${reports24h === 1 ? "" : "s"}`,
          detail: "Open the Reports tab to review",
          url: adminModerationUrl("reports"),
        },
      ],
    });
  }

  const severity =
    autoHidePending > 0 || reports24h >= 5
      ? "warning"
      : "info";

  const summary =
    pending.length === 0 && reports24h === 0
      ? "No pending moderation items and no new reports in the last 24h."
      : `${pending.length} pending queue item(s) (${autoHidePending} auto-hide, ${reviewPending} review); ${reports24h} report(s) in last 24h.`;

  const alert: OpsAlert = {
    kind: "moderation_digest",
    severity,
    title: "Content moderation daily digest",
    summary,
    sections,
    ctaUrl: adminModerationUrl("queue"),
    ctaLabel: "Open Moderation queue",
    idempotencyKeyBase: `moderation_digest:${dateKeyUtc()}`,
  };

  const dispatch = await sendOpsAlert(alert);

  return {
    pendingQueue: pending.length,
    autoHidePending,
    reviewPending,
    reports24h,
    alert: {
      delivered: dispatch.delivered,
      skipped: dispatch.skipped,
      failed: dispatch.failed,
    },
  };
}

export async function runModerationDigest(): Promise<ModerationDigestResult> {
  const locked = await withDbAdvisoryLock(
    MODERATION_DIGEST_LOCK_KEY,
    "ModerationDigest",
    runModerationDigestOnce,
  );
  if (!locked.acquired || !locked.result) {
    if (!locked.acquired) {
      log("[ModerationDigest] Skipping run; another instance holds the lock");
    }
    return {
      pendingQueue: 0,
      autoHidePending: 0,
      reviewPending: 0,
      reports24h: 0,
      alert: { delivered: 0, skipped: 1, failed: 0 },
    };
  }
  return locked.result;
}
