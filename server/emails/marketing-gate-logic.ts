/**
 * Pure marketing-gate rules (no DB). Imported by marketing-gate.ts and tests.
 */

import type { EmailCategory } from "./client";

/** Per-category email opt-in columns on notification_preferences. */
export type EmailPreferenceKey =
  | "predictionsEmail"
  | "favoritesEmail"
  | "socialEmail"
  | "accountEmail";

export type MarketingSuppressReason =
  | "unsubscribed"
  | "preference_off"
  | "missing_preference_key"
  | "missing_user_id";

export interface MarketingGateInput {
  category: EmailCategory;
  userId?: string;
  preferenceKey?: EmailPreferenceKey;
  skipMarketingChecks?: boolean;
}

export type MarketingGateResult =
  | { allowed: true }
  | { allowed: false; reason: MarketingSuppressReason };

export interface MarketingGateDbSnapshot {
  isUnsubscribed: boolean;
  predictionsEmail: boolean;
  favoritesEmail: boolean;
  socialEmail: boolean;
  accountEmail: boolean;
}

export function resolveMarketingGateFromSnapshot(
  input: MarketingGateInput,
  snapshot: MarketingGateDbSnapshot | null,
): MarketingGateResult {
  const { category, userId, preferenceKey, skipMarketingChecks } = input;

  if (category === "auth") {
    return { allowed: true };
  }

  if (skipMarketingChecks || !userId) {
    return { allowed: true };
  }

  if (snapshot?.isUnsubscribed) {
    return { allowed: false, reason: "unsubscribed" };
  }

  if (category === "lifecycle") {
    return { allowed: true };
  }

  if (category === "engagement") {
    if (!preferenceKey) {
      return { allowed: false, reason: "missing_preference_key" };
    }

    const enabled = snapshot?.[preferenceKey] ?? false;
    if (!enabled) {
      return { allowed: false, reason: "preference_off" };
    }

    return { allowed: true };
  }

  return { allowed: true };
}
