/**
 * Marketing / lifecycle email suppression checks for sendEmail().
 *
 * Auth emails bypass this module entirely. Engagement emails require a
 * preferenceKey; lifecycle user-facing emails only check the master
 * email_unsubscribe_state row.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  emailUnsubscribeState,
  notificationPreferences,
} from "@shared/schema";
import type { EmailCategory } from "./client";
import { logger } from "../log";
import {
  resolveMarketingGateFromSnapshot,
  type EmailPreferenceKey,
  type MarketingGateDbSnapshot,
  type MarketingGateInput,
  type MarketingGateResult,
  type MarketingSuppressReason,
} from "./marketing-gate-logic";

export type {
  EmailPreferenceKey,
  MarketingGateDbSnapshot,
  MarketingGateInput,
  MarketingGateResult,
  MarketingSuppressReason,
};

export { resolveMarketingGateFromSnapshot };

async function loadMarketingSnapshot(
  userId: string,
): Promise<MarketingGateDbSnapshot> {
  const [prefsRow, unsubRow] = await Promise.all([
    db
      .select({
        predictionsEmail: notificationPreferences.predictionsEmail,
        favoritesEmail: notificationPreferences.favoritesEmail,
        socialEmail: notificationPreferences.socialEmail,
        accountEmail: notificationPreferences.accountEmail,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1),
    db
      .select({ userId: emailUnsubscribeState.userId })
      .from(emailUnsubscribeState)
      .where(eq(emailUnsubscribeState.userId, userId))
      .limit(1),
  ]);

  const prefs = prefsRow[0];
  return {
    isUnsubscribed: Boolean(unsubRow[0]),
    predictionsEmail: prefs?.predictionsEmail ?? false,
    favoritesEmail: prefs?.favoritesEmail ?? false,
    socialEmail: prefs?.socialEmail ?? false,
    accountEmail: prefs?.accountEmail ?? false,
  };
}

/**
 * Returns whether a send should proceed past marketing checks.
 * Callers treat `allowed: false` as a successful skip (not an error).
 *
 * Fail-open: if the DB lookup fails, we allow the send rather than
 * silently dropping mail during a transient outage (matches in-app
 * notification prefs behavior).
 */
export async function evaluateMarketingGate(
  input: MarketingGateInput,
): Promise<MarketingGateResult> {
  const { category, userId, preferenceKey, skipMarketingChecks } = input;

  if (category === "auth") {
    return { allowed: true };
  }

  if (skipMarketingChecks || !userId) {
    return { allowed: true };
  }

  if (category === "engagement" && !preferenceKey) {
    logger.warn(
      { userId, category },
      "[emails] engagement send missing preferenceKey; suppressing",
    );
    return { allowed: false, reason: "missing_preference_key" };
  }

  try {
    const snapshot = await loadMarketingSnapshot(userId);
    return resolveMarketingGateFromSnapshot(input, snapshot);
  } catch (err) {
    logger.warn(
      { err, userId, category },
      "[emails] marketing gate lookup failed; allowing send",
    );
    return { allowed: true };
  }
}

export function logEmailSuppressed(args: {
  userId?: string;
  category: EmailCategory;
  preferenceKey?: EmailPreferenceKey;
  reason: MarketingSuppressReason;
  to: string;
  templateName?: string;
}): void {
  logger.info(
    {
      event: "email.suppressed",
      userId: args.userId,
      category: args.category,
      preferenceKey: args.preferenceKey,
      reason: args.reason,
      to: args.to,
      template: args.templateName,
    },
    "[emails] Send suppressed by marketing gate",
  );
}
