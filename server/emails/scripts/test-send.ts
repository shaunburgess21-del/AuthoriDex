/**
 * Minimal end-to-end test send.
 *
 * Run with:
 *   tsx --env-file=.env server/emails/scripts/test-send.ts
 *
 * Sends a deliberately bare-bones email — no Layout, no theme,
 * no React Email components — just plain HTML. The goal is to
 * verify the API key, env loading, Resend client, and network
 * path all work. Template/design tests come later.
 *
 * Sandbox mode note: this will only deliver if the `to` address
 * matches the email that owns the Resend account.
 */

import * as React from "react";

import { sendEmail } from "../send";

// ---- Config ---------------------------------------------------------------

const RECIPIENT = "andrewdburgess001@gmail.com";

// ---- Minimal test template ------------------------------------------------
//
// Intentionally NOT using Layout or any React Email components.
// If this send fails, we know the problem is the Resend client or
// API key — not anything in our template layer.

function TestTemplate() {
  return React.createElement(
    "div",
    { style: { fontFamily: "sans-serif", padding: "24px" } },
    React.createElement("h1", null, "VoxDex email pipeline test"),
    React.createElement(
      "p",
      null,
      "If you are reading this in your inbox, the Resend + " +
        "sendEmail() path is working end to end.",
    ),
    React.createElement(
      "p",
      { style: { color: "#6B7280", fontSize: "14px" } },
      `Sent at ${new Date().toISOString()}`,
    ),
  );
}

// ---- Run ------------------------------------------------------------------

async function main() {
  console.log(`[test-send] Sending test email to ${RECIPIENT}...`);

  const result = await sendEmail({
    to: RECIPIENT,
    subject: "VoxDex — pipeline test",
    category: "auth",
    template: React.createElement(TestTemplate),
    tags: [{ name: "type", value: "pipeline-test" }],
  });

  if (result.ok && !result.skipped) {
    console.log(`[test-send] ✓ Sent. Resend id: ${result.id}`);
    console.log(`[test-send] Check inbox: ${RECIPIENT}`);
  } else if (result.ok && result.skipped) {
    console.log(`[test-send] Skipped (${result.reason})`);
  } else {
    console.error(`[test-send] ✗ Failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test-send] Unhandled error:", err);
  process.exit(1);
});