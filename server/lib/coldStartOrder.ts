// Phase 1 of the Interest Picker: cold-start ORDER BY helper.
//
// "Cold-start" = the requester has no signal of their own preferences yet.
// That covers two populations:
//
//   1. Anonymous visitors (no userId on the request).
//   2. Signed-in users who have not yet picked any interests in the modal
//      (statedInterests is empty). This includes "skipped" users until they
//      eventually opt in via Settings or the soft re-prompt.
//
// For these users we softly deprioritise contentious categories so the
// default "All" feeds don't lead with politics. Soft = sort matching rows
// AFTER non-matching rows but keep the existing tiebreaker (createdAt,
// featured, valueScore, etc.) within each bucket. No content is hidden,
// just reshuffled.
//
// Phase 2 will replace this with a personalised ranker keyed off
// statedInterests. The cold-start helper stays in place for users who
// haven't picked yet, so this file remains useful long-term.

import type { AnyColumn, SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import type { AuthRequest } from "../auth-middleware";

export const COLD_START_DEPRIORITISED = ["politics"] as const;

/**
 * SQL fragment producing 1 for deprioritised categories and 0 for everything
 * else. Use as the **first** ORDER BY term so the existing ordering becomes
 * the tiebreaker within each bucket.
 *
 *   .orderBy(coldStartCategoryRank(table.category), desc(table.createdAt))
 */
export function coldStartCategoryRank(col: AnyColumn | SQL): SQL {
  return sql`CASE WHEN ${col} = 'politics' THEN 1 ELSE 0 END`;
}

/**
 * Decide whether the cold-start ORDER BY should apply for the given request.
 *
 * - No userId      -> always cold-start (anonymous).
 * - userId set     -> read statedInterests once, cold-start when empty/null.
 *
 * Per-request memoisation: each Express request is a fresh object, so we
 * stash the resolved boolean on the request itself to avoid hitting the DB
 * twice if a single endpoint composes multiple ordered queries.
 */
type ColdStartCacheBag = AuthRequest & { __coldStart?: boolean };

export async function shouldUseColdStart(req: AuthRequest): Promise<boolean> {
  const bag = req as ColdStartCacheBag;
  if (typeof bag.__coldStart === "boolean") {
    return bag.__coldStart;
  }

  const userId = req.userId;
  if (!userId) {
    bag.__coldStart = true;
    return true;
  }

  try {
    const [row] = await db
      .select({ statedInterests: profiles.statedInterests })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    const interests = row?.statedInterests ?? [];
    const cold = !Array.isArray(interests) || interests.length === 0;
    bag.__coldStart = cold;
    return cold;
  } catch (err) {
    // If the lookup fails (e.g. a transient DB blip) prefer the cold-start
    // ordering — it's the safer "least surprising" feed for both user
    // populations and avoids leaking politics-heavy content on errors.
    console.error("[coldStartOrder] shouldUseColdStart lookup failed:", err);
    bag.__coldStart = true;
    return true;
  }
}
