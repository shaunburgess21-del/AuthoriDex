// Phase 4 — anonymous voting budget logic.
//
// Two helpers behind a small, explicit contract:
//
//   getBudgetStatus(fdxSid)
//     Read-only. Returns the current { used, limit, remaining, exhausted }
//     for an anonymous identity. Used by GET /api/anon-budget on Vote-page
//     mount (Stage 4) and useAnonBudget (Stage 5).
//
//   consumeBudgetUnit(fdxSid, surfaceType, targetId)
//     Write path. Idempotent against the (fdx_sid, surface_type, target_id)
//     primary key — re-votes on the same target are free upserts. Returns:
//       consumed: true iff this call inserted a new row (new combo).
//       consumed: false iff the row already existed (re-vote / no-op).
//       newCount: count of rows for this fdx_sid AFTER this call.
//       exhausted: newCount >= ANON_VOTE_BUDGET (post-call snapshot).
//
//     The route handlers (Stage 4) gate on `exhausted` regardless of
//     `consumed`, so a re-vote attempted by an already-over-budget user
//     still rejects with 403 — which is the desired behaviour.
//
// Fail-open on DB error: budget enforcement is best-effort abuse
// prevention, not strict access control. A transient DB issue should
// lose budget signal, not break the anonymous vote flow. Both helpers
// catch internally and return a permissive fallback shape; Sentry
// captures the error so drift is observable. Route handlers therefore
// only need to check { exhausted } — they never see DB errors. This
// matches the engagementWriter philosophy from Phase 3: signal loss is
// cheaper than UX breakage. During fail-open windows, the per-IP cap
// in server/middleware/anonRateLimit.ts is the secondary defence
// against runaway abuse.
//
// On consumeBudgetUnit failure: { consumed: true, newCount: -1,
//   exhausted: false }. consumed: true tells the caller to persist the
//   vote; -1 is a sentinel signalling "untrusted count" (route handlers
//   ignore newCount for gating).
// On getBudgetStatus failure: { used: 0, limit, remaining: limit,
//   exhausted: false } — UI mirrors a full fresh budget.
//
// Empty-string fdxSid throws (contract violation, not a runtime branch
// to silently absorb). The Stage 2 middleware guarantees a non-empty
// cookie on /api/* paths; helpers called from other contexts (signup
// cleanup, future admin tools, tests) need to surface their own bugs.
//
// Cost note (v2 candidate): a typical Vote-page flow does one
// getBudgetStatus on mount plus one consumeBudgetUnit per attempt, each
// of which counts again — so 2–3 COUNT(*) queries per vote. Fine for v1
// because anon_vote_budget_sid_idx makes the count an index-only scan
// and we're not in a hot path. Revisit with an in-memory per-sid cache
// (5–10s TTL) if telemetry shows the queries adding latency.

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { anonVoteBudget } from "@shared/schema";
import { captureBackgroundError } from "../sentry";
import { ANON_VOTE_BUDGET } from "./rankingConfig";

export type BudgetStatus = {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
};

export type ConsumeResult = {
  consumed: boolean;
  newCount: number;
  exhausted: boolean;
};

export async function getBudgetStatus(fdxSid: string): Promise<BudgetStatus> {
  if (!fdxSid) throw new Error("anonBudget.getBudgetStatus: fdxSid required");

  const limit = ANON_VOTE_BUDGET;

  try {
    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(anonVoteBudget)
      .where(eq(anonVoteBudget.fdxSid, fdxSid));

    const used = row?.c ?? 0;
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      exhausted: used >= limit,
    };
  } catch (err) {
    console.warn(`[anonBudget] getBudgetStatus failed fdxSid=${fdxSid}:`, err);
    captureBackgroundError(err, {
      surface: "anonBudget.getBudgetStatus",
      fdxSid,
    });
    return { used: 0, limit, remaining: limit, exhausted: false };
  }
}

export async function consumeBudgetUnit(
  fdxSid: string,
  surfaceType: string,
  targetId: string,
): Promise<ConsumeResult> {
  if (!fdxSid) throw new Error("anonBudget.consumeBudgetUnit: fdxSid required");

  try {
    const [inserted] = await db
      .insert(anonVoteBudget)
      .values({ fdxSid, surfaceType, targetId })
      .onConflictDoNothing()
      .returning({ fdxSid: anonVoteBudget.fdxSid });

    const consumed = Boolean(inserted);

    const [countRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(anonVoteBudget)
      .where(eq(anonVoteBudget.fdxSid, fdxSid));

    const newCount = countRow?.c ?? 0;
    return {
      consumed,
      newCount,
      exhausted: newCount >= ANON_VOTE_BUDGET,
    };
  } catch (err) {
    console.warn(
      `[anonBudget] consumeBudgetUnit failed fdxSid=${fdxSid} surface=${surfaceType} target=${targetId}:`,
      err,
    );
    captureBackgroundError(err, {
      surface: "anonBudget.consumeBudgetUnit",
      fdxSid,
      surfaceType,
      targetId,
    });
    return { consumed: true, newCount: -1, exhausted: false };
  }
}
