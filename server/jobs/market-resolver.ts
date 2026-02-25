import { db } from "../db";
import { predictionMarkets, marketEntries, marketBets, trendSnapshots, profiles, creditLedger } from "@shared/schema";
import { eq, and, sql, inArray, lte, gte, desc, asc } from "drizzle-orm";
import { log } from "../vite";

const RESOLVER_INTERVAL_MS = 5 * 60 * 1000;
const RESOLVER_STARTUP_DELAY_MS = 2 * 60 * 1000;
const SNAPSHOT_TOLERANCE_HOURS = 3;

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
  blocked: number;
  skipped: number;
  errors: number;
  pendingAdmin: number;
}

let _resolverStats: ResolverStats = {
  lastRunAt: null,
  marketsFound: 0,
  resolved: 0,
  blocked: 0,
  skipped: 0,
  errors: 0,
  pendingAdmin: 0,
};

export function getResolverStats(): ResolverStats {
  return { ..._resolverStats };
}

export async function settleMarketBets(marketId: string, winnerEntryId: string): Promise<SettlementResult> {
  const [market] = await db.select({ status: predictionMarkets.status })
    .from(predictionMarkets).where(eq(predictionMarkets.id, marketId)).limit(1);
  if (market && (market.status === "RESOLVED" || market.status === "VOID")) {
    return { totalPool: 0, winnersCount: 0, losersCount: 0, payoutsDistributed: 0, remainder: 0, remainderPolicy: 'burned', alreadySettled: true };
  }

  const allBets = await db
    .select({
      id: marketBets.id,
      entryId: marketBets.entryId,
      userId: marketBets.userId,
      stakeAmount: marketBets.stakeAmount,
    })
    .from(marketBets)
    .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

  if (allBets.length === 0) {
    return { totalPool: 0, winnersCount: 0, losersCount: 0, payoutsDistributed: 0, remainder: 0, remainderPolicy: 'burned' };
  }

  const totalPool = allBets.reduce((sum, b) => sum + b.stakeAmount, 0);
  const winnerBets = allBets.filter(b => b.entryId === winnerEntryId);
  const winnerPool = winnerBets.reduce((sum, b) => sum + b.stakeAmount, 0);
  const now = new Date();
  let payoutsDistributed = 0;

  for (const bet of allBets) {
    if (bet.entryId === winnerEntryId) {
      const payout = winnerPool > 0 ? Math.round((bet.stakeAmount / winnerPool) * totalPool) : bet.stakeAmount;
      await db.update(marketBets)
        .set({ status: "won", settledAt: now, payoutAmount: payout })
        .where(eq(marketBets.id, bet.id));
      await db.update(profiles)
        .set({ predictCredits: sql`${profiles.predictCredits} + ${payout}` })
        .where(eq(profiles.id, bet.userId));

      const [updatedProfile] = await db.select({ predictCredits: profiles.predictCredits })
        .from(profiles).where(eq(profiles.id, bet.userId)).limit(1);
      await db.insert(creditLedger).values({
        userId: bet.userId,
        txnType: 'prediction_payout',
        amount: payout,
        walletType: 'VIRTUAL',
        balanceAfter: updatedProfile?.predictCredits ?? 0,
        source: 'market_settlement',
        idempotencyKey: `payout_${marketId}_${bet.id}`,
        metadata: { marketId, entryId: bet.entryId, betId: bet.id, stakeAmount: bet.stakeAmount, payout },
      }).onConflictDoNothing();

      payoutsDistributed += payout;
    } else {
      await db.update(marketBets)
        .set({ status: "lost", settledAt: now, payoutAmount: 0 })
        .where(eq(marketBets.id, bet.id));
    }
  }

  await db.update(marketEntries)
    .set({ resolutionStatus: "winner" })
    .where(eq(marketEntries.id, winnerEntryId));
  await db.update(marketEntries)
    .set({ resolutionStatus: "loser" })
    .where(and(eq(marketEntries.marketId, marketId), sql`${marketEntries.id} != ${winnerEntryId}`));

  const remainder = totalPool - payoutsDistributed;
  if (Math.abs(remainder) > 1) {
    console.log(`[PAYOUT REMAINDER LARGE] marketId=${marketId} remainder=${remainder} pool=${totalPool} winners=${winnerBets.length}`);
  }
  log(`[MarketResolver] Settlement: market=${marketId}, pool=${totalPool}, payouts=${payoutsDistributed}, remainder=${remainder} (burned), winners=${winnerBets.length}, losers=${allBets.length - winnerBets.length}`);

  return {
    totalPool,
    winnersCount: winnerBets.length,
    losersCount: allBets.length - winnerBets.length,
    payoutsDistributed,
    remainder,
    remainderPolicy: 'burned',
  };
}

