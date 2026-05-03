// Phase 3 Interest Picker — engagement write path.
//
// Every category-attributed user action (matchup vote, trending/opinion
// poll vote, induction vote, over/underrated sentiment vote, prediction
// market bet) calls `upsertEngagement` AFTER the primary row has been
// inserted and the action's own SQL transaction has committed. The
// helper runs its own tiny upsert, catches any failure, and logs at
// warn level — engagement loss is cheaper than losing the user's
// action, so this never throws back into the request.
//
// Category ids are resolved at write time (by the caller, usually as a
// tiny lookup against the parent poll/market/candidate/person row). We
// freeze the resolved id on the engagement row so a future re-
// categorisation of a person does not retroactively shift historical
// behavioural signal.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { userCategoryEngagement } from "@shared/schema";
import { CANONICAL_CATEGORIES } from "@shared/constants";
import { stakeBetWeight } from "./rankingConfig";
import { captureBackgroundError } from "../sentry";

/**
 * Canonical category id set, frozen at module load. Writes that fall
 * outside this set are dropped with a warn log — same guarantee as the
 * CHECK constraint on user_category_engagement, but surfaced early so
 * we don't rely on Postgres to round-trip the error and retry.
 */
const CANONICAL_IDS: ReadonlySet<string> = new Set(
  CANONICAL_CATEGORIES.map((c) => c.id),
);

/** Whether a raw category value is one of the 12 canonical ids. */
export function isCanonicalCategoryId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_IDS.has(value);
}

/**
 * Normalise an arbitrary (possibly Title Case) category string to its
 * canonical lowercase kebab id. Returns null if no match — callers
 * should then skip the upsert rather than invent a fallback.
 *
 * This is defensive: Phase 2's case-sensitivity bug silently broke
 * interest ranking for two weeks because one side was lowercased and
 * the other wasn't. Anything that reaches engagementWriter should
 * already be canonical, but we lowercase and re-check just in case a
 * legacy table still holds mixed case.
 */
export function normaliseCategoryId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  return CANONICAL_IDS.has(lower) ? lower : null;
}

/** Shape of a single `upsertEngagement` call site. */
export type UpsertEngagementInput = {
  userId: string;
  /**
   * Canonical category id resolved from the parent content row.
   * If null/empty/uncategorised-after-normalisation, the upsert is a
   * no-op (logged at debug level only).
   */
  categoryId: string | null | undefined;
  /**
   * 1 for a vote-like event (matchup, trending/opinion/sentiment/
   * induction). 0 for a pure prediction bet. Defaults to 0.
   */
  voteDelta?: number;
  /**
   * Credits staked on a prediction market bet. When present and > 0,
   * contributes min(3 * log1p(stake), PREDICTION_STAKE_WEIGHT_CAP) to
   * betWeight. Ignored for non-bet events.
   */
  stakeCredits?: number;
  /**
   * Free-form label used only in the warn log when the upsert fails —
   * e.g. "matchup-vote", "prediction-bet". Keeps the log greppable.
   */
  source: string;
};

/**
 * Fire-and-forget upsert into user_category_engagement.
 *
 * Contract:
 *   * Never throws. A thrown error in the calling route handler means
 *     something outside engagementWriter broke.
 *   * Returns true on success, false on skipped (no-op), and false on
 *     caught failure — callers should not branch on the return, it is
 *     intended for tests only.
 */
export async function upsertEngagement(
  input: UpsertEngagementInput,
): Promise<boolean> {
  const { userId, source } = input;
  if (!userId) {
    return false;
  }

  const categoryId = normaliseCategoryId(input.categoryId ?? null);
  if (!categoryId) {
    return false;
  }

  const voteDelta = Number.isFinite(input.voteDelta) ? Math.max(0, Math.floor(input.voteDelta as number)) : 0;
  const betWeightDelta =
    typeof input.stakeCredits === "number" ? stakeBetWeight(input.stakeCredits) : 0;

  if (voteDelta === 0 && betWeightDelta === 0) {
    return false;
  }

  try {
    await db
      .insert(userCategoryEngagement)
      .values({
        userId,
        categoryId,
        voteCount: voteDelta,
        betWeight: betWeightDelta.toFixed(3),
      })
      .onConflictDoUpdate({
        target: [userCategoryEngagement.userId, userCategoryEngagement.categoryId],
        set: {
          voteCount: sql`${userCategoryEngagement.voteCount} + ${voteDelta}`,
          betWeight: sql`${userCategoryEngagement.betWeight} + ${betWeightDelta.toFixed(3)}::numeric`,
          lastEngagedAt: sql`NOW()`,
          // firstEngagedAt intentionally omitted — it is set on insert
          // and must never update so the blend-anchor math stays stable.
        },
      });
    return true;
  } catch (err) {
    // Dual path: console.warn keeps the line in the pino-piped log
    // stream for local greppability; captureBackgroundError routes it
    // to Sentry when SENTRY_DSN is configured (no-op in dev). Engagement
    // writes are fire-and-forget, so we still swallow the error — this
    // is purely about making drift visible in observability.
    console.warn(
      `[engagementWriter] upsert failed source=${source} userId=${userId} categoryId=${categoryId}:`,
      err,
    );
    captureBackgroundError(err, {
      surface: "engagementWriter.upsert",
      source,
      userId,
      categoryId,
    });
    return false;
  }
}
