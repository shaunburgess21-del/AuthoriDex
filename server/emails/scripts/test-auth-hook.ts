/**
 * Local test for the Supabase Send Email Auth Hook.
 *
 * Simulates Supabase calling our /api/auth/email-hook endpoint
 * with a properly-signed payload. Verifies the full pipeline:
 *   signature check → dispatch → template render → Resend send → inbox.
 *
 * Prerequisites:
 *   1. Dev server running: `npm run dev` in another terminal.
 *   2. SEND_EMAIL_HOOK_SECRET set in .env.
 *   3. RESEND_API_KEY set in .env (already done).
 *
 * Run with:
 *   npx tsx --env-file=.env server/emails/scripts/test-auth-hook.ts
 */

import { Webhook } from "standardwebhooks";
import { randomUUID } from "crypto";

// ---- Config ---------------------------------------------------------------

const ENDPOINT = "http://localhost:5000/api/auth/email-hook";
const RECIPIENT = "andrewdburgess001@gmail.com";

// Generate a realistic-looking 6-digit OTP for the test
const TEST_TOKEN = String(Math.floor(100000 + Math.random() * 900000));

// ---- Build a Supabase-shaped payload --------------------------------------

const payload = {
  user: {
    id: randomUUID(),
    email: RECIPIENT,
  },
  email_data: {
    token: TEST_TOKEN,
    token_hash: randomUUID(), // Real Supabase uses a long hash; UUID is fine for tests
    redirect_to: "https://voxdex.com/",
    email_action_type: "signup" as const,
    site_url: "https://voxdex.com",
  },
};

// ---- Sign and send --------------------------------------------------------

async function main() {
  const rawSecret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!rawSecret) {
    console.error("[test-auth-hook] SEND_EMAIL_HOOK_SECRET not set in .env");
    process.exit(1);
  }

  // Strip the v1,whsec_ prefix to match what our handler does.
  const secret = rawSecret.replace("v1,whsec_", "");
  const wh = new Webhook(secret);

  const payloadString = JSON.stringify(payload);
  const msgId = `msg_${randomUUID()}`;
  const timestamp = new Date();

  // standardwebhooks.sign() returns the signature; we build the full
  // header set ourselves to match what Supabase sends.
  const signature = wh.sign(msgId, timestamp, payloadString);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "webhook-id": msgId,
    "webhook-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    "webhook-signature": signature,
  };

  console.log(`[test-auth-hook] Sending fake signup webhook...`);
  console.log(`[test-auth-hook]   to:     ${RECIPIENT}`);
  console.log(`[test-auth-hook]   token:  ${TEST_TOKEN}`);
  console.log(`[test-auth-hook]   target: ${ENDPOINT}`);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: payloadString,
    });

    const responseText = await res.text();

    if (res.ok) {
      console.log(`[test-auth-hook] ✓ Endpoint returned ${res.status}`);
      console.log(`[test-auth-hook] Check inbox: ${RECIPIENT}`);
      console.log(
        `[test-auth-hook] Expected code in email: ${TEST_TOKEN.slice(0, 3)} ${TEST_TOKEN.slice(3)}`,
      );
    } else {
      console.error(
        `[test-auth-hook] ✗ Endpoint returned ${res.status}: ${responseText}`,
      );
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[test-auth-hook] ✗ Request failed: ${message}`);
    console.error(
      `[test-auth-hook]   Is the dev server running on port 5000?`,
    );
    process.exit(1);
  }
}

main();