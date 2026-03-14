import { db, withDbAdvisoryLock } from "../db";
import { predictionMarkets, marketEntries, marketBets, trendSnapshots, profiles, creditLedger } from "@shared/schema";
import { eq, and, sql, inArray, lte, gte, desc, asc } from "drizzle-orm";
import { log } from "../log";
import { calculateSettlementPayouts } from "./settlement-utils";
import { scoreResolvedMarket } from "../agents/performanceUpdater";

const RESOLVER_INTERVAL_MS = 5 * 60 * 1000;
const RESOLVER_STARTUP_DELAY_MS = 2 * 60 * 1000;
const SNAPSHOT_TOLERANCE_HOURS = 3;
const MARKET_RESOLVER_LOCK_KEY = 5_202;

let _lastResolverRunAt: Date | null = null;
export function getLastResolverRunAt(): Date | null { return _lastResolverRunAt; }

interface SettlementResult {
  totalPool: number;
  winnersCount: number;
  losersCount: number;
  payoutsDistributed: number;
  remainder: number;
  remainderPolicy: 'burned';
  alreadySettled?: boolean;
}

interface ResolverStats {
  lastRunAt: string | null;
  marketsFound: number;
  resolved: number;
  voided: number;
  blocked: number;
  skipped: number;
  errors: number;
  pendingAdmin: number;
}

let _resolverStats: ResolverStats = {
  lastRunAt: null,
  marketsFound: 0,
  resolved: 0,
  voided: 0,
  blocked: 0,
  skipped: 0,
  errors: 0,
  pendingAdmin: 0,
};

export function getResolverStats(): ResolverStats {
  return { ..._resolverStats };
}

export interface SettlementMeta {
  resolveMethod?: string;
  resolutionNotes?: string;
  settledBy?: string;
  voidReason?: string | null;
}

export async function settleMarketBets(marketId: string, winnerEntryId: string, meta?: SettlementMeta): Promise<SettlementResult> {
  const result = await db.transaction(async (tx) => {
    const now = new Date();

    const [winnerEntry] = await tx
      .select({ id: marketEntries.id })
      .from(marketEntries)
      .where(and(eq(marketEntries.id, winnerEntryId), eq(marketEntries.marketId, marketId)));
    if (!winnerEntry) {
      throw new Error(`Entry ${winnerEntryId} does not belong to market ${marketId}`);
    }

    const claimed = await tx
      .update(predictionMarkets)
      .set({
        status: "RESOLVED",
        resolvedAt: now,
        updatedAt: now,
        ...(meta?.resolveMethod && { resolveMethod: meta.resolveMethod }),
        ...(meta?.resolutionNotes && { resolutionNotes: meta.resolutionNotes }),
        ...(meta?.settledBy && { settledBy: meta.settledBy }),
        ...(meta?.voidReason !== undefined && { voidReason: meta.voidReason }),
      })
      .where(and(
        eq(predictionMarkets.id, marketId),
        sql`${predictionMarkets.status} NOT IN ('RESOLVED', 'VOID')`
      ))
      .returning({ id: predictionMarkets.id });

    if (claimed.length === 0) {
      return {
        totalPool: 0,
        winnersCount: 0,
        losersCount: 0,
        payoutsDistributed: 0,
        remainder: 0,
        remainderPolicy: 'burned' as const,
        alreadySettled: true,
      };
    }

    const allBets = await tx
      .select({
        id: marketBets.id,
        entryId: marketBets.entryId,
        userId: marketBets.userId,
        stakeAmount: marketBets.stakeAmount,
      })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

    if (allBets.length === 0) {
      await tx.update(marketEntries)
        .set({ resolutionStatus: "winner" })
        .where(eq(marketEntries.id, winnerEntryId));
      await tx.update(marketEntries)
        .set({ resolutionStatus: "loser" })
        .where(and(eq(marketEntries.marketId, marketId), sql`${marketEntries.id} != ${winnerEntryId}`));

      return {
        totalPool: 0,
        winnersCount: 0,
        losersCount: 0,
        payoutsDistributed: 0,
        remainder: 0,
        remainderPolicy: 'burned' as const,
      };
    }

    const preview = calculateSettlementPayouts(allBets, winnerEntryId);
    const payoutByBetId = new Map(preview.payouts.map((entry) => [entry.betId, entry.payout]));

    for (const bet of allBets) {
      if (bet.entryId === winnerEntryId) {
        const payout = payoutByBetId.get(bet.id) ?? bet.stakeAmount;
        await tx.update(marketBets)
          .set({ status: "won", settledAt: now, payoutAmount: payout })
          .where(and(eq(marketBets.id, bet.id), eq(marketBets.status, "active")));

        const [updatedProfile] = await tx.update(profiles)
          .set({ predictCredits: sql`${profiles.predictCredits} + ${payout}` })
          .where(eq(profiles.id, bet.userId))
          .returning({ predictCredits: profiles.predictCredits });

        await tx.insert(creditLedger).values({
          userId: bet.userId,
          txnType: 'prediction_payout',
          amount: payout,
          walletType: 'VIRTUAL',
          balanceAfter: updatedProfile?.predictCredits ?? 0,
          source: 'market_settlement',
          idempotencyKey: `payout_${marketId}_${bet.id}`,
          metadata: { marketId, entryId: bet.entryId, betId: bet.id, stakeAmount: bet.stakeAmount, payout },
        }).onConflictDoNothing();
      } else {
        await tx.update(marketBets)
          .set({ status: "lost", settledAt: now, payoutAmount: 0 })
          .where(and(eq(marketBets.id, bet.id), eq(marketBets.status, "active")));
      }
    }

    await tx.update(marketEntries)
      .set({ resolutionStatus: "winner" })
      .where(eq(marketEntries.id, winnerEntryId));
    await tx.update(marketEntries)
      .set({ resolutionStatus: "loser" })
      .where(and(eq(marketEntries.marketId, marketId), sql`${marketEntries.id} != ${winnerEntryId}`));

    const uniqueUserIds = Array.from(new Set(allBets.map(b => b.userId)));
    for (const userId of uniqueUserIds) {
      const resolvedBets = await tx
        .select({ status: marketBets.status, settledAt: marketBets.settledAt })
        .from(marketBets)
        .where(and(
          eq(marketBets.userId, userId),
          sql`${marketBets.status} IN ('won', 'lost')`,
        ));

      const wonCount = resolvedBets.filter(b => b.status === 'won').length;
      const totalResolved = resolvedBets.length;
      const winRate = totalResolved > 0
        ? Math.round((wonCount / totalResolved) * 1000) / 10
        : 0;

      const sortedDesc = resolvedBets
        .filter(b => b.settledAt != null)
        .sort((a, b) => new Date(b.settledAt!).getTime() - new Date(a.settledAt!).getTime());

      let currentStreak = 0;
      for (const bet of sortedDesc) {
        if (bet.status === 'won') currentStreak++;
        else break;
      }

      await tx.update(profiles)
        .set({ winRate, currentStreak })
        .where(eq(profiles.id, userId));
    }

    return {
      totalPool: preview.totalPool,
      winnersCount: preview.winnerBets.length,
      losersCount: allBets.length - preview.winnerBets.length,
      payoutsDistributed: preview.payoutsDistributed,
      remainder: preview.remainder,
      remainderPolicy: 'burned' as const,
    };
  });

  const remainder = result.totalPool - result.payoutsDistributed;
  if (Math.abs(remainder) > 1) {
    console.log(`[PAYOUT REMAINDER LARGE] marketId=${marketId} remainder=${remainder} pool=${result.totalPool} winners=${result.winnersCount}`);
  }
  log(`[MarketResolver] Settlement: market=${marketId}, pool=${result.totalPool}, payouts=${result.payoutsDistributed}, remainder=${remainder} (burned), winners=${result.winnersCount}, losers=${result.losersCount}`);

  return result;
}

export async function voidMarketBets(marketId: string): Promise<number> {
  const refundedCount = await db.transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx
      .update(predictionMarkets)
      .set({ status: "VOID", resolvedAt: now, updatedAt: now })
      .where(and(
        eq(predictionMarkets.id, marketId),
        sql`${predictionMarkets.status} NOT IN ('VOID', 'RESOLVED')`
      ))
      .returning({ id: predictionMarkets.id });

    if (claimed.length === 0) {
      log(`[MarketResolver] Void skipped: market=${marketId} already settled`);
      return 0;
    }

    const allBets = await tx
      .select({ id: marketBets.id, userId: marketBets.userId, stakeAmount: marketBets.stakeAmount })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

    for (const bet of allBets) {
      await tx.update(marketBets)
        .set({ status: "refunded", settledAt: now, payoutAmount: bet.stakeAmount })
        .where(and(eq(marketBets.id, bet.id), eq(marketBets.status, "active")));

      const [updatedProfile] = await tx.update(profiles)
        .set({ predictCredits: sql`${profiles.predictCredits} + ${bet.stakeAmount}` })
        .where(eq(profiles.id, bet.userId))
        .returning({ predictCredits: profiles.predictCredits });

      await tx.insert(creditLedger).values({
        userId: bet.userId,
        txnType: 'prediction_refund',
        amount: bet.stakeAmount,
        walletType: 'VIRTUAL',
        balanceAfter: updatedProfile?.predictCredits ?? 0,
        source: 'market_void',
        idempotencyKey: `refund_${marketId}_${bet.id}`,
        metadata: { marketId, betId: bet.id, stakeAmount: bet.stakeAmount },
      }).onConflictDoNothing();
    }

    await tx.update(marketEntries)
      .set({ resolutionStatus: "void" })
      .where(eq(marketEntries.marketId, marketId));

    return allBets.length;
  });

  log(`[MarketResolver] Void: market=${marketId}, refunded=${refundedCount} bets`);
  return refundedCount;
}

function ensureDate(val: any): Date {
  if (val instanceof Date) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return new Date();
  return d;
}

function getStoredOpeningScore(market: any, personId: string): { score: number; capturedAt: Date } | null {
  const meta = market.metadata;
  if (!meta) return null;

  if (meta.openingScore && meta.openingScore.personId === personId) {
    return { score: meta.openingScore.score, capturedAt: ensureDate(meta.openingScore.snapshotAt) };
  }

  if (Array.isArray(meta.openingScores)) {
    const match = meta.openingScores.find((s: any) => s.personId === personId);
    if (match) {
      return { score: match.score, capturedAt: ensureDate(match.snapshotAt) };
    }
  }

  return null;
}

async function findSnapshotScore(personId: string, rawTargetTime: Date | string, direction: "before" | "after"): Promise<{ score: number; capturedAt: Date } | null> {
  const targetTime = ensureDate(rawTargetTime);
  const toleranceMs = SNAPSHOT_TOLERANCE_HOURS * 60 * 60 * 1000;

  if (direction === "before") {
    const rows = await db
      .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
      .from(trendSnapshots)
      .where(and(
        eq(trendSnapshots.personId, personId),
        lte(trendSnapshots.timestamp, targetTime),
        gte(trendSnapshots.timestamp, new Date(targetTime.getTime() - toleranceMs)),
      ))
      .orderBy(desc(trendSnapshots.timestamp))
      .limit(1);
    if (rows.length > 0 && rows[0].fameIndex != null) {
      return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp) };
    }
  }

  if (direction === "after") {
    const rows = await db
      .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
      .from(trendSnapshots)
      .where(and(
        eq(trendSnapshots.personId, personId),
        gte(trendSnapshots.timestamp, targetTime),
        lte(trendSnapshots.timestamp, new Date(targetTime.getTime() + 60 * 60 * 1000)),
      ))
      .orderBy(asc(trendSnapshots.timestamp))
      .limit(1);
    if (rows.length > 0 && rows[0].fameIndex != null) {
      return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp) };
    }
  }

  return null;
}

async function getCloseSnapshot(personId: string, endAt: Date): Promise<{ score: number; capturedAt: Date } | null> {
  return (await findSnapshotScore(personId, endAt, "before"))
    ?? (await findSnapshotScore(personId, endAt, "after"));
}

async function getOpenSnapshot(personId: string, rawStartAt: Date | string, market: any): Promise<{ score: number; capturedAt: Date } | null> {
  const stored = getStoredOpeningScore(market, personId);
  if (stored) return stored;

  const startAt = ensureDate(rawStartAt);
  const result = (await findSnapshotScore(personId, startAt, "after"))
    ?? (await findSnapshotScore(personId, startAt, "before"));
  if (result) return result;

  const hasMetadataScores = market.metadata?.openingScore || market.metadata?.openingScores;
  if (hasMetadataScores) {
    return null;
  }

  log(`[MarketResolver] Using wide-tolerance fallback for legacy market ${market.id}`);
  const wideRows = await db
    .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      gte(trendSnapshots.timestamp, new Date(startAt.getTime() - 7 * 24 * 60 * 60 * 1000)),
      lte(trendSnapshots.timestamp, new Date(startAt.getTime() + 24 * 60 * 60 * 1000)),
    ))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${trendSnapshots.timestamp} - ${startAt}::timestamp))`)
    .limit(1);
  if (wideRows.length > 0 && wideRows[0].fameIndex != null) {
    return { score: wideRows[0].fameIndex, capturedAt: ensureDate(wideRows[0].timestamp) };
  }
  return null;
}

async function resolveUpDown(market: any): Promise<"resolved" | "voided" | "blocked"> {
  const personId = market.personId;
  if (!personId) {
    log(`[MarketResolver] updown ${market.id}: no personId, skipping`);
    return "blocked";
  }

  const entries = await db.select().from(marketEntries).where(eq(marketEntries.marketId, market.id));
  const upEntry = entries.find(e => e.label?.toLowerCase() === "up");
  const downEntry = entries.find(e => e.label?.toLowerCase() === "down");
  if (!upEntry || !downEntry) {
    log(`[MarketResolver] updown ${market.id}: missing Up/Down entries, skipping`);
    return "blocked";
  }

  const openSnap = await getOpenSnapshot(personId, market.startAt, market);
  const closeSnap = await getCloseSnapshot(personId, market.endAt);
  if (!openSnap || !closeSnap) {
    log(`[MarketResolver] updown ${market.id}: missing snapshots (open=${!!openSnap}, close=${!!closeSnap}), marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  const evidence = {
    type: "updown",
    personId,
    openScore: openSnap.score,
    openSnapshotAt: openSnap.capturedAt.toISOString(),
    closeScore: closeSnap.score,
    closeSnapshotAt: closeSnap.capturedAt.toISOString(),
    change: closeSnap.score - openSnap.score,
    percentChange: openSnap.score > 0 ? ((closeSnap.score - openSnap.score) / openSnap.score * 100).toFixed(2) + "%" : "N/A",
  };

  if (closeSnap.score === openSnap.score) {
    const tieRule = market.tieRule || "refund";
    if (tieRule === "up_wins" || tieRule === "down_wins") {
      const tieWinnerId = tieRule === "up_wins" ? upEntry.id : downEntry.id;
      const tieWinnerLabel = tieRule === "up_wins" ? "Up" : "Down";
      const result = await settleMarketBets(market.id, tieWinnerId, {
        resolveMethod: "auto",
        resolutionNotes: JSON.stringify({ ...evidence, outcome: tieWinnerLabel, tieRule }),
      });
      log(`[MarketResolver] updown ${market.id}: tie resolved by tieRule=${tieRule}, ${tieWinnerLabel} wins, pool=${result.totalPool}`);
      scoreResolvedMarket(market.id, tieWinnerId).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));
      return "resolved";
    }
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — score unchanged",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie", tieRule }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] updown ${market.id}: VOID (tie), ${refunded} bets refunded`);
    return "voided";
  }

  const winnerId = closeSnap.score > openSnap.score ? upEntry.id : downEntry.id;
  const winnerLabel = closeSnap.score > openSnap.score ? "Up" : "Down";
  const result = await settleMarketBets(market.id, winnerId, {
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winnerLabel }),
  });

  scoreResolvedMarket(market.id, winnerId).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));

  log(`[MarketResolver] updown ${market.id}: ${winnerLabel} wins (${openSnap.score} → ${closeSnap.score}), pool=${result.totalPool}, winners=${result.winnersCount}`);
  return "resolved";
}

async function resolveH2H(market: any): Promise<"resolved" | "voided" | "blocked"> {
  const entries = await db.select().from(marketEntries).where(eq(marketEntries.marketId, market.id));
  if (entries.length !== 2) {
    log(`[MarketResolver] h2h ${market.id}: expected 2 entries, got ${entries.length}, skipping`);
    return "blocked";
  }

  const [entryA, entryB] = entries.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  if (!entryA.personId || !entryB.personId) {
    log(`[MarketResolver] h2h ${market.id}: entries missing personId, skipping`);
    return "blocked";
  }

  const closeA = await getCloseSnapshot(entryA.personId, market.endAt);
  const closeB = await getCloseSnapshot(entryB.personId, market.endAt);
  if (!closeA || !closeB) {
    log(`[MarketResolver] h2h ${market.id}: missing close snapshots, marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  const evidence = {
    type: "h2h",
    entryA: { personId: entryA.personId, label: entryA.label, score: closeA.score, snapshotAt: closeA.capturedAt.toISOString() },
    entryB: { personId: entryB.personId, label: entryB.label, score: closeB.score, snapshotAt: closeB.capturedAt.toISOString() },
  };

  if (closeA.score === closeB.score) {
    const tieRule = market.tieRule || "refund";
    if (tieRule === "up_wins" || tieRule === "down_wins") {
      const tieWinner = tieRule === "up_wins" ? entryA : entryB;
      const result = await settleMarketBets(market.id, tieWinner.id, {
        resolveMethod: "auto",
        resolutionNotes: JSON.stringify({ ...evidence, outcome: tieWinner.label, tieRule }),
      });
      log(`[MarketResolver] h2h ${market.id}: tie resolved by tieRule=${tieRule}, ${tieWinner.label} wins, pool=${result.totalPool}`);
      scoreResolvedMarket(market.id, tieWinner.id).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));
      return "resolved";
    }
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — identical scores",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie", tieRule }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] h2h ${market.id}: VOID (tie at ${closeA.score}), ${refunded} bets refunded`);
    return "voided";
  }

  const winner = closeA.score > closeB.score ? entryA : entryB;
  const result = await settleMarketBets(market.id, winner.id, {
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winner.label }),
  });

  scoreResolvedMarket(market.id, winner.id).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));

  log(`[MarketResolver] h2h ${market.id}: ${winner.label} wins (${closeA.score} vs ${closeB.score}), pool=${result.totalPool}`);
  return "resolved";
}

async function resolveGainer(market: any): Promise<"resolved" | "voided" | "blocked"> {
  const entries = await db.select().from(marketEntries).where(eq(marketEntries.marketId, market.id));
  if (entries.length === 0) {
    log(`[MarketResolver] gainer ${market.id}: no entries, skipping`);
    return "blocked";
  }

  const entriesWithPersonId = entries.filter(e => e.personId);
  if (entriesWithPersonId.length === 0) {
    log(`[MarketResolver] gainer ${market.id}: no entries with personId, skipping`);
    return "blocked";
  }

  const gains: { entry: typeof entries[0]; openScore: number; closeScore: number; pctChange: number }[] = [];

  for (const entry of entriesWithPersonId) {
    const openSnap = await getOpenSnapshot(entry.personId!, market.startAt, market);
    const closeSnap = await getCloseSnapshot(entry.personId!, market.endAt);
    if (!openSnap || !closeSnap) continue;
    const pctChange = openSnap.score > 0 ? ((closeSnap.score - openSnap.score) / openSnap.score) * 100 : 0;
    gains.push({ entry, openScore: openSnap.score, closeScore: closeSnap.score, pctChange });
  }

  if (gains.length === 0) {
    log(`[MarketResolver] gainer ${market.id}: no valid snapshots for any entry, marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  gains.sort((a, b) => b.pctChange - a.pctChange);

  const evidence = {
    type: "gainer",
    rankings: gains.map(g => ({
      personId: g.entry.personId,
      label: g.entry.label,
      openScore: g.openScore,
      closeScore: g.closeScore,
      pctChange: g.pctChange.toFixed(2) + "%",
    })),
  };

  if (gains.length >= 2 && Math.abs(gains[0].pctChange - gains[1].pctChange) < 0.001) {
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — identical top gain percentage",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie" }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] gainer ${market.id}: VOID (tied at ${gains[0].pctChange.toFixed(2)}%), ${refunded} bets refunded`);
    return "voided";
  }

  const winner = gains[0].entry;
  const result = await settleMarketBets(market.id, winner.id, {
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winner.label }),
  });

  scoreResolvedMarket(market.id, winner.id).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));

  log(`[MarketResolver] gainer ${market.id}: ${winner.label} wins (+${gains[0].pctChange.toFixed(2)}%), pool=${result.totalPool}`);
  return "resolved";
}

async function resolveJackpot(market: any): Promise<"resolved" | "blocked"> {
  const personId = market.personId;
  if (!personId) {
    log(`[MarketResolver] jackpot ${market.id}: no personId, skipping`);
    return "blocked";
  }

  const closeSnap = await getCloseSnapshot(personId, market.endAt);

  const evidence: any = {
    type: "jackpot",
    pendingReason: "jackpot_requires_manual_cleanup",
    personId,
    closeScore: closeSnap?.score ?? null,
    closeSnapshotAt: closeSnap?.capturedAt?.toISOString() ?? null,
  };

  await db.update(predictionMarkets).set({
    status: "CLOSED_PENDING",
    resolutionNotes: JSON.stringify(evidence),
    updatedAt: new Date(),
  }).where(eq(predictionMarkets.id, market.id));

  log(`[MarketResolver] jackpot ${market.id}: moved to CLOSED_PENDING (closeScore=${closeSnap?.score ?? 'N/A'})`);
  return "resolved";
}

async function resolveExpiredMarketsOnce(): Promise<void> {
  try {
    const now = new Date();
    const expiredMarkets = await db
      .select()
      .from(predictionMarkets)
      .where(and(
        eq(predictionMarkets.status, "OPEN"),
        lte(predictionMarkets.endAt, now),
      ));

    _lastResolverRunAt = now;
    if (expiredMarkets.length === 0) {
      _resolverStats.lastRunAt = now.toISOString();
      _resolverStats.marketsFound = 0;
      return;
    }

    log(`[MarketResolver] Found ${expiredMarkets.length} expired market(s) to process`);

    let resolved = 0, voided = 0, pending = 0, skipped = 0, blocked = 0, errors = 0;

    for (const market of expiredMarkets) {
      try {
        let outcome: "resolved" | "voided" | "blocked";
        switch (market.marketType) {
          case "updown":
            outcome = await resolveUpDown(market);
            if (outcome === "resolved") resolved++;
            else if (outcome === "voided") voided++;
            else blocked++;
            break;
          case "h2h":
            outcome = await resolveH2H(market);
            if (outcome === "resolved") resolved++;
            else if (outcome === "voided") voided++;
            else blocked++;
            break;
          case "gainer":
            outcome = await resolveGainer(market);
            if (outcome === "resolved") resolved++;
            else if (outcome === "voided") voided++;
            else blocked++;
            break;
          case "community":
            await db.update(predictionMarkets).set({
              status: "CLOSED_PENDING",
              resolutionNotes: JSON.stringify({
                type: "community",
                pendingReason: "community_requires_manual_resolution",
              }),
              updatedAt: new Date(),
            }).where(eq(predictionMarkets.id, market.id));
            pending++;
            break;
          case "jackpot":
            outcome = await resolveJackpot(market);
            if (outcome === "resolved") pending++;
            else blocked++;
            break;
          default:
            log(`[MarketResolver] Unknown type '${market.marketType}' for market ${market.id}, skipping`);
            skipped++;
        }
      } catch (err: any) {
        log(`[MarketResolver] Error resolving ${market.marketType} market ${market.id}: ${err?.stack || err}`);
        errors++;
      }
    }

    _lastResolverRunAt = now;
    _resolverStats = {
      lastRunAt: now.toISOString(),
      marketsFound: expiredMarkets.length,
      resolved,
      voided,
      blocked,
      skipped,
      errors,
      pendingAdmin: pending,
    };

    log(`[MarketResolver] Done: ${resolved} resolved, ${voided} voided, ${pending} pending admin, ${blocked} blocked, ${skipped} skipped, ${errors} errors`);
  } catch (err) {
    log(`[MarketResolver] Scheduler error: ${err}`);
  }
}

export async function resolveExpiredMarkets(): Promise<void> {
  const locked = await withDbAdvisoryLock(
    MARKET_RESOLVER_LOCK_KEY,
    "MarketResolver",
    resolveExpiredMarketsOnce,
  );

  if (!locked.acquired) {
    log("[MarketResolver] Skipping run; another resolver instance holds the lock");
  }
}

export function startMarketResolverScheduler(): void {
  log("[MarketResolver] Starting scheduler (every 5 min, 2-min startup delay)");
  setTimeout(() => {
    resolveExpiredMarkets();
    setInterval(resolveExpiredMarkets, RESOLVER_INTERVAL_MS);
  }, RESOLVER_STARTUP_DELAY_MS);
}
