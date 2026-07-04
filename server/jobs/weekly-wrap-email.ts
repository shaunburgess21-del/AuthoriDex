/**
 * Sunday 18:30–19:00 UTC — Weekly Wrap engagement email for active predictors.
 */

import * as React from "react";
import { logger } from "../log";
import { sendEmail } from "../emails/send";
import {
  WeeklyWrapEmail,
  weeklyWrapSubject,
} from "../emails/templates/engagement/WeeklyWrapEmail";
import { buildUnsubscribeUrl } from "../emails/unsubscribe";
import { getSupabaseAuthEmail } from "../services/supabase-auth-email";
import {
  getWeeklyDigestStatsBatch,
  listActiveDigestUserIds,
} from "./weekly-digest-stats";
import { isoYearWeek, isWeeklyWrapFireWindow } from "./weekly-digest-utils";

const DEFAULT_BASE_URL = "https://voxdex.com";

export async function runWeeklyWrapEmail(): Promise<number> {
  if (!isWeeklyWrapFireWindow()) return 0;

  const isoWeek = isoYearWeek(new Date());
  const activeUserIds = await listActiveDigestUserIds();
  if (activeUserIds.length === 0) return 0;

  const baseUrl =
    process.env.PUBLIC_APP_URL || process.env.APP_URL || DEFAULT_BASE_URL;

  let attempted = 0;
  let sent = 0;
  let suppressed = 0;
  let duplicate = 0;
  let failed = 0;
  let skippedNoStats = 0;

  // One batched roll-up for the whole cohort (~5 queries total). The
  // per-user work below is just the email lookup + send.
  const statsByUser = await getWeeklyDigestStatsBatch(activeUserIds, { isoWeek });

  for (const userId of activeUserIds) {
    attempted += 1;
    try {
      const stats = statsByUser.get(userId);
      if (!stats || (stats.wins === 0 && stats.losses === 0)) {
        skippedNoStats += 1;
        continue;
      }

      const to = await getSupabaseAuthEmail(userId);
      if (!to) {
        failed += 1;
        logger.warn(
          { event: "email.weekly_wrap.failed", userId, reason: "no_email" },
          "[weekly-wrap] No auth email for user",
        );
        continue;
      }

      const unsubscribeUrl = buildUnsubscribeUrl(userId, baseUrl);
      const result = await sendEmail({
        to,
        subject: weeklyWrapSubject(stats),
        category: "engagement",
        templateName: "weekly_wrap",
        userId,
        preferenceKey: "predictionsEmail",
        template: React.createElement(WeeklyWrapEmail, {
          stats,
          baseUrl: baseUrl.replace(/\/+$/, ""),
          unsubscribeUrl,
        }),
        idempotencyKey: `weekly-wrap-email:${userId}:${isoWeek}`,
        tags: [
          { name: "category", value: "engagement" },
          { name: "template", value: "weekly_wrap" },
        ],
      });

      if (result.ok && result.skipped) {
        if (result.reason === "suppressed") suppressed += 1;
        else if (result.reason === "duplicate") duplicate += 1;
        logger.info(
          {
            event: "email.weekly_wrap.skipped",
            userId,
            reason: result.reason,
            isoWeek,
          },
          "[weekly-wrap] Send skipped",
        );
      } else if (result.ok) {
        sent += 1;
        logger.info(
          { event: "email.weekly_wrap.sent", userId, isoWeek, resendId: result.id },
          "[weekly-wrap] Sent",
        );
      } else {
        failed += 1;
        logger.error(
          { event: "email.weekly_wrap.failed", userId, error: result.error },
          "[weekly-wrap] Send failed",
        );
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { event: "email.weekly_wrap.failed", userId, error: message },
        "[weekly-wrap] User processing failed",
      );
    }
  }

  logger.info(
    {
      event: "email.weekly_wrap.complete",
      isoWeek,
      attempted,
      sent,
      suppressed,
      duplicate,
      failed,
      skippedNoStats,
    },
    "[weekly-wrap] Run complete",
  );

  return sent;
}
