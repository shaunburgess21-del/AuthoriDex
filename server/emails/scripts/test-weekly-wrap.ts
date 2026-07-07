/**
 * Preview Weekly Wrap email variants (mock data) to sandbox inbox.
 *
 *   npx tsx --env-file=.env server/emails/scripts/test-weekly-wrap.ts
 *   npx tsx --env-file=.env server/emails/scripts/test-weekly-wrap.ts mixed
 *   npx tsx --env-file=.env server/emails/scripts/test-weekly-wrap.ts sparse
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
    worstPick: { label: "S&P 500 close up this week?", profit: -220 },
    rankDelta: { previous: 142, current: 138 },
    jackpot: { won: true, profit: 450 },
    topWeeklyGainers: [
      { id: "p-jensen", name: "Jensen Huang", change7d: 17.2 },
      { id: "p-drake", name: "Drake", change7d: 9.1 },
      { id: "p-khaby", name: "Khaby Lame", change7d: 12.4 },
    ],
    results: [
      { marketId: "m1", entryId: "e1", marketSlug: "drake-vs-kendrick", marketTitle: "Drake vs Kendrick", pickLabel: "Drake", outcome: "won", stake: 200, payout: 778, net: 578, settledAt: now },
      { marketId: "m2", entryId: "e1", marketSlug: "sp500-updown", marketTitle: "S&P 500 close up this week?", pickLabel: "Above", outcome: "lost", stake: 220, payout: 0, net: -220, settledAt: now },
      { marketId: "m3", entryId: "e2", marketSlug: "cardi-b-updown", marketTitle: "Cardi B: trend score up or down?", pickLabel: "Down", outcome: "won", stake: 150, payout: 240, net: 90, settledAt: now },
      { marketId: "m4", entryId: "e1", marketSlug: "creators-race", marketTitle: "Category Race: Creators", pickLabel: "MrBeast", outcome: "won", stake: 120, payout: 280, net: 160, settledAt: now },
      { marketId: "m5", entryId: "e1", marketSlug: "eth-4k", marketTitle: "ETH close above $4K?", pickLabel: "Above", outcome: "won", stake: 100, payout: 195, net: 95, settledAt: now },
      { marketId: "m6", entryId: "e2", marketSlug: "bitcoin-100k", marketTitle: "Will Bitcoin close above $100K?", pickLabel: "Below", outcome: "lost", stake: 80, payout: 0, net: -80, settledAt: now },
      { marketId: "m7", entryId: "e2", marketSlug: "tate-updown", marketTitle: "Andrew Tate: trend score up or down?", pickLabel: "Down", outcome: "won", stake: 60, payout: 110, net: 50, settledAt: now },
    ],
    openPositions: { count: 4, totalStake: 540, settlingNext7d: 2 },
    windowStart,
    windowEnd: now,
  },
  mixed: {
    wins: 5,
    losses: 7,
    netCredits: 180,
    bestPick: { label: "Will Bitcoin close above $100K?", profit: 90 },
    worstPick: { label: "Category Race: Creators", profit: -200 },
    rankDelta: { previous: 88, current: 91 },
    jackpot: { won: false, profit: -100 },
    topWeeklyGainers: [
      { id: "p-elon", name: "Elon Musk", change7d: 8.5 },
      { id: "p-zendaya", name: "Zendaya", change7d: 6.2 },
    ],
    results: [
      { marketId: "m1", entryId: "e2", marketSlug: "bitcoin-100k", marketTitle: "Will Bitcoin close above $100K?", pickLabel: "Below", outcome: "won", stake: 100, payout: 190, net: 90, settledAt: now },
      { marketId: "m2", entryId: "e3", marketSlug: "creators-race", marketTitle: "Category Race: Creators", pickLabel: "Khaby Lame", outcome: "lost", stake: 200, payout: 0, net: -200, settledAt: now },
    ],
    openPositions: { count: 1, totalStake: 80, settlingNext7d: 1 },
    windowStart,
    windowEnd: now,
  },
  losing: {
    wins: 2,
    losses: 9,
    netCredits: -800,
    bestPick: { label: "Andrew Tate: trend score up or down?", profit: 40 },
    worstPick: { label: "ETH close above $4K?", profit: -350 },
    rankDelta: null,
    jackpot: null,
    topWeeklyGainers: [{ id: "p-sabrina", name: "Sabrina Carpenter", change7d: 11.0 }],
    results: [
      { marketId: "m1", entryId: "e1", marketSlug: "eth-4k", marketTitle: "ETH close above $4K?", pickLabel: "Above", outcome: "lost", stake: 350, payout: 0, net: -350, settledAt: now },
      { marketId: "m2", entryId: "e2", marketSlug: "tate-updown", marketTitle: "Andrew Tate: trend score up or down?", pickLabel: "Down", outcome: "won", stake: 60, payout: 100, net: 40, settledAt: now },
    ],
    openPositions: null,
    windowStart,
    windowEnd: now,
  },
  sparse: {
    wins: 1,
    losses: 1,
    netCredits: -2,
    bestPick: { label: "Will Bitcoin close above $100K?", profit: 98 },
    worstPick: { label: "Cardi B: trend score up or down?", profit: -100 },
    rankDelta: { previous: 48, current: 48 },
    jackpot: { won: false, profit: -100 },
    topWeeklyGainers: [
      { id: "p-vitalik", name: "Vitalik Buterin", change7d: 230.6 },
      { id: "p-babar", name: "Babar Azam", change7d: 223.9 },
      { id: "p-anthony", name: "Anthony Albanese", change7d: 151.4 },
    ],
    results: [
      { marketId: "m1", entryId: "e2", marketSlug: "bitcoin-100k", marketTitle: "Will Bitcoin close above $100K?", pickLabel: "Below", outcome: "won", stake: 100, payout: 198, net: 98, settledAt: now },
      { marketId: "m2", entryId: "e1", marketSlug: "cardi-b-updown", marketTitle: "Cardi B: trend score up or down?", pickLabel: "Up", outcome: "lost", stake: 100, payout: 0, net: -100, settledAt: now },
    ],
    openPositions: null,
    windowStart,
    windowEnd: now,
  },
  openonly: {
    // User has no settled bets this week but holds open positions —
    // exercises the neutral hero ("Your week on VoxDex") and the
    // "Still in play" section as the lead content.
    wins: 0,
    losses: 0,
    netCredits: 0,
    bestPick: null,
    worstPick: null,
    rankDelta: { previous: 48, current: 50 },
    jackpot: null,
    topWeeklyGainers: [
      { id: "p-vitalik", name: "Vitalik Buterin", change7d: 230.6 },
      { id: "p-babar", name: "Babar Azam", change7d: 223.9 },
    ],
    results: [],
    openPositions: { count: 3, totalStake: 320, settlingNext7d: 2 },
    windowStart,
    windowEnd: now,
  },
};

async function main() {
  const key = process.argv[2] ?? "winner";
  const stats = VARIANTS[key];
  if (!stats) {
    console.error(`[test-weekly-wrap] Unknown variant "${key}". Use: winner | mixed | losing | sparse | openonly`);
    process.exit(1);
  }

  console.log(`[test-weekly-wrap] Sending "${key}" variant to ${RECIPIENT}...`);

  const result = await sendEmail({
    to: RECIPIENT,
    subject: weeklyWrapSubject(stats),
    category: "engagement",
    templateName: "weekly_wrap",
    // send.ts hard-requires userId + preferenceKey for engagement (even
    // with skipMarketingChecks) — the production job passes the user's
    // real id; for the preview script a stable sentinel is fine. The
    // idempotency log insert will warn (FK on profiles) but the email
    // still sends — send.ts catches the FK error and proceeds.
    userId: "preview-test-user",
    preferenceKey: "predictionsEmail",
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
