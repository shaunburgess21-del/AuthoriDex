/**
 * Test send for the Welcome email.
 *
 * Run with:
 *   npx tsx --env-file=.env server/emails/scripts/test-welcome.ts
 *
 * Sends the WelcomeEmail template to our sandbox recipient so we
 * can check how it renders in real inbox clients (Outlook, Gmail
 * web, Gmail Android) before wiring it into the post-onboarding
 * flow.
 *
 * Sandbox mode note: only delivers to the email that owns the
 * Resend account.
 */

import * as React from "react";

import { sendEmail } from "../send";
import {
  WelcomeEmail,
  WELCOME_SUBJECT,
} from "../templates/lifecycle/Welcome";
import { buildUnsubscribeUrl } from "../unsubscribe";

const RECIPIENT = "andrewdburgess001@gmail.com";

const TEST_BASE_URL = process.env.PUBLIC_APP_URL || process.env.APP_URL || "https://voxdex.com";

async function main() {
  console.log(`[test-welcome] Sending welcome email to ${RECIPIENT}...`);

  const result = await sendEmail({
    to: RECIPIENT,
    subject: WELCOME_SUBJECT,
    category: "lifecycle",
    templateName: "welcome",
    skipMarketingChecks: true,
    template: React.createElement(WelcomeEmail, {
      baseUrl: TEST_BASE_URL,
      unsubscribeUrl: buildUnsubscribeUrl("test-user", TEST_BASE_URL),
    }),
    idempotencyKey: `test:welcome:${Date.now()}`,
    tags: [{ name: "type", value: "welcome-email-test" }],
  });

  if (result.ok && !result.skipped) {
    console.log(`[test-welcome] ✓ Sent. Resend id: ${result.id}`);
    console.log(`[test-welcome] Check inbox: ${RECIPIENT}`);
  } else if (result.ok && result.skipped) {
    console.log(`[test-welcome] Skipped (${result.reason})`);
  } else {
    console.error(`[test-welcome] ✗ Failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test-welcome] Unhandled error:", err);
  process.exit(1);
});
