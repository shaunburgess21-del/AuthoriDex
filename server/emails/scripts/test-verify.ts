/**
 * Test send for the VerifyEmail template.
 *
 * Run with:
 *   npx tsx --env-file=.env server/emails/scripts/test-verify.ts
 *
 * Sandbox mode note: only delivers to the email that owns the
 * Resend account.
 */

import * as React from "react";

import { sendEmail } from "../send";
import { VerifyEmail } from "../templates/auth/VerifyEmail";

const RECIPIENT = "andrewdburgess001@gmail.com";

// Fixed sample code for visual testing.
// Real flow will generate a random 6-digit code server-side.
const SAMPLE_CODE = "428913";

async function main() {
  console.log(`[test-verify] Sending verification email to ${RECIPIENT}...`);

  const result = await sendEmail({
    to: RECIPIENT,
    subject: `Your VoxDex code: ${SAMPLE_CODE}`,
    category: "auth",
    template: React.createElement(VerifyEmail, { code: SAMPLE_CODE }),
    tags: [{ name: "type", value: "verify-email-test" }],
  });

  if (result.ok && !result.skipped) {
    console.log(`[test-verify] ✓ Sent. Resend id: ${result.id}`);
    console.log(`[test-verify] Check inbox: ${RECIPIENT}`);
  } else if (result.ok && result.skipped) {
    console.log(`[test-verify] Skipped (${result.reason})`);
  } else {
    console.error(`[test-verify] ✗ Failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test-verify] Unhandled error:", err);
  process.exit(1);
});