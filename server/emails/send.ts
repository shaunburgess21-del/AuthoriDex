/**
 * The one function every email send in the codebase goes through.
 *
 * Wraps the Resend SDK with:
 *   - consistent logging
 *   - normalized error handling
 *   - optional idempotency (prevents duplicate sends on retries)
 *   - a dev-mode dry run (EMAIL_DRY_RUN=true logs instead of sending)
 *
 * Callers pass a React template component and props; this module
 * handles rendering, sender selection, and delivery.
 *
 * Usage:
 *   import { sendEmail } from "./send";
 *   import { VerifyEmail } from "./templates/auth/VerifyEmail";
 *
 *   await sendEmail({
 *     to: "user@example.com",
 *     subject: "Your VoxDex code: 428913",
 *     category: "auth",
 *     template: <VerifyEmail code="428913" />,
 *     idempotencyKey: `verify:${userId}:${attemptId}`,
 *   });
 */

import * as React from "react";

import { resend, senders, replyTo, type EmailCategory } from "./client";

// ---- Types ----------------------------------------------------------------

export interface SendEmailArgs {
  /** Recipient email address. */
  to: string;

  /** Subject line. Keep under ~50 chars for mobile clients. */
  subject: string;

  /** Which sender identity + domain reputation bucket to use. */
  category: EmailCategory;

  /** A React element — the rendered template. */
  template: React.ReactElement;

  /**
   * Optional dedupe key. If the same key was used within the last
   * 24 hours, the send is skipped and a `skipped` result returned.
   *
   * Use whenever a send could be triggered twice by the same logical
   * event (cron retry, webhook redelivery, user double-click, etc.).
   */
  idempotencyKey?: string;

  /** Optional plain-text fallback. If omitted, Resend generates one. */
  text?: string;

  /**
   * Optional metadata tags. Stored with the Resend send record and
   * visible in the Resend dashboard — useful for filtering by
   * campaign, user segment, etc.
   */
  tags?: Array<{ name: string; value: string }>;
}

export type SendEmailResult =
  | { ok: true; id: string; skipped?: false }
  | { ok: true; id: null; skipped: true; reason: "dry_run" | "duplicate" }
  | { ok: false; error: string };

// ---- In-memory idempotency cache -----------------------------------------
//
// Simple Map-based dedupe for now. Survives process lifetime but not
// restarts, which is fine for short-window dedupe (seconds to minutes).
// If we need durable cross-restart dedupe later (e.g. for the Weekly
// Wrap cron that runs across deploys), we'll promote this to a DB
// table. Not over-engineering until we need it.

const seenKeys = new Map<string, number>();
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function checkAndRecordIdempotency(key: string): "fresh" | "duplicate" {
  const now = Date.now();

  // Periodic cleanup of expired keys — cheap, runs only on check.
  for (const [k, ts] of seenKeys) {
    if (now - ts > IDEMPOTENCY_WINDOW_MS) {
      seenKeys.delete(k);
    }
  }

  const seenAt = seenKeys.get(key);
  if (seenAt !== undefined && now - seenAt < IDEMPOTENCY_WINDOW_MS) {
    return "duplicate";
  }

  seenKeys.set(key, now);
  return "fresh";
}

// ---- Send -----------------------------------------------------------------

const isDryRun = process.env.EMAIL_DRY_RUN === "true";

export async function sendEmail(
  args: SendEmailArgs,
): Promise<SendEmailResult> {
  const { to, subject, category, template, idempotencyKey, text, tags } =
    args;

  // ---- Idempotency check ----
  if (idempotencyKey) {
    const status = checkAndRecordIdempotency(idempotencyKey);
    if (status === "duplicate") {
      console.log(
        `[emails] Skipping duplicate send. key=${idempotencyKey} to=${to}`,
      );
      return { ok: true, id: null, skipped: true, reason: "duplicate" };
    }
  }

  // ---- Dry run (dev convenience) ----
  if (isDryRun) {
    console.log(
      `[emails] DRY RUN — would send: ` +
        `to=${to} subject="${subject}" category=${category}`,
    );
    return { ok: true, id: null, skipped: true, reason: "dry_run" };
  }

  // ---- Actual send ----
  try {
    const { data, error } = await resend.emails.send({
      from: senders[category],
      to,
      subject,
      react: template,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    });

    if (error) {
      console.error(
        `[emails] Send failed. to=${to} subject="${subject}" ` +
          `error=${error.name}: ${error.message}`,
      );
      return { ok: false, error: `${error.name}: ${error.message}` };
    }

    if (!data?.id) {
      // Shouldn't happen per Resend's contract, but guard anyway.
      console.error(
        `[emails] Send returned no id. to=${to} subject="${subject}"`,
      );
      return { ok: false, error: "Resend returned no message id" };
    }

    console.log(
      `[emails] Sent. id=${data.id} to=${to} subject="${subject}" ` +
        `category=${category}`,
    );
    return { ok: true, id: data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[emails] Send threw. to=${to} subject="${subject}" ` +
        `error=${message}`,
    );
    return { ok: false, error: message };
  }
}