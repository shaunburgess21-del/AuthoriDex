/**
 * The one function every email send in the codebase goes through.
 *
 * Wraps the Resend SDK with:
 *   - marketing preference + unsubscribe enforcement
 *   - DB-backed idempotency (survives deploys / cron retries)
 *   - consistent logging
 *   - normalized error handling
 *   - a dev-mode dry run (EMAIL_DRY_RUN=true logs instead of sending)
 *
 * Usage:
 *   import { sendEmail } from "./send";
 *   import { VerifyEmail } from "./templates/auth/VerifyEmail";
 *
 *   await sendEmail({
 *     to: "user@example.com",
 *     subject: "Your VoxDex code: 428913",
 *     category: "auth",
 *     templateName: "verify",
 *     template: <VerifyEmail code="428913" flow="signup" />,
 *     userId: profileId,
 *     idempotencyKey: `auth:signup:${tokenHash}`,
 *   });
 */

import * as React from "react";
import { eq } from "drizzle-orm";

import { emailSendLog } from "@shared/schema";
import { db } from "../db";
import { logger } from "../log";
import { resend, senders, replyTo, type EmailCategory } from "./client";
import {
  evaluateMarketingGate,
  logEmailSuppressed,
  type EmailPreferenceKey,
} from "./marketing-gate";

// ---- Types ----------------------------------------------------------------

export type { EmailPreferenceKey };

export interface SendEmailArgs {
  /** Recipient email address. */
  to: string;

  /** Subject line. Keep under ~50 chars for mobile clients. */
  subject: string;

  /** Which sender identity + domain reputation bucket to use. */
  category: EmailCategory;

  /** Short template id stored in email_send_log (e.g. "welcome", "verify"). */
  templateName: string;

  /** A React element — the rendered template. */
  template: React.ReactElement;

  /**
   * Profile id for prefs / unsubscribe / send log. Required for engagement;
   * recommended for lifecycle user-facing mail. Omit for internal recipients
   * when combined with skipMarketingChecks.
   */
  userId?: string;

  /**
   * Required for category "engagement" — maps to notification_preferences
   * *Email columns.
   */
  preferenceKey?: EmailPreferenceKey;

  /**
   * When true, skip email_unsubscribe_state and per-category checks.
   * Use for contact-form mail to team@voxdex.com.
   */
  skipMarketingChecks?: boolean;

  /**
   * Optional dedupe key. INSERT into email_send_log ON CONFLICT skips Resend.
   */
  idempotencyKey?: string;

  /** Optional plain-text fallback. If omitted, Resend generates one. */
  text?: string;

  tags?: Array<{ name: string; value: string }>;

  replyTo?: string;
}

export type SendEmailSkipReason = "dry_run" | "duplicate" | "suppressed";

export type SendEmailResult =
  | { ok: true; id: string; skipped?: false }
  | { ok: true; id: null; skipped: true; reason: SendEmailSkipReason }
  | { ok: false; error: string };

const isDryRun = process.env.EMAIL_DRY_RUN === "true";

// TODO: monthly prune job for email_send_log rows older than 90 days.

async function claimIdempotencyKey(args: {
  idempotencyKey: string;
  userId?: string;
  category: EmailCategory;
  templateName: string;
}): Promise<"claimed" | "duplicate" | "unavailable"> {
  try {
    const [inserted] = await db
      .insert(emailSendLog)
      .values({
        idempotencyKey: args.idempotencyKey,
        userId: args.userId ?? null,
        category: args.category,
        template: args.templateName,
      })
      .onConflictDoNothing({ target: emailSendLog.idempotencyKey })
      .returning({ idempotencyKey: emailSendLog.idempotencyKey });

    return inserted ? "claimed" : "duplicate";
  } catch (err) {
    logger.warn(
      { err, idempotencyKey: args.idempotencyKey },
      "[emails] Idempotency claim failed; proceeding without dedupe",
    );
    return "unavailable";
  }
}

async function releaseIdempotencyKey(idempotencyKey: string): Promise<void> {
  try {
    await db
      .delete(emailSendLog)
      .where(eq(emailSendLog.idempotencyKey, idempotencyKey));
  } catch (err) {
    logger.warn(
      { err, idempotencyKey },
      "[emails] Failed to release idempotency key after send failure",
    );
  }
}

export async function sendEmail(
  args: SendEmailArgs,
): Promise<SendEmailResult> {
  const {
    to,
    subject,
    category,
    templateName,
    template,
    userId,
    preferenceKey,
    skipMarketingChecks,
    idempotencyKey,
    text,
    tags,
    replyTo: replyToOverride,
  } = args;
  const effectiveReplyTo = replyToOverride ?? replyTo;

  if (category === "engagement" && !userId) {
    logEmailSuppressed({
      category,
      preferenceKey,
      reason: "missing_user_id",
      to,
      templateName,
    });
    return { ok: true, id: null, skipped: true, reason: "suppressed" };
  }

  if (category === "engagement" && !preferenceKey) {
    logEmailSuppressed({
      userId,
      category,
      reason: "missing_preference_key",
      to,
      templateName,
    });
    return { ok: true, id: null, skipped: true, reason: "suppressed" };
  }

  if (isDryRun) {
    logger.info(
      { to, subject, category, templateName },
      "[emails] DRY RUN — would send",
    );
    return { ok: true, id: null, skipped: true, reason: "dry_run" };
  }

  const gate = await evaluateMarketingGate({
    category,
    userId,
    preferenceKey,
    skipMarketingChecks,
  });

  if (!gate.allowed) {
    logEmailSuppressed({
      userId,
      category,
      preferenceKey,
      reason: gate.reason,
      to,
      templateName,
    });
    return { ok: true, id: null, skipped: true, reason: "suppressed" };
  }

  let claimedIdempotencyKey: string | undefined;
  if (idempotencyKey) {
    const claim = await claimIdempotencyKey({
      idempotencyKey,
      userId,
      category,
      templateName,
    });
    if (claim === "duplicate") {
      logger.info(
        { idempotencyKey, to, templateName },
        "[emails] Skipping duplicate send (DB idempotency)",
      );
      return { ok: true, id: null, skipped: true, reason: "duplicate" };
    }
    if (claim === "claimed") {
      claimedIdempotencyKey = idempotencyKey;
    }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: senders[category],
      to,
      subject,
      react: template,
      ...(text ? { text } : {}),
      ...(effectiveReplyTo ? { replyTo: effectiveReplyTo } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    });

    if (error) {
      if (claimedIdempotencyKey) {
        await releaseIdempotencyKey(claimedIdempotencyKey);
      }
      logger.error(
        { to, subject, category, templateName, error: error.message },
        "[emails] Send failed",
      );
      return { ok: false, error: `${error.name}: ${error.message}` };
    }

    if (!data?.id) {
      if (claimedIdempotencyKey) {
        await releaseIdempotencyKey(claimedIdempotencyKey);
      }
      logger.error({ to, subject, category }, "[emails] Send returned no id");
      return { ok: false, error: "Resend returned no message id" };
    }

    logger.info(
      { id: data.id, to, subject, category, templateName, userId },
      "[emails] Sent",
    );
    return { ok: true, id: data.id };
  } catch (err) {
    if (claimedIdempotencyKey) {
      await releaseIdempotencyKey(claimedIdempotencyKey);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { to, subject, category, templateName, error: message },
      "[emails] Send threw",
    );
    return { ok: false, error: message };
  }
}
