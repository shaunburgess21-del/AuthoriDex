/**
 * Resend SDK singleton + centralized sender identity.
 *
 * One shared Resend client for the whole backend. Every email we
 * send — auth, lifecycle, engagement — routes through this module.
 *
 * Sender addresses are centralized here on purpose:
 *   - Single place to change "from" when voxdex.com goes live
 *   - Prevents typos in template files
 *   - Lets us redirect all mail in dev/staging via one env var
 *
 * Mirrors the singleton pattern used in server/db.ts and
 * server/supabase.ts so the codebase stays consistent.
 */

import { Resend } from "resend";

// ---- Env wiring -----------------------------------------------------------

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  // Fail loud at module load rather than silently at first send.
  // The backend should not start without email capability wired up.
  throw new Error(
    "[emails] RESEND_API_KEY is not set. Add it to your .env (dev) " +
      "or Railway environment (prod).",
  );
}

// ---- Client ---------------------------------------------------------------

/**
 * Shared Resend client. Import from here, don't `new Resend(...)`
 * anywhere else in the codebase.
 */
export const resend = new Resend(apiKey);

// ---- Sender addresses -----------------------------------------------------

/**
 * True when Resend has a verified voxdex.com domain configured AND
 * we've opted into using it. Until both are true, we send from the
 * Resend sandbox sender so nothing blocks dev work.
 *
 * Flip by setting EMAIL_SENDER_DOMAIN_READY=true in Railway once:
 *   1. voxdex.com DNS records (SPF/DKIM) are verified in Resend
 *   2. A warm-up period has passed
 */
const senderDomainReady =
  process.env.EMAIL_SENDER_DOMAIN_READY === "true";

/**
 * Sender identities, one per email category.
 *
 * - `auth`       → account verification, password reset, login alerts
 * - `lifecycle`  → welcome, re-engagement, account milestones
 * - `engagement` → Weekly Wrap, Jackpot reminders, market resolutions
 *
 * Before domain is ready: everything goes via Resend's sandbox
 * sender (onboarding@resend.dev), which only delivers to the
 * email address that owns the Resend account. Perfect for dev.
 *
 * After domain is ready: each category uses its own subdomain so
 * reputation is isolated — a marketing-email complaint can't hurt
 * auth-email deliverability.
 */
export const senders = senderDomainReady
  ? {
      auth:       "VoxDex <no-reply@auth.voxdex.com>",
      lifecycle:  "VoxDex <hello@voxdex.com>",
      engagement: "VoxDex Weekly <weekly@news.voxdex.com>",
    }
  : {
      auth:       "VoxDex (dev) <onboarding@resend.dev>",
      lifecycle:  "VoxDex (dev) <onboarding@resend.dev>",
      engagement: "VoxDex (dev) <onboarding@resend.dev>",
    };

/**
 * Where replies go. Users hitting "Reply" on a VoxDex email
 * should reach a human, not a no-reply black hole.
 */
export const replyTo = senderDomainReady
  ? "support@voxdex.com"
  : undefined; // In dev, Resend sandbox doesn't support reply-to.

// ---- Type export ----------------------------------------------------------

export type EmailCategory = keyof typeof senders;