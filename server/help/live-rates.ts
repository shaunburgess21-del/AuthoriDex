/**
 * Live XP / Vox rates for the help chat, cached so a question never waits
 * on two table reads. Same source as GET /api/gamification/xp-actions and
 * /credit-actions, which feed the How it works tables.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { creditActions, xpActions } from "@shared/schema";
import { FALLBACK_HELP_RATES, type HelpRates } from "./rates";

const CACHE_MS = 10 * 60_000;
const RETRY_MS = 60_000;

let cached: { rates: HelpRates; expiresAt: number } | null = null;
let inflight: Promise<HelpRates> | null = null;

async function loadRates(): Promise<HelpRates> {
  const [xpRows, voxRows] = await Promise.all([
    db
      .select({
        key: xpActions.actionKey,
        label: xpActions.displayName,
        xp: xpActions.xpValue,
        dailyCap: xpActions.dailyCap,
        description: xpActions.description,
      })
      .from(xpActions)
      .where(eq(xpActions.isActive, true)),
    db
      .select({
        key: creditActions.key,
        label: creditActions.label,
        vox: creditActions.proposedCredits,
        dailyCap: creditActions.dailyCap,
        category: creditActions.category,
      })
      .from(creditActions)
      .where(eq(creditActions.isActive, true)),
  ]);

  if (xpRows.length === 0 && voxRows.length === 0) {
    throw new Error("xp_actions and credit_actions returned no active rows");
  }

  return {
    ...FALLBACK_HELP_RATES,
    xp: xpRows.length > 0 ? xpRows : FALLBACK_HELP_RATES.xp,
    vox: voxRows.length > 0 ? voxRows : FALLBACK_HELP_RATES.vox,
  };
}

/** Never throws. Keeps the last good values (or the seed defaults) when the read fails. */
export function getHelpRates(): Promise<HelpRates> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.rates);
  if (inflight) return inflight;

  inflight = loadRates()
    .then((rates) => {
      cached = { rates, expiresAt: Date.now() + CACHE_MS };
      return rates;
    })
    .catch((err) => {
      console.warn(
        "[HelpChat] live rates unavailable, using last known values:",
        err instanceof Error ? err.message : err,
      );
      const rates = cached?.rates ?? FALLBACK_HELP_RATES;
      cached = { rates, expiresAt: Date.now() + RETRY_MS };
      return rates;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
