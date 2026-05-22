/**
 * Verifies engagement sends respect notification_preferences.
 *
 * Run with:
 *   USER_ID=<profile-uuid> npx tsx --env-file=.env server/emails/scripts/test-engagement-suppressed.ts
 *
 * Expects predictionsEmail=false (or toggles off in Settings) → suppressed log, no Resend call.
 */

import * as React from "react";
import { Heading, Text } from "react-email";

import { sendEmail } from "../send";

const RECIPIENT = process.env.TEST_EMAIL_RECIPIENT ?? "andrewdburgess001@gmail.com";
const USER_ID = process.env.USER_ID;

function EngagementProbe() {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Heading, null, "Engagement probe"),
    React.createElement(Text, null, "If you received this, suppression failed."),
  );
}

async function main() {
  if (!USER_ID) {
    console.error("[test-engagement] Set USER_ID to a real profiles.id");
    process.exit(1);
  }

  console.log(
    `[test-engagement] Sending engagement probe to ${RECIPIENT} userId=${USER_ID}...`,
  );

  const result = await sendEmail({
    to: RECIPIENT,
    subject: "VoxDex — engagement suppression test",
    category: "engagement",
    templateName: "engagement_probe",
    userId: USER_ID,
    preferenceKey: "predictionsEmail",
    template: React.createElement(EngagementProbe),
    idempotencyKey: `test:engagement:${USER_ID}:${Date.now()}`,
    tags: [{ name: "type", value: "engagement-suppression-test" }],
  });

  if (result.ok && result.skipped) {
    console.log(`[test-engagement] ✓ Suppressed as expected (${result.reason})`);
    return;
  }

  if (result.ok && !result.skipped) {
    console.warn(
      "[test-engagement] Send went out — predictionsEmail may be enabled for this user",
    );
    console.log(`[test-engagement] Resend id: ${result.id}`);
    return;
  }

  console.error(`[test-engagement] ✗ Failed: ${result.error}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[test-engagement] Unhandled error:", err);
  process.exit(1);
});
