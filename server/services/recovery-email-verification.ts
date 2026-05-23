/**
 * Recovery-email verification (Account settings).
 *
 * Sends a 6-digit OTP to profiles.recovery_email (not the login email).
 * Codes are stored hashed on the profile row; confirm flips
 * recovery_email_verified.
 */

import * as React from "react";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";

import { profiles } from "@shared/schema";
import { db } from "../db";
import { sendEmail } from "../emails/send";
import { VerifyEmail } from "../emails/templates/auth/VerifyEmail";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

const lastSentAtByUser = new Map<string, number>();
const verifyAttemptsByUser = new Map<string, number>();

function getSigningSecret(): string | null {
  return (
    process.env.APP_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    null
  );
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashRecoveryEmailCode(
  userId: string,
  email: string,
  code: string,
): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  const normalizedEmail = email.trim().toLowerCase();
  return createHmac("sha256", secret)
    .update(`${userId}:${normalizedEmail}:${code}`)
    .digest("hex");
}

function codesMatch(storedHash: string, candidateHash: string): boolean {
  const a = Buffer.from(storedHash, "utf8");
  const b = Buffer.from(candidateHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hourBucket(): number {
  return Math.floor(Date.now() / (60 * 60 * 1000));
}

function resendIdempotencyBucket(): number {
  return Math.floor(Date.now() / RESEND_COOLDOWN_MS);
}

function buildIdempotencyKey(
  userId: string,
  email: string,
  purpose: "initial" | "resend",
): string {
  const bucket =
    purpose === "resend" ? resendIdempotencyBucket() : hourBucket();
  return `recovery-email:${purpose}:${userId}:${email}:${bucket}`;
}

function resetVerifyAttempts(userId: string): void {
  verifyAttemptsByUser.delete(userId);
}

function incrementVerifyAttempts(userId: string): number {
  const next = (verifyAttemptsByUser.get(userId) ?? 0) + 1;
  verifyAttemptsByUser.set(userId, next);
  return next;
}

export async function clearRecoveryEmailVerification(
  userId: string,
): Promise<void> {
  lastSentAtByUser.delete(userId);
  resetVerifyAttempts(userId);
  await db
    .update(profiles)
    .set({
      recoveryEmailVerifyCodeHash: null,
      recoveryEmailVerifyExpiresAt: null,
    })
    .where(eq(profiles.id, userId));
}

export type SendRecoveryEmailResult =
  | { ok: true; sent: true }
  | { ok: true; sent: false; reason: "duplicate" | "dry_run" }
  | { ok: false; error: string };

export async function sendRecoveryEmailVerification(
  userId: string,
  recoveryEmail: string,
  options?: { purpose?: "initial" | "resend" },
): Promise<SendRecoveryEmailResult> {
  const secret = getSigningSecret();
  if (!secret) {
    return { ok: false, error: "server_misconfigured" };
  }

  const purpose = options?.purpose ?? "initial";
  const normalizedEmail = recoveryEmail.trim().toLowerCase();
  const code = generateOtpCode();
  const codeHash = hashRecoveryEmailCode(userId, normalizedEmail, code);
  if (!codeHash) {
    return { ok: false, error: "server_misconfigured" };
  }

  const idempotencyKey = buildIdempotencyKey(
    userId,
    normalizedEmail,
    purpose,
  );
  const result = await sendEmail({
    to: normalizedEmail,
    subject: `Your VoxDex recovery email code: ${code}`,
    category: "auth",
    templateName: "verify",
    template: React.createElement(VerifyEmail, {
      code,
      flow: "recovery_email",
    }),
    userId,
    idempotencyKey,
    tags: [
      { name: "source", value: "recovery-email-verification" },
      { name: "action", value: "recovery_email" },
      { name: "purpose", value: purpose },
    ],
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  if (result.skipped && result.reason === "duplicate") {
    return { ok: true, sent: false, reason: "duplicate" };
  }

  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db
    .update(profiles)
    .set({
      recoveryEmailVerifyCodeHash: codeHash,
      recoveryEmailVerifyExpiresAt: expiresAt,
    })
    .where(eq(profiles.id, userId));

  resetVerifyAttempts(userId);
  lastSentAtByUser.set(userId, Date.now());

  return { ok: true, sent: true };
}

export type ConfirmRecoveryEmailResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "no_pending_verification"
        | "expired"
        | "invalid_code"
        | "too_many_attempts"
        | "no_recovery_email"
        | "server_misconfigured";
    };

export async function confirmRecoveryEmailCode(
  userId: string,
  rawCode: string,
): Promise<ConfirmRecoveryEmailResult> {
  const code = rawCode.trim().replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "invalid_code" };
  }

  const rows = await db
    .select({
      recoveryEmail: profiles.recoveryEmail,
      recoveryEmailVerified: profiles.recoveryEmailVerified,
      codeHash: profiles.recoveryEmailVerifyCodeHash,
      expiresAt: profiles.recoveryEmailVerifyExpiresAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row?.recoveryEmail) {
    return { ok: false, error: "no_recovery_email" };
  }
  if (row.recoveryEmailVerified) {
    return { ok: true };
  }
  if (!row.codeHash || !row.expiresAt) {
    return { ok: false, error: "no_pending_verification" };
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired" };
  }

  const attempts = verifyAttemptsByUser.get(userId) ?? 0;
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, error: "too_many_attempts" };
  }

  const candidateHash = hashRecoveryEmailCode(
    userId,
    row.recoveryEmail,
    code,
  );
  if (!candidateHash) {
    return { ok: false, error: "server_misconfigured" };
  }

  if (!codesMatch(row.codeHash, candidateHash)) {
    incrementVerifyAttempts(userId);
    return { ok: false, error: "invalid_code" };
  }

  await db
    .update(profiles)
    .set({
      recoveryEmailVerified: true,
      recoveryEmailVerifyCodeHash: null,
      recoveryEmailVerifyExpiresAt: null,
    })
    .where(eq(profiles.id, userId));

  resetVerifyAttempts(userId);
  return { ok: true };
}

export type ResendRecoveryEmailResult =
  | { ok: true; sent: true }
  | {
      ok: true;
      sent: false;
      reason:
        | "cooldown"
        | "duplicate"
        | "already_verified"
        | "no_recovery_email";
    }
  | { ok: false; error: string };

export async function resendRecoveryEmailVerification(
  userId: string,
): Promise<ResendRecoveryEmailResult> {
  const rows = await db
    .select({
      recoveryEmail: profiles.recoveryEmail,
      recoveryEmailVerified: profiles.recoveryEmailVerified,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row?.recoveryEmail) {
    return { ok: true, sent: false, reason: "no_recovery_email" };
  }
  if (row.recoveryEmailVerified) {
    return { ok: true, sent: false, reason: "already_verified" };
  }

  const lastSent = lastSentAtByUser.get(userId) ?? 0;
  if (Date.now() - lastSent < RESEND_COOLDOWN_MS) {
    return { ok: true, sent: false, reason: "cooldown" };
  }

  const sendResult = await sendRecoveryEmailVerification(
    userId,
    row.recoveryEmail,
    { purpose: "resend" },
  );
  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }
  if (sendResult.sent) {
    return { ok: true, sent: true };
  }
  if (sendResult.reason === "duplicate") {
    return { ok: true, sent: false, reason: "duplicate" };
  }
  return { ok: true, sent: false, reason: "cooldown" };
}

/** Strip OTP hash/expiry before returning profile to the client. */
export function stripRecoveryEmailVerificationFields<
  T extends Record<string, unknown>,
>(profile: T): Omit<T, "recoveryEmailVerifyCodeHash" | "recoveryEmailVerifyExpiresAt"> {
  const {
    recoveryEmailVerifyCodeHash: _hash,
    recoveryEmailVerifyExpiresAt: _exp,
    ...rest
  } = profile;
  return rest;
}
