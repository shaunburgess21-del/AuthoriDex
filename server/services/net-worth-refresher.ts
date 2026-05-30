import { fetchNetWorthContext } from "../providers/serper";
import { storage } from "../storage";
import { extractNetWorthFromContext } from "./profile-generator";

const HIGH_VOLATILITY_CATEGORY_RE = /business|tech|technology|finance/i;

export function classifyNetWorthVolatility(category: string | null | undefined): "standard" | "high" {
  if (category && HIGH_VOLATILITY_CATEGORY_RE.test(category)) return "high";
  return "standard";
}

export interface NetWorthRefreshResult {
  personId: string;
  /** True only if we actually wrote a new estimate. */
  updated: boolean;
  /** New estimate, or null if we did not overwrite the existing value. */
  estimatedNetWorth: string | null;
  /** "wrote" | "kept" | "provider_unavailable" - for cron observability. */
  outcome: "wrote" | "kept" | "provider_unavailable";
}

/**
 * Serper-only net worth refresh. Never overwrites a good existing value with
 * "Not available" - if Serper is down or yields no extractable figure we keep
 * the existing value and just bump `netWorthUpdatedAt` so the cron does not
 * hammer the same person every tick.
 */
export async function refreshNetWorth(
  personId: string,
  personName: string,
  volatility?: "standard" | "high",
): Promise<NetWorthRefreshResult> {
  const context = await fetchNetWorthContext(personName);

  if (!context) {
    // Provider unavailable (no API key / degraded). Do nothing - retry next tick.
    return {
      personId,
      updated: false,
      estimatedNetWorth: null,
      outcome: "provider_unavailable",
    };
  }

  const extracted = extractNetWorthFromContext(context, personName);
  const now = new Date();

  if (!extracted) {
    // No reliable figure this time, but provider responded - bump timestamp so
    // we don't retry every cron tick. Preserve existing value (do NOT overwrite).
    await storage.updateCelebrityProfileFields(personId, {
      netWorthUpdatedAt: now,
      ...(volatility ? { netWorthVolatility: volatility } : {}),
    });
    return {
      personId,
      updated: false,
      estimatedNetWorth: null,
      outcome: "kept",
    };
  }

  await storage.updateCelebrityProfileFields(personId, {
    estimatedNetWorth: extracted,
    netWorthUpdatedAt: now,
    ...(volatility ? { netWorthVolatility: volatility } : {}),
  });

  return {
    personId,
    updated: true,
    estimatedNetWorth: extracted,
    outcome: "wrote",
  };
}
