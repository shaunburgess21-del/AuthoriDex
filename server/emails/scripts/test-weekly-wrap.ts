/**
 * Preview Weekly Wrap email variants (mock data) to sandbox inbox.
 *
 *   npx tsx --env-file=.env server/emails/scripts/test-weekly-wrap.ts
 *   npx tsx --env-file=.env server/emails/scripts/test-weekly-wrap.ts mixed
 */

import * as React from "react";

import type { FullWeeklyDigestStats } from "../../jobs/weekly-digest-utils";
import { sendEmail } from "../send";
import {
  WeeklyWrapEmail,
  weeklyWrapSubject,
} from "../templates/engagement/WeeklyWrapEmail";
import { buildUnsubscribeUrl } from "../unsubscribe";

const RECIPIENT = process.env.TEST_EMAIL_RECIPIENT ?? "andrewdburgess001@gmail.com";
const TEST_BASE_URL = process.env.PUBLIC_APP_URL || process.env.APP_URL || "https://voxdex.com";

const now = new Date();
const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

const VARIANTS: Record<string, FullWeeklyDigestStats> = {
  winner: {
    wins: 12,
    losses: 8,
    netCredits: 3200,
    bestPick: { label: "Drake vs Kendrick", profit: 578 },
    worstPick: { label: "Taylor Swift UP", profit: -120 },
    rankDelta: { previous: 142, current: 138 },
    jackpot: { won: true, profit: 450 },
    topMoversNextWeek: [
      { name: "Jensen Huang", change24h: 17.2 },
      { name: "Drake", change24h: 9.1 },
      { name: "Khaby Lame", change24h: -12.4 },
    ],
    windowStart,
    windowEnd: now,
  },
  mixed: {
    wins: 5,
    losses: 7,
    netCredits: 180,
    bestPick: { label: "World Markets: Election", profit: 90 },
    worstPick: { label: "MrBeast race", profit: -200 },
    rankDelta: { previous: 88, current: 91 },
    jackpot: { won: false, profit: -100 },
    topMoversNextWeek: [
      { name: "Elon Musk", change24h: 8.5 },
      { name: "Zendaya", change24h: 6.2 },
    ],
    windowStart,
    windowEnd: now,
  },
  losing: {
    wins: 2,
    losses: 9,
    netCredits: -800,
    bestPick: { label: "Small win", profit: 40 },
    worstPick: { label: "Big miss", profit: -350 },
    rankDelta: null,
    jackpot: null,
    topMoversNextWeek: [{ name: "Sabrina Carpenter", change24h: 11.0 }],
    windowStart,
    windowEnd: now,
  },
};

async function main() {
  const key = process.argv[2] ?? "winner";
  const stats = VARIANTS[key];
  if (!stats) {
    console.error(`[test-weekly-wrap] Unknown variant "${key}". Use: winner | mixed | losing`);
    process.exit(1);
  }

  console.log(`[test-weekly-wrap] Sending "${key}" variant to ${RECIPIENT}...`);

  const result = await sendEmail({
    to: RECIPIENT,
    subject: weeklyWrapSubject(stats),
    category: "engagement",
    templateName: "weekly_wrap",
    skipMarketingChecks: true,
    template: React.createElement(WeeklyWrapEmail, {
      stats,
      baseUrl: TEST_BASE_URL,
      unsubscribeUrl: buildUnsubscribeUrl("test-user", TEST_BASE_URL),
    }),
    idempotencyKey: `test:weekly-wrap:${key}:${Date.now()}`,
    tags: [{ name: "type", value: `weekly-wrap-test-${key}` }],
  });

  if (result.ok && !result.skipped) {
    console.log(`[test-weekly-wrap] Sent. Resend id: ${result.id}`);
  } else if (result.ok && result.skipped) {
    console.log(`[test-weekly-wrap] Skipped (${result.reason})`);
  } else {
    console.error(`[test-weekly-wrap] Failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test-weekly-wrap] Unhandled error:", err);
  process.exit(1);
});
