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
import { VerifyEmail } from "../templates/auth/VerifyEmail";

// ---- Types ----------------------------------------------------------------
//
// Payload shape is documented at:
// https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook

interface SupabaseAuthHookPayload {
  user: {
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

// ---- Webhook verifier -----------------------------------------------------

function getWebhookVerifier(): Webhook {
  const raw = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!raw) {
    throw new Error(
      "[auth-hook] SEND_EMAIL_HOOK_SECRET is not set. Generate one in " +
        "Supabase dashboard → Authentication → Auth Hooks → Send Email.",
    );
  }

  // Supabase secrets are stored as `v1,whsec_<base64>`. The
  // standardwebhooks library wants just the <base64> part.
  const secret = raw.replace("v1,whsec_", "");
  return new Webhook(secret);
}

// ---- Route handler --------------------------------------------------------

export async function handleAuthHook(
  req: Request,
  res: Response,
): Promise<void> {
  // ---- 1. Verify signature ----
  //
  // req.body here is a Buffer because we register this route with
  // express.raw() middleware. If it's not a Buffer, the middleware
  // wasn't applied correctly.

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

  // ---- 2. Dispatch by action type ----

  const { user, email_data } = payload;
  const { token, token_hash, email_action_type } = email_data;

  console.log(
    `[auth-hook] Verified. action=${email_action_type} to=${user.email}`,
  );

  try {
    switch (email_action_type) {
      case "signup":
      case "magiclink": {
        const subject =
          email_action_type === "signup"
            ? `Your VoxDex code: ${formatCode(token)}`
            : `Your VoxDex sign-in code: ${formatCode(token)}`;

        const result = await sendEmail({
          to: user.email,
          subject,
          category: "auth",
          template: React.createElement(VerifyEmail, { code: token }),
          idempotencyKey: `auth:${email_action_type}:${token_hash}`,
          tags: [
            { name: "source", value: "supabase-auth-hook" },
            { name: "action", value: email_action_type },
          ],
        });

        if (!result.ok) {
          throw new Error(result.error);
        }
        break;
      }

      case "recovery": {
        // TODO: dedicated PasswordResetEmail template.
        const result = await sendEmail({
          to: user.email,
          subject: `Your VoxDex password reset code: ${formatCode(token)}`,
          category: "auth",
          template: React.createElement(VerifyEmail, { code: token }),
          idempotencyKey: `auth:recovery:${token_hash}`,
          tags: [
            { name: "source", value: "supabase-auth-hook" },
            { name: "action", value: "recovery" },
          ],
        });

        if (!result.ok) {
          throw new Error(result.error);
        }
        break;
      }

      case "invite":
      case "reauthentication":
      case "email_change": {
        // Stubs — acknowledge so Supabase doesn't retry, but don't
        // actually send. Implement when the features that trigger
        // them exist.
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

    // ---- 3. Success ----
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

// ---- Helpers --------------------------------------------------------------

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}