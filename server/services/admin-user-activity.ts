/**
 * Unified admin user activity feed: credit_ledger + vote_actions.
 */

import { db } from "../db";
import {
  creditLedger,
  emailUnsubscribeState,
  profiles,
  voteActions,
  type CreditLedger,
  type VoteAction,
} from "@shared/schema";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { enrichCreditHistoryRows } from "./credit-history-display";
import { enrichVoteActionRows } from "./vote-action-display";

export type ActivityFilter = "all" | "credit" | "vote";

export type AdminCreditActivityEntry = {
  kind: "credit";
  id: string;
  createdAt: Date;
  txnType: string;
  amount: number;
  balanceAfter: number;
  displayTitle: string;
  displaySubtitle?: string;
  href?: string;
};

export type AdminVoteActivityEntry = {
  kind: "vote";
  id: string;
  createdAt: Date;
  voteType: string;
  actionKind: string;
  displayTitle: string;
  displaySubtitle?: string;
  href?: string;
};

export type AdminActivityEntry = AdminCreditActivityEntry | AdminVoteActivityEntry;

export type AdminUserActivityResult = {
  profile: {
    id: string;
    username: string | null;
    email: string | null;
    role: string;
    rank: string;
    xpPoints: number;
    predictCredits: number;
    totalVotes: number;
    totalPredictions: number;
    winRate: number;
    createdAt: Date;
    emailMarketingUnsubscribed: boolean;
    emailMarketingUnsubscribedAt: Date | null;
    emailMarketingUnsubscribeSource: string | null;
    /** User's own share code ("VX" + 6 chars); null if never generated. */
    referralCode: string | null;
    /** Who referred this user (null when organic). */
    referredBy: { id: string; username: string | null } | null;
    /** How many users signed up via this user's referral link. */
    referredCount: number;
  };
  ledgerSum: number;
  drift: number;
  entries: AdminActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ActivityPageRow = {
  id: string;
  kind: "credit" | "vote";
  created_at: Date;
};

export async function getAdminUserActivityHistory(
  userId: string,
  page: number,
  pageSize: number,
  filter: ActivityFilter,
  authEmail: string | null,
): Promise<AdminUserActivityResult | null> {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!profile) return null;

  const [{ count: creditCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));

  const [{ count: voteCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(voteActions)
    .where(eq(voteActions.userId, userId));

  const total =
    filter === "credit"
      ? Number(creditCount)
      : filter === "vote"
        ? Number(voteCount)
        : Number(creditCount) + Number(voteCount);

  const offset = (page - 1) * pageSize;

  const pageRows = await fetchActivityPage(userId, pageSize, offset, filter);

  const creditIds = pageRows.filter((r) => r.kind === "credit").map((r) => r.id);
  const voteIds = pageRows.filter((r) => r.kind === "vote").map((r) => r.id);

  const [creditRows, voteRows] = await Promise.all([
    creditIds.length > 0
      ? db
          .select()
          .from(creditLedger)
          .where(inArray(creditLedger.id, creditIds))
      : Promise.resolve([] as CreditLedger[]),
    voteIds.length > 0
      ? db
          .select()
          .from(voteActions)
          .where(inArray(voteActions.id, voteIds))
      : Promise.resolve([] as VoteAction[]),
  ]);

  const [enrichedCredits, enrichedVotes] = await Promise.all([
    enrichCreditHistoryRows(creditRows),
    enrichVoteActionRows(voteRows),
  ]);

  const creditById = new Map(enrichedCredits.map((r) => [r.id, r]));
  const voteById = new Map(enrichedVotes.map((r) => [r.id, r]));

  const entries: AdminActivityEntry[] = [];
  for (const row of pageRows) {
    if (row.kind === "credit") {
      const c = creditById.get(row.id);
      if (!c) continue;
      entries.push({
        kind: "credit",
        id: c.id,
        createdAt: c.createdAt,
        txnType: c.txnType,
        amount: c.amount,
        balanceAfter: c.balanceAfter,
        displayTitle: c.displayTitle,
        displaySubtitle: c.displaySubtitle,
        href: c.href,
      });
    } else {
      const v = voteById.get(row.id);
      if (!v) continue;
      entries.push({
        kind: "vote",
        id: v.id,
        createdAt: v.createdAt,
        voteType: v.voteType,
        actionKind: v.actionKind,
        displayTitle: v.displayTitle,
        displaySubtitle: v.displaySubtitle,
        href: v.href,
      });
    }
  }

  const allAmounts = await db
    .select({ amount: creditLedger.amount })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  const ledgerSum = allAmounts.reduce((s, h) => s + h.amount, 0);
  const drift = profile.predictCredits - ledgerSum;

  const [unsubscribeState] = await db
    .select({
      source: emailUnsubscribeState.source,
      unsubscribedAt: emailUnsubscribeState.unsubscribedAt,
    })
    .from(emailUnsubscribeState)
    .where(eq(emailUnsubscribeState.userId, userId))
    .limit(1);

  // Referral attribution: who referred this user + how many users they
  // referred themselves.
  const [referrerRow, [referredCountRow]] = await Promise.all([
    profile.referredBy
      ? db
          .select({ id: profiles.id, username: profiles.username })
          .from(profiles)
          .where(eq(profiles.id, profile.referredBy))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(profiles)
      .where(eq(profiles.referredBy, userId)),
  ]);

  return {
    profile: {
      id: profile.id,
      username: profile.username,
      email: authEmail,
      role: profile.role,
      rank: profile.rank,
      xpPoints: profile.xpPoints,
      predictCredits: profile.predictCredits,
      totalVotes: profile.totalVotes,
      totalPredictions: profile.totalPredictions,
      winRate: profile.winRate,
      createdAt: profile.createdAt,
      emailMarketingUnsubscribed: Boolean(unsubscribeState),
      emailMarketingUnsubscribedAt: unsubscribeState?.unsubscribedAt ?? null,
      emailMarketingUnsubscribeSource: unsubscribeState?.source ?? null,
      referralCode: profile.referralCode ?? null,
      referredBy: referrerRow
        ? { id: referrerRow.id, username: referrerRow.username }
        : null,
      referredCount: Number(referredCountRow?.count ?? 0),
    },
    ledgerSum,
    drift,
    entries,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

async function fetchActivityPage(
  userId: string,
  pageSize: number,
  offset: number,
  filter: ActivityFilter,
): Promise<ActivityPageRow[]> {
  if (filter === "credit") {
    const rows = await db
      .select({
        id: creditLedger.id,
        created_at: creditLedger.createdAt,
      })
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .orderBy(desc(creditLedger.createdAt))
      .limit(pageSize)
      .offset(offset);
    return rows.map((r) => ({
      id: r.id,
      kind: "credit" as const,
      created_at: r.created_at,
    }));
  }

  if (filter === "vote") {
    const rows = await db
      .select({
        id: voteActions.id,
        created_at: voteActions.createdAt,
      })
      .from(voteActions)
      .where(eq(voteActions.userId, userId))
      .orderBy(desc(voteActions.createdAt))
      .limit(pageSize)
      .offset(offset);
    return rows.map((r) => ({
      id: r.id,
      kind: "vote" as const,
      created_at: r.created_at,
    }));
  }

  const result = await db.execute(sql`
    SELECT id, kind, created_at FROM (
      SELECT id, 'credit'::text AS kind, created_at
      FROM credit_ledger
      WHERE user_id = ${userId}
      UNION ALL
      SELECT id, 'vote'::text AS kind, created_at
      FROM vote_actions
      WHERE user_id = ${userId}
    ) AS activity
    ORDER BY created_at DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `);

  const raw = (result as { rows: Record<string, unknown>[] }).rows ?? [];
  return raw.map((row) => ({
    id: String(row.id),
    kind: row.kind === "vote" ? ("vote" as const) : ("credit" as const),
    created_at: row.created_at instanceof Date
      ? row.created_at
      : new Date(String(row.created_at)),
  }));
}