export async function voidMarketBets(marketId: string): Promise<number> {
  const [market] = await db.select({ status: predictionMarkets.status })
    .from(predictionMarkets).where(eq(predictionMarkets.id, marketId)).limit(1);
  if (market && market.status === "VOID") {
    log(`[MarketResolver] Void skipped: market=${marketId} already VOID`);
    return 0;
  }

  const allBets = await db
    .select({ id: marketBets.id, userId: marketBets.userId, stakeAmount: marketBets.stakeAmount })
    .from(marketBets)
    .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

  if (allBets.length === 0) return 0;

  const now = new Date();
  for (const bet of allBets) {
    await db.update(marketBets)
      .set({ status: "refunded", settledAt: now, payoutAmount: bet.stakeAmount })
      .where(eq(marketBets.id, bet.id));
    await db.update(profiles)
      .set({ predictCredits: sql`${profiles.predictCredits} + ${bet.stakeAmount}` })
      .where(eq(profiles.id, bet.userId));

    const [updatedProfile] = await db.select({ predictCredits: profiles.predictCredits })
      .from(profiles).where(eq(profiles.id, bet.userId)).limit(1);
    await db.insert(creditLedger).values({
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

  await db.update(marketEntries)
    .set({ resolutionStatus: "void" })
    .where(eq(marketEntries.marketId, marketId));

  log(`[MarketResolver] Void: market=${marketId}, refunded=${allBets.length} bets`);
  return allBets.length;
}

function ensureDate(val: any): Date {
  if (val instanceof Date) return val;
  return new Date(val);
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
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — score unchanged",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie" }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] updown ${market.id}: VOID (tie), ${refunded} bets refunded`);
    return "voided";
  }

  const winnerId = closeSnap.score > openSnap.score ? upEntry.id : downEntry.id;
  const winnerLabel = closeSnap.score > openSnap.score ? "Up" : "Down";
  const result = await settleMarketBets(market.id, winnerId);

  await db.update(predictionMarkets).set({
    status: "RESOLVED",
    resolvedAt: new Date(),
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winnerLabel, settlement: result }),
    updatedAt: new Date(),
  }).where(eq(predictionMarkets.id, market.id));

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
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — identical scores",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie" }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] h2h ${market.id}: VOID (tie at ${closeA.score}), ${refunded} bets refunded`);
    return "voided";
  }

  const winner = closeA.score > closeB.score ? entryA : entryB;
  const result = await settleMarketBets(market.id, winner.id);

  await db.update(predictionMarkets).set({
    status: "RESOLVED",
    resolvedAt: new Date(),
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winner.label, settlement: result }),
    updatedAt: new Date(),
  }).where(eq(predictionMarkets.id, market.id));

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

  if (gains.length >= 2 && gains[0].pctChange === gains[1].pctChange) {
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
  const result = await settleMarketBets(market.id, winner.id);

  await db.update(predictionMarkets).set({
    status: "RESOLVED",
    resolvedAt: new Date(),
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winner.label, settlement: result }),
    updatedAt: new Date(),
  }).where(eq(predictionMarkets.id, market.id));

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

export async function resolveExpiredMarkets(): Promise<void> {
  try {
    const now = new Date();
    const expiredMarkets = await db
      .select()
      .from(predictionMarkets)
      .where(and(
        eq(predictionMarkets.status, "OPEN"),
        lte(predictionMarkets.endAt, now),
      ));

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

    _resolverStats = {
      lastRunAt: now.toISOString(),
      marketsFound: expiredMarkets.length,
      resolved,
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

export function startMarketResolverScheduler(): void {
  log("[MarketResolver] Starting scheduler (every 5 min, 2-min startup delay)");
  setTimeout(() => {
    resolveExpiredMarkets();
    setInterval(resolveExpiredMarkets, RESOLVER_INTERVAL_MS);
  }, RESOLVER_STARTUP_DELAY_MS);
}
