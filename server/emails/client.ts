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
 
// ---- Client ---------------------------------------------------------------
//
// The Resend client is constructed lazily so a missing RESEND_API_KEY
// does NOT crash server boot. Email is a feature, not a dependency
// of the app being able to start — a misconfigured email key should
// break email sends, not the leaderboard.
//
// Call `getResendClient()` from send paths; it will either return a
// configured client or throw a descriptive error that callers can
// catch and surface to logs/monitoring.
 
let cachedClient: Resend | null = null;
 
export function getResendClient(): Resend {
  if (cachedClient) return cachedClient;
 
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[emails] RESEND_API_KEY is not set. Add it to your .env (dev) " +
        "or Railway environment (prod). Email sending is disabled " +
        "until this is fixed; the rest of the app is unaffected.",
    );
  }
 
  cachedClient = new Resend(apiKey);
  return cachedClient;
}
 
/**
 * Back-compat alias. Prefer `getResendClient()` in new code.
 *
 * This Proxy shape means that even code doing
 * `import { resend } from "./client"` gets the lazy behaviour —
 * the client is only built on first actual property access
 * (e.g. `resend.emails.send(...)`).
 */
export const resend = new Proxy({} as Resend, {
  get(_target, prop) {
    return Reflect.get(getResendClient(), prop);
  },
});
 
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
 * After domain is ready:
 *   - auth + lifecycle share `hello@` so users see a consistent
 *     "warm" sender for anything human-facing (verify, welcome,
 *     password reset). Stripe, Linear, Notion all use this pattern.
 *   - engagement uses `updates@` so power users can filter digest
 *     mail separately from transactional mail without losing
 *     important account messages.
 *
 * Reply-to on all categories is `hello@voxdex.com` — the monitored
 * alias that lands in team@voxdex.com's inbox.
 */
export const senders = senderDomainReady
  ? {
      auth:       "VoxDex <hello@voxdex.com>",
      lifecycle:  "VoxDex <hello@voxdex.com>",
      engagement: "VoxDex Updates <updates@voxdex.com>",
    }
  : {
      auth:       "VoxDex (dev) <onboarding@resend.dev>",
      lifecycle:  "VoxDex (dev) <onboarding@resend.dev>",
      engagement: "VoxDex (dev) <onboarding@resend.dev>",
    };
 
/**
 * Where replies go. Users hitting "Reply" on a VoxDex email
 * should reach a human, not a no-reply black hole.
 *
 * `hello@voxdex.com` is an alias on the team@voxdex.com mailbox
 * (Microsoft 365), so replies land in the shared team inbox.
 */
export const replyTo = senderDomainReady
  ? "hello@voxdex.com"
  : undefined; // In dev, Resend sandbox doesn't support reply-to.
 
// ---- Type export ----------------------------------------------------------
 
export type EmailCategory = keyof typeof senders;