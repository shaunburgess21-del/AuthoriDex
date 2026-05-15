/**
 * Shared credit configuration — single source of truth for the
 * Credits earn loop. Imported by:
 *
 *   - server/scripts/seed-gamification.ts (seeds credit_actions table)
 *   - server/services/gamification.ts (adjustCredits fallback rate)
 *   - server/routes.ts (SIGNUP_CREDIT_GRANT in /api/profile/sync)
 *   - client/src/pages/HowItWorksPage.tsx (Credits tab earn table)
 *   - client/src/lib/gamification-content.ts (re-export for legacy)
 *
 * Important: at runtime, adjustCredits() reads the canonical
 * `proposedCredits` and `dailyCap` from the credit_actions DB table
 * (so admin edits take effect without redeploy). The values defined
 * here are the SEED defaults — they're authoritative only on first
 * insert. Subsequent reseeds upsert by `key` and refresh the row.
 */

/** One-time grant on profile creation. Mirrored to credit_actions seed. */
export const SIGNUP_CREDIT_GRANT = 10000;

/**
 * Category groupings drive how the How It Works Credits tab and the
 * admin Credit Actions table render. Strings (not numeric enum) so
 * they survive JSON round-trips into the DB column unchanged.
 */
export const CREDIT_CATEGORIES = {
  ENGAGEMENT: "ENGAGEMENT",
  QUALITY: "QUALITY",
  STREAK: "STREAK",
  SOCIAL: "SOCIAL",
  SPECIAL: "SPECIAL",
} as const;

export type CreditCategory =
  (typeof CREDIT_CATEGORIES)[keyof typeof CREDIT_CATEGORIES];

export interface CreditActionConfig {
  /** Stable snake_case identifier — primary key in credit_actions. */
  key: string;
  /** Display name used everywhere user-facing. */
  label: string;
  /** Default credit reward. Authoritative copy lives in DB at runtime. */
  proposedCredits: number;
  /** null = no per-day limit. Daily cap is enforced in adjustCredits(). */
  dailyCap: number | null;
  category: CreditCategory;
  /** One-line operator note rendered on the admin table. Optional. */
  notes?: string;
  /** Soft-disable flag — when false the action seeds but does not award. */
  isActive: boolean;
  /** True for actions that only fire after admin approval. */
  requiresApproval: boolean;
}

/**
 * Initial seed for credit_actions. Threshold tweaks land in this
 * file ONLY on first deploy of a new action key — once shipped,
 * admins manage values via the admin UI and the DB row wins.
 *
 * Streak milestone keys mirror STREAK_MILESTONES from
 * shared/streak-config.ts in lockstep. Adding a new XP milestone
 * day there should be paired with a new credit milestone here so
 * the daily-checkin handler can award both.
 */
export const CREDIT_ACTIONS: readonly CreditActionConfig[] = [
  // ENGAGEMENT — daily-cappable, low-value, high-frequency. These
  // are the "earn a few credits for being active" actions.
  {
    key: "vote_any",
    label: "Vote (any type)",
    proposedCredits: 2,
    dailyCap: 10,
    category: "ENGAGEMENT",
    notes: "Any vote across vote surfaces",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "comment_insight",
    label: "Comment on insight",
    proposedCredits: 5,
    dailyCap: 5,
    category: "ENGAGEMENT",
    notes: "Min 20 chars, not on own insight",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "post_insight",
    label: "Post insight",
    proposedCredits: 10,
    dailyCap: 3,
    category: "ENGAGEMENT",
    notes: "Top-level community insight",
    isActive: true,
    requiresApproval: false,
  },

  // QUALITY — uncapped, admin-approved. The "do something the
  // platform actually keeps" tier.
  {
    key: "suggestion_approved",
    label: "Suggestion approved",
    proposedCredits: 50,
    dailyCap: null,
    category: "QUALITY",
    notes: "Content suggestion approved by admin",
    isActive: true,
    requiresApproval: true,
  },
  {
    key: "market_suggestion_approved",
    label: "Market suggestion approved",
    proposedCredits: 100,
    dailyCap: null,
    category: "QUALITY",
    notes: "World market suggestion published",
    isActive: true,
    requiresApproval: true,
  },

  // STREAK — lifetime-once milestones. The credit ledger key
  // (`credit_streak_${day}_${userId}`) prevents reset+reclimb
  // double-payouts, so dailyCap stays null.
  {
    key: "streak_milestone_3_credits",
    label: "3-day streak milestone",
    proposedCredits: 25,
    dailyCap: null,
    category: "STREAK",
    notes: "Lifetime once per milestone level",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "streak_milestone_7_credits",
    label: "7-day streak milestone",
    proposedCredits: 100,
    dailyCap: null,
    category: "STREAK",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "streak_milestone_14_credits",
    label: "14-day streak milestone",
    proposedCredits: 200,
    dailyCap: null,
    category: "STREAK",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "streak_milestone_30_credits",
    label: "30-day streak milestone",
    proposedCredits: 500,
    dailyCap: null,
    category: "STREAK",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "streak_milestone_100_credits",
    label: "100-day streak milestone",
    proposedCredits: 2000,
    dailyCap: null,
    category: "STREAK",
    isActive: true,
    requiresApproval: false,
  },

  // SOCIAL — share-link attribution + referral funnel. share_click
  // is daily-capped (same anti-spam shape as engagement actions);
  // the two referral keys are lifetime-once (idempotency keys
  // include the referred userId, not the date).
  {
    key: "share_click",
    label: "Confirmed share click",
    proposedCredits: 5,
    dailyCap: 3,
    category: "SOCIAL",
    notes: "Awarded when a tracked share link generates a confirmed external click",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "referral_completed",
    label: "Successful referral",
    proposedCredits: 500,
    dailyCap: null,
    category: "SOCIAL",
    notes: "Awarded to referrer when referred user completes their first meaningful action",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "referral_signup_bonus",
    label: "Referral signup bonus",
    proposedCredits: 2000,
    dailyCap: null,
    category: "SOCIAL",
    notes: "Bonus credits for new user who signed up via a referral link — stacks on top of standard signup grant",
    isActive: true,
    requiresApproval: false,
  },

  // SPECIAL — non-earnable bookkeeping rows. Listed so the admin
  // table is complete and the user-facing history can map every
  // ledger txnType back to a friendly label.
  {
    key: "signup_grant",
    label: "Signup grant",
    proposedCredits: SIGNUP_CREDIT_GRANT,
    dailyCap: null,
    category: "SPECIAL",
    notes: "One-time grant on account creation",
    isActive: true,
    requiresApproval: false,
  },
  {
    key: "admin_adjustment",
    label: "Admin adjustment",
    proposedCredits: 0,
    dailyCap: null,
    category: "SPECIAL",
    notes: "Manual admin credit adjustment",
    isActive: true,
    requiresApproval: false,
  },
] as const;

/**
 * Look up a credit action by key. Returns undefined for unknown
 * keys (e.g. legacy txnType values like `prediction_payout` that
 * don't map to a configured action) — callers should fall back to
 * a humanised txnType in that case.
 */
export function getCreditAction(key: string): CreditActionConfig | undefined {
  return CREDIT_ACTIONS.find((a) => a.key === key);
}

/**
 * Map a credit_ledger.txnType back to a friendly label. The user-
 * facing credit history needs to render every row, including legacy
 * txnTypes that pre-date the credit_actions table (`prediction_stake`,
 * `prediction_payout`, `prediction_refund`, `jackpot_payout`,
 * `agent_topup`, `bonus`, `initial_grant`). We keep that legacy map
 * here so the Credits tab and the user history component agree.
 */
const LEGACY_TXN_LABELS: Record<string, string> = {
  prediction_stake: "Prediction stake",
  prediction_payout: "Prediction win",
  prediction_refund: "Prediction refund",
  jackpot_payout: "Jackpot win",
  agent_topup: "Agent top-up",
  bonus: "Bonus",
  initial_grant: "Signup grant",
};

export function labelForTxnType(txnType: string): string {
  const action = getCreditAction(txnType);
  if (action) return action.label;
  if (LEGACY_TXN_LABELS[txnType]) return LEGACY_TXN_LABELS[txnType];
  // Fallback: capitalise + replace underscores so unrecognised
  // future txn types still render somewhat readably.
  return txnType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Earn-vs-spend classification used by the user history filter
 * pills. Lifetime grants count as "earned"; admin adjustments are
 * their own category because they can go either direction.
 */
export type LedgerBucket = "earned" | "spent" | "adjustment";

export function bucketForTxnType(txnType: string, amount: number): LedgerBucket {
  if (txnType === "admin_adjustment") return "adjustment";
  return amount >= 0 ? "earned" : "spent";
}
