/**
 * Supabase Send Email Auth Hook handler.
 *
 * Supabase calls this endpoint whenever it needs to send an auth
 * email (signup verification, magic link, password reset, invite,
 * email change, reauthentication). This replaces Supabase's built-in
 * email templates entirely — if this endpoint is broken, signups
 * break. Treat accordingly.
 *
 * Security:
 *   - Signature verification via standardwebhooks is mandatory.
 *     Without it, anyone who discovers the URL can spam our
 *     Resend quota and harass user email addresses.
 *   - We operate on the raw request body, not parsed JSON, because
 *     signature verification checks exact bytes.
 *
 * Wiring:
 *   - Route is registered in server/routes.ts (search "auth-hook").
 *   - Config lives in two env vars: SEND_EMAIL_HOOK_SECRET (from
 *     Supabase dashboard) and RESEND_API_KEY (already configured).
 */

import * as React from "react";
import type { Request, Response } from "express";
import { Webhook } from "standardwebhooks";

import { sendEmail } from "../send";
import { VerifyEmail, type VerifyEmailFlow } from "../templates/auth/VerifyEmail";

// ---- Types ----------------------------------------------------------------
//
// Payload shape is documented at:
// https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook

interface SupabaseAuthHookPayload {
  user: {
    id: string;
    email: string;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type:
      | "signup"
      | "recovery"
      | "magiclink"
      | "invite"
      | "reauthentication"
      | "email_change";
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

function sanitizeOtpToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  const sixDigits = trimmed.match(/\d{6}/)?.[0];
  if (sixDigits) {
    return sixDigits;
  }
  return trimmed.replace(/<end>/gi, "").trim();
}

function resolveEmailChangeToken(email_data: SupabaseAuthHookPayload["email_data"]): string {
  const primary = sanitizeOtpToken(email_data.token);
  if (primary) return primary;
  if (email_data.token_new) {
    return sanitizeOtpToken(email_data.token_new);
  }
  return primary;
}

function resolveEmailChangeIdempotencyKey(
  email_data: SupabaseAuthHookPayload["email_data"],
): string {
  // Supabase fires twice (old + new inbox). Prefer the new-address hash
  // when present so the two messages never share one idempotency key.
  const hashPart =
    email_data.token_hash_new && email_data.token_new
      ? email_data.token_hash_new
      : email_data.token_hash;
  return `auth:email_change:${hashPart}`;
}

// ---- Webhook verifier -----------------------------------------------------

function getWebhookVerifier(): Webhook {
  const raw = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!raw) {
    throw new Error(
      "[auth-hook] SEND_EMAIL_HOOK_SECRET is not set. Generate one in " +
        "Supabase dashboard → Authentication → Auth Hooks → Send Email.",
    );
  }

  const secret = raw.replace("v1,whsec_", "");
  return new Webhook(secret);
}

async function sendAuthOtpEmail(args: {
  user: SupabaseAuthHookPayload["user"];
  subject: string;
  flow: VerifyEmailFlow;
  code: string;
  idempotencyKey: string;
  action: string;
  /**
   * Omit on signup — profiles row may not exist yet (FK on email_send_log).
   * Pass for magic link / recovery / email change when the account exists.
   */
  userId?: string;
}): Promise<void> {
  const result = await sendEmail({
    to: args.user.email,
    subject: args.subject,
    category: "auth",
    templateName: "verify",
    template: React.createElement(VerifyEmail, {
      code: args.code,
      flow: args.flow,
    }),
    userId: args.userId,
    idempotencyKey: args.idempotencyKey,
    tags: [
      { name: "source", value: "supabase-auth-hook" },
      { name: "action", value: args.action },
    ],
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  if (result.skipped) {
    console.log(
      `[auth-hook] Send skipped (${result.reason}). action=${args.action} to=${args.user.email}`,
    );
  }
}

function assertValidOtpCode(code: string, action: string): void {
  if (!code || !/^\d{6}$/.test(code)) {
    throw new Error(
      `[auth-hook] Invalid or missing OTP for action=${action} (expected 6 digits)`,
    );
  }
}

// ---- Route handler --------------------------------------------------------

export async function handleAuthHook(
  req: Request,
  res: Response,
): Promise<void> {
  if (!Buffer.isBuffer(req.body)) {
    console.error(
      "[auth-hook] Rejected: body is not a Buffer. " +
        "Check express.raw() middleware on this route.",
    );
    res.status(500).json({ error: { message: "Server misconfigured" } });
    return;
  }

  const rawBody = req.body.toString("utf8");
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v ?? "",
    ]),
  );

  let payload: SupabaseAuthHookPayload;
  try {
    const wh = getWebhookVerifier();
    payload = wh.verify(rawBody, headers) as SupabaseAuthHookPayload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[auth-hook] Signature verification failed: ${message}`);
    res.status(401).json({ error: { message: "Invalid signature" } });
    return;
  }

  const { user, email_data } = payload;
  const { token, token_hash, email_action_type } = email_data;

  console.log(
    `[auth-hook] Verified. action=${email_action_type} to=${user.email}`,
  );

  try {
    switch (email_action_type) {
      case "signup": {
        const cleanToken = sanitizeOtpToken(token);
        assertValidOtpCode(cleanToken, "signup");
        await sendAuthOtpEmail({
          user,
          subject: `Your VoxDex code: ${cleanToken}`,
          flow: "signup",
          code: cleanToken,
          idempotencyKey: `auth:signup:${token_hash}`,
          action: "signup",
        });
        break;
      }

      case "magiclink": {
        const cleanToken = sanitizeOtpToken(token);
        assertValidOtpCode(cleanToken, "magiclink");
        await sendAuthOtpEmail({
          user,
          subject: `Your VoxDex sign-in code: ${cleanToken}`,
          flow: "signup",
          code: cleanToken,
          idempotencyKey: `auth:magiclink:${token_hash}`,
          action: "magiclink",
        });
        break;
      }

      case "recovery": {
        const cleanToken = sanitizeOtpToken(token);
        assertValidOtpCode(cleanToken, "recovery");
        await sendAuthOtpEmail({
          user,
          subject: `Your VoxDex password reset code: ${cleanToken}`,
          flow: "recovery",
          code: cleanToken,
          idempotencyKey: `auth:recovery:${token_hash}`,
          action: "recovery",
          userId: user.id,
        });
        break;
      }

      case "email_change": {
        const cleanToken = resolveEmailChangeToken(email_data);
        assertValidOtpCode(cleanToken, "email_change");
        await sendAuthOtpEmail({
          user,
          subject: "Confirm your new VoxDex email",
          flow: "email_change",
          code: cleanToken,
          idempotencyKey: resolveEmailChangeIdempotencyKey(email_data),
          action: "email_change",
          userId: user.id,
        });
        break;
      }

      case "invite":
      case "reauthentication": {
        console.warn(
          `[auth-hook] Action '${email_action_type}' is not yet ` +
            `implemented. Acknowledging to prevent Supabase retries, ` +
            `but NO email was sent to ${user.email}.`,
        );
        break;
      }

      default: {
        console.error(
          `[auth-hook] Unknown email_action_type: ${email_action_type}`,
        );
        res.status(400).json({
          error: {
            message: `Unsupported action: ${email_action_type}`,
          },
        });
        return;
      }
    }

    res.status(200).json({});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[auth-hook] Email send failed. action=${email_action_type} ` +
        `to=${user.email} error=${message}`,
    );
    res.status(500).json({
      error: { message: "Email send failed", detail: message },
    });
  }
}
