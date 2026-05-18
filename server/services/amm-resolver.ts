/**
 * AMM market settlement — Phase 3 of the parimutuel -> AMM rebuild.
 *
 * `resolveAmmMarket` is the single entry point that takes an AMM
 * market from CLOSED_PENDING (or OPEN, for tests) to RESOLVED, paying
 * out winning shares, marking buy rows as won/lost, and returning
 * the seed (plus net user credits in, minus payout liability) to the
 * house via Phase 2's `returnAmmSeedAtSettlement`.
 *
 * Two paths:
 *   - Winner path: `winnerEntryId` set, `voidMarket=false`. Each user
 *     with positive netShares on the winner gets `floor(netShares)`
 *     credits. Buy rows on the winner go status='won'; on losers go
 *     status='lost'. Sell rows already settled at sell time stay
 *     status='settled'.
 *   - Void path: `voidMarket=true`. Every user gets refunded their
 *     net credits in (sum of buys' stakeAmount + sum of sells'
 *     stakeAmount, since sells store stakeAmount as negative). House
 *     gets back exactly the seed.
 *
 * Idempotent end-to-end: each user's payout uses an idempotency key
 * `amm_payout_${marketId}_${userId}` (or `amm_void_refund_...`).
 * `returnAmmSeedAtSettlement` is keyed on `amm_settle_${marketId}`.
 * Re-invocation after a partial crash converges to the same state.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  creditLedger,
  marketAmmState,
  marketBets,
  marketEntries,
  predictionMarkets,
  profiles,
} from "@shared/schema";
import { db } from "../db";
import { log } from "../log";
import { returnAmmSeedAtSettlement } from "./amm-house";
import { createNotification } from "./notifications";
import {
  buildAmmResolutionNotification,
  buildAmmVoidNotification,
} from "./amm-resolver-notifications";
import { gamificationService } from "./gamification";
import { checkAndAwardPredictionWinBadges } from "./badges";
import { scoreResolvedMarket } from "../agents/performanceUpdater";

type DbOrTx = Pick<typeof db, "select" | "insert" | "update">;

export interface ResolveAmmMarketInput {
  marketId: string;
  /** EntryId that won. Required unless `voidMarket=true`. */
  winnerEntryId?: string | null;
  /** When true, refund every user their net credits in. */
  voidMarket?: boolean;
  /** Admin user id (or null for system-initiated). */
  settledBy?: string | null;
  /**
   * Reason persisted into `prediction_markets.void_reason` when this
   * call results in a void. Defaults to `"amm_admin_void"` so existing
   * admin call sites keep their semantics. Cron-driven auto-voids
   * (tie / stale-blocked) should pass a distinct value (e.g.
   * `"amm_auto_tie"`, `"amm_auto_void_stale"`) so ops dashboards can
   * separate human-triggered voids from system-triggered voids when
   * triaging incidents.
   */
  voidReason?: string;
}

export interface ResolveAmmMarketResult {
  marketId: string;
  outcome: "resolved" | "voided";
  winnerEntryId: string | null;
  payoutLiability: number;
  creditedToHouse: number;
  settledUserCount: number;
  /** Already-resolved markets short-circuit and return their existing
   *  result. `idempotentSkip=true` means no rows changed this call. */
  idempotentSkip: boolean;
}

export type ResolveAmmMarketError =
  | { error: "market_not_found"; message: string }
  | { error: "not_amm"; message: string }
  | { error: "invalid_state"; message: string }
  | { error: "winner_invalid"; message: string }
  | { error: "missing_amm_state"; message: string };

/**
 * Settle an AMM market. Idempotent — re-running on an already-resolved
 * market returns `idempotentSkip: true` with the existing settlement
 * data. Wraps everything in a single `db.transaction`.
 */
export async function resolveAmmMarket(
  input: ResolveAmmMarketInput,
): Promise<ResolveAmmMarketResult | ResolveAmmMarketError> {
  const {
    marketId,
    winnerEntryId = null,
    voidMarket = false,
    settledBy = null,
    voidReason = "amm_admin_void",
  } = input;

  const txResult: ResolveAmmMarketResult | ResolveAmmMarketError = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DbOrTx;

    const [market] = await tx
      .select({
        id: predictionMarkets.id,
        engine: predictionMarkets.engine,
        status: predictionMarkets.status,
        resolvedAt: predictionMarkets.resolvedAt,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);

    if (!market) {
      return { error: "market_not_found", message: `Market ${marketId} not found.` };
    }
    if (market.engine !== "amm") {
      return {
        error: "not_amm",
        message: `Market ${marketId} engine=${market.engine}; AMM resolver only handles engine='amm'.`,
      };
    }

    // Idempotent re-entry: if already resolved, return the persisted
    // outcome without rewriting anything.
    if (market.status === "RESOLVED" || market.status === "VOID") {
      const [state] = await tx
        .select({
          houseSeedAmount: marketAmmState.houseSeedAmount,
          totalUserCreditsIn: marketAmmState.totalUserCreditsIn,
        })
        .from(marketAmmState)
        .where(eq(marketAmmState.marketId, marketId))
        .limit(1);

      const [winner] = market.status === "RESOLVED"
        ? await tx
            .select({ id: marketEntries.id })
            .from(marketEntries)
            .where(
              and(
                eq(marketEntries.marketId, marketId),
                eq(marketEntries.resolutionStatus, "winner"),
              ),
            )
            .limit(1)
        : [undefined];

      const totalIn = state ? Number(state.totalUserCreditsIn) : 0;
      const seed = state?.houseSeedAmount ?? 0;
      // We don't recompute payoutLiability on the idempotent path —
      // just report the existing house P&L as creditedToHouse from
      // the credit_ledger settle row.
      const [settleRow] = await tx
        .select({ amount: creditLedger.amount })
        .from(creditLedger)
        .where(
          sql`${creditLedger.userId} = '00000000-0000-0000-0000-0000000000aa' AND ${creditLedger.idempotencyKey} = ${`amm_settle_${marketId}`}`,
        )
        .limit(1);

      const outcome: "resolved" | "voided" = market.status === "RESOLVED" ? "resolved" : "voided";
      return {
        marketId,
        outcome,
        winnerEntryId: winner?.id ?? null,
        payoutLiability: settleRow ? seed + totalIn - settleRow.amount : 0,
        creditedToHouse: settleRow?.amount ?? 0,
        settledUserCount: 0,
        idempotentSkip: true,
      };
    }

    if (market.status !== "OPEN" && market.status !== "CLOSED_PENDING") {
      return {
        error: "invalid_state",
        message: `Market ${marketId} is in status ${market.status}; cannot resolve.`,
      };
    }

    if (!voidMarket) {
      if (!winnerEntryId) {
        return {
          error: "winner_invalid",
          message: "winnerEntryId is required when voidMarket is false.",
        };
      }
      const [winner] = await tx
        .select({ id: marketEntries.id })
        .from(marketEntries)
        .where(
          and(eq(marketEntries.id, winnerEntryId), eq(marketEntries.marketId, marketId)),
        )
        .limit(1);
      if (!winner) {
        return {
          error: "winner_invalid",
          message: `Entry ${winnerEntryId} does not belong to market ${marketId}.`,
        };
      }
    }

    const [stateRow] = await tx
      .select({
        marketId: marketAmmState.marketId,
        liquidityB: marketAmmState.liquidityB,
        outcomeOrder: marketAmmState.outcomeOrder,
        shareQuantities: marketAmmState.shareQuantities,
        houseSeedAmount: marketAmmState.houseSeedAmount,
        totalUserCreditsIn: marketAmmState.totalUserCreditsIn,
      })
      .from(marketAmmState)
      .where(eq(marketAmmState.marketId, marketId))
      .limit(1);

    if (!stateRow) {
      return {
        error: "missing_amm_state",
        message: `Market ${marketId} has engine='amm' but no market_amm_state row. Manual repair required.`,
      };
    }

    const settledAt = new Date();

    if (voidMarket) {
      const result = await runVoidPath(tx, marketId, settledBy, settledAt, voidReason);
      return result;
    }

    return runWinnerPath(tx, marketId, winnerEntryId!, settledBy, settledAt);
  });

  // Errors short-circuit the post-tx fanout. `ResolveAmmMarketResult`
  // never has an `error` field, so the structural narrow is sound and
  // returns the typed error union for the caller.
  if ("error" in txResult) return txResult;
  if (!txResult.idempotentSkip) {
    await emitResolutionSideEffects(txResult);
  }
  return txResult;
}

// ---------------------------------------------------------------------------
// Post-transaction side effects: market_resolved notifications, win XP,
// agent performance scoring. Mirrors the parimutuel `settleMarketBets`
// fanout 1:1 so AMM resolutions look the same from the user's side as
// the old engine did. Failures are logged and swallowed — settlement
// already committed.
// ---------------------------------------------------------------------------
async function emitResolutionSideEffects(result: ResolveAmmMarketResult): Promise<void> {
  const { marketId, outcome, winnerEntryId } = result;

  try {
    const [marketMeta] = await db
      .select({ title: predictionMarkets.title, slug: predictionMarkets.slug })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);
    const marketTitle = marketMeta?.title ?? "your prediction";
    const href = marketMeta?.slug ? `/markets/${marketMeta.slug}` : `/me/predictions`;

    if (outcome === "voided") {
      // Pull refund ledger rows (settledUserCount > 0 path) and fan
      // out a single "market voided — your credits were refunded"
      // notification per user.
      const refundRows = await db
        .select({
          userId: creditLedger.userId,
          amount: creditLedger.amount,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.txnType, "amm_void_refund"),
            sql`${creditLedger.metadata}->>'marketId' = ${marketId}`,
          ),
        );

      for (const row of refundRows) {
        const refund = row.amount ?? 0;
        const { title, body } = buildAmmVoidNotification({ marketTitle, refund });
        await createNotification({
          userId: row.userId,
          kind: "market_void_refund",
          title,
          body,
          href,
          entityType: "market",
          entityId: marketId,
          marketId,
          metadata: { outcome: "voided", refund },
          idempotencyKey: `market_void_refund:${marketId}:${row.userId}`,
        });
      }
      return;
    }

    // Winner path. Fan out per active buy row (won/lost) so each open
    // position closes with its own ping — same pattern as parimutuel.
    const settledBuys = await db
      .select({
        id: marketBets.id,
        userId: marketBets.userId,
        status: marketBets.status,
        stakeAmount: marketBets.stakeAmount,
        payoutAmount: marketBets.payoutAmount,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.marketId, marketId),
          eq(marketBets.actionType, "buy"),
          inArray(marketBets.status, ["won", "lost"]),
        ),
      );

    // Tier 1.7: aggregate per-user winner-side sell proceeds so the
    // "won && payout === 0" branch can emit an accurate "you sold
    // beforehand" closure notification instead of silently dropping.
    // Empty map when winnerEntryId is null (defensive — voided paths
    // already returned above) so the existing suppression fallback
    // kicks in.
    const proceedsByUser = new Map<string, number>();
    if (winnerEntryId) {
      const winnerSellRows = await db
        .select({
          userId: marketBets.userId,
          sumProceeds: sql<string>`COALESCE(SUM(${marketBets.payoutAmount}), 0)`,
        })
        .from(marketBets)
        .where(
          and(
            eq(marketBets.marketId, marketId),
            eq(marketBets.entryId, winnerEntryId),
            eq(marketBets.actionType, "sell"),
          ),
        )
        .groupBy(marketBets.userId);
      for (const row of winnerSellRows) {
        proceedsByUser.set(row.userId, Number(row.sumProceeds ?? 0));
      }
    }

    // A user can hold multiple winner-side buy rows that all settle to
    // payout=0 (split entry points). Without dedupe we'd fire one
    // identical "you sold beforehand" notification per row. Track
    // users we've already pinged on that branch and skip subsequent
    // rows.
    const soldOutNotified = new Set<string>();

    for (const bet of settledBuys) {
      const won = bet.status === "won";
      const stake = bet.stakeAmount ?? 0;
      const payout = bet.payoutAmount ?? 0;

      let preResolveSellProceeds: number | undefined;
      if (won && payout === 0) {
        if (soldOutNotified.has(bet.userId)) continue;
        preResolveSellProceeds = proceedsByUser.get(bet.userId) ?? 0;
      }

      const built = buildAmmResolutionNotification({
        marketTitle,
        won,
        stake,
        payout,
        preResolveSellProceeds,
      });
      if (!built) continue;
      if (won && payout === 0) soldOutNotified.add(bet.userId);

      // On the sold-out branch the legacy `payout - stake` formula
      // misrepresents reality (it returns -stake because payout=0 even
      // though the user realised credits via pre-close sells). Use the
      // realised proceeds so metadata.profit matches the body text.
      const profit =
        won && payout === 0 && preResolveSellProceeds !== undefined
          ? preResolveSellProceeds - stake
          : won
            ? payout - stake
            : -stake;
      await createNotification({
        userId: bet.userId,
        kind: "market_resolved",
        title: built.title,
        body: built.body,
        href,
        entityType: "market",
        entityId: marketId,
        marketId,
        metadata: {
          betId: bet.id,
          status: bet.status,
          payout,
          stake,
          profit,
          ...(preResolveSellProceeds !== undefined
            ? { preResolveSellProceeds }
            : {}),
        },
        idempotencyKey: `market_resolved:${marketId}:${bet.id}`,
      });
    }

    // Award `prediction_win` XP per winning buy row (idempotent via
    // gamificationService key). Badge checks run once per unique winner
    // to avoid redundant work when one user holds multiple winning bets.
    const winningBuys = settledBuys.filter((b) => b.status === "won");
    const winningUserIds = new Set<string>();
    for (const bet of winningBuys) {
      winningUserIds.add(bet.userId);
      try {
        await gamificationService.awardXp(
          bet.userId,
          "prediction_win",
          `prediction_win_${marketId}_${bet.id}`,
          { marketId, betId: bet.id },
        );
      } catch (err) {
        log(`[AmmResolver] XP award failed for ${marketId}/${bet.id}: ${(err as Error)?.message ?? err}`);
      }
    }
    for (const userId of winningUserIds) {
      try {
        await checkAndAwardPredictionWinBadges(userId);
      } catch (err) {
        log(`[AmmResolver] Win-badge check failed for ${marketId}/${userId}: ${(err as Error)?.message ?? err}`);
      }
    }

    // Agent performance scoring (fire-and-forget).
    if (winnerEntryId) {
      scoreResolvedMarket(marketId, winnerEntryId).catch((err) =>
        log(`[AmmResolver] Agent scoring failed for ${marketId}: ${err?.message ?? err}`),
      );
    }

    // AI resolution summary (fire-and-forget). Lives in market-resolver
    // to avoid duplicating the prompt; dynamic-imported here to break
    // the otherwise-circular dependency (market-resolver imports this
    // file).
    import("../jobs/market-resolver")
      .then((mod) => mod.generateResolutionSummary(marketId))
      .catch((err) =>
        log(`[AmmResolver] Resolution summary failed for ${marketId}: ${err?.message ?? err}`),
      );
  } catch (err) {
    log(`[AmmResolver] Post-settlement fanout failed for ${marketId}: ${(err as Error)?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Winner path — pay out shares of the winning entry, mark bets,
// return seed.
// ---------------------------------------------------------------------------

async function runWinnerPath(
  tx: DbOrTx,
  marketId: string,
  winnerEntryId: string,
  settledBy: string | null,
  settledAt: Date,
): Promise<ResolveAmmMarketResult> {
  // Pull all 'active' AMM buy rows for this market — these are the
  // open positions that need to be marked won/lost. Sell rows live
  // in status='settled' from creation and don't need touching.
  const activeBuys = await tx
    .select({
      id: marketBets.id,
      userId: marketBets.userId,
      entryId: marketBets.entryId,
      shareCount: marketBets.shareCount,
      stakeAmount: marketBets.stakeAmount,
    })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.marketId, marketId),
        eq(marketBets.actionType, "buy"),
        eq(marketBets.status, "active"),
      ),
    );

  // Compute per-user net shares of the winner. Net = SUM(buy.shares
  // on winner) - SUM(sell.shares on winner). Sell rows weren't
  // returned above, so fetch the sell-share-sums per user.
  const sellSums = await tx
    .select({
      userId: marketBets.userId,
      sumShares: sql<string>`COALESCE(SUM(${marketBets.shareCount}), 0)`,
    })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.marketId, marketId),
        eq(marketBets.entryId, winnerEntryId),
        eq(marketBets.actionType, "sell"),
      ),
    )
    .groupBy(marketBets.userId);

  const sellByUser = new Map<string, number>();
  for (const row of sellSums) sellByUser.set(row.userId, Number(row.sumShares ?? 0));

  // Group winner-side buys per user. Other-entry buys go to the
  // "lost" pile and don't generate payouts.
  const winnerBuysByUser = new Map<
    string,
    { totalBuyShares: number; rows: typeof activeBuys }
  >();
  const losingBuyIds: string[] = [];
  const winningBuyIdsByUser = new Map<string, string[]>();

  for (const bet of activeBuys) {
    const sc = Number(bet.shareCount ?? 0);
    if (bet.entryId === winnerEntryId) {
      let slot = winnerBuysByUser.get(bet.userId);
      if (!slot) {
        slot = { totalBuyShares: 0, rows: [] };
        winnerBuysByUser.set(bet.userId, slot);
      }
      slot.totalBuyShares += sc;
      slot.rows.push(bet);
      const ids = winningBuyIdsByUser.get(bet.userId) ?? [];
      ids.push(bet.id);
      winningBuyIdsByUser.set(bet.userId, ids);
    } else {
      losingBuyIds.push(bet.id);
    }
  }

  // For each winning user, payout = floor(netShares). Distribute the
  // payout across that user's winner-side buy rows proportional to
  // shareCount so per-row payoutAmount is meaningful.
  let totalPayoutLiability = 0;
  let settledUserCount = 0;

  for (const [userId, slot] of winnerBuysByUser) {
    const sellShares = sellByUser.get(userId) ?? 0;
    const netShares = Math.max(0, slot.totalBuyShares - sellShares);
    const payout = Math.floor(netShares);

    if (payout > 0) {
      const idempotencyKey = `amm_payout_${marketId}_${userId}`;
      const existing = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(
          sql`${creditLedger.userId} = ${userId} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
        )
        .limit(1);

      if (existing.length === 0) {
        const [updated] = await tx
          .update(profiles)
          .set({ predictCredits: sql`${profiles.predictCredits} + ${payout}` })
          .where(eq(profiles.id, userId))
          .returning({ predictCredits: profiles.predictCredits });

        if (updated) {
          await tx.insert(creditLedger).values({
            userId,
            txnType: "amm_payout",
            amount: payout,
            walletType: "VIRTUAL",
            balanceAfter: updated.predictCredits,
            source: "amm_settle",
            idempotencyKey,
            metadata: {
              marketId,
              winnerEntryId,
              netShares,
              totalBuyShares: slot.totalBuyShares,
              sellShares,
            },
          });
          settledUserCount++;
        }
      }
    }

    // Distribute the user's payout across their winner buy rows.
    let distributed = 0;
    for (let i = 0; i < slot.rows.length; i++) {
      const row = slot.rows[i];
      const isLast = i === slot.rows.length - 1;
      const sc = Number(row.shareCount ?? 0);
      const share = slot.totalBuyShares > 0 ? sc / slot.totalBuyShares : 0;
      const rowPayout = isLast
        ? Math.max(0, payout - distributed)
        : Math.floor(payout * share);
      distributed += rowPayout;

      await tx
        .update(marketBets)
        .set({
          status: "won",
          payoutAmount: rowPayout,
          settledAt,
        })
        .where(eq(marketBets.id, row.id));
    }

    totalPayoutLiability += payout;
  }

  // All non-winner buys are losses — already paid the cost at buy
  // time; no further credit movement needed, just mark them.
  if (losingBuyIds.length > 0) {
    await tx
      .update(marketBets)
      .set({ status: "lost", payoutAmount: 0, settledAt })
      .where(inArray(marketBets.id, losingBuyIds));
  }

  // Mark winner entry, return seed to house, finalize market row.
  await tx
    .update(marketEntries)
    .set({ resolutionStatus: "winner" })
    .where(eq(marketEntries.id, winnerEntryId));
  await tx
    .update(marketEntries)
    .set({ resolutionStatus: "loser" })
    .where(
      and(
        eq(marketEntries.marketId, marketId),
        sql`${marketEntries.id} != ${winnerEntryId}`,
      ),
    );

  const seedReturn = await returnAmmSeedAtSettlement(
    { marketId, payoutLiability: totalPayoutLiability },
    tx,
  );

  await tx
    .update(predictionMarkets)
    .set({
      status: "RESOLVED",
      resolvedAt: settledAt,
      settledBy: settledBy ?? undefined,
      updatedAt: settledAt,
    })
    .where(eq(predictionMarkets.id, marketId));

  return {
    marketId,
    outcome: "resolved",
    winnerEntryId,
    payoutLiability: totalPayoutLiability,
    creditedToHouse: seedReturn.creditedToHouse,
    settledUserCount,
    idempotentSkip: false,
  };
}

// ---------------------------------------------------------------------------
// Void path — refund every user their net credits in.
// ---------------------------------------------------------------------------

async function runVoidPath(
  tx: DbOrTx,
  marketId: string,
  settledBy: string | null,
  settledAt: Date,
  voidReason: string,
): Promise<ResolveAmmMarketResult> {
  // Net credits in per user = SUM(stakeAmount) over all AMM rows for
  // this market. Buys store +chargeCredits, sells store -proceeds, so
  // the sum is exactly what the user is "out of pocket" right now.
  const refundRows = await tx
    .select({
      userId: marketBets.userId,
      netCredits: sql<string>`COALESCE(SUM(${marketBets.stakeAmount}), 0)`,
    })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.marketId, marketId),
        inArray(marketBets.actionType, ["buy", "sell"]),
      ),
    )
    .groupBy(marketBets.userId);

  let settledUserCount = 0;
  let totalRefund = 0;

  for (const row of refundRows) {
    const refund = Math.max(0, Math.floor(Number(row.netCredits ?? 0)));
    if (refund <= 0) continue;

    const idempotencyKey = `amm_void_refund_${marketId}_${row.userId}`;
    const existing = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        sql`${creditLedger.userId} = ${row.userId} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
      )
      .limit(1);

    if (existing.length === 0) {
      const [updated] = await tx
        .update(profiles)
        .set({ predictCredits: sql`${profiles.predictCredits} + ${refund}` })
        .where(eq(profiles.id, row.userId))
        .returning({ predictCredits: profiles.predictCredits });

      if (updated) {
        await tx.insert(creditLedger).values({
          userId: row.userId,
          txnType: "amm_void_refund",
          amount: refund,
          walletType: "VIRTUAL",
          balanceAfter: updated.predictCredits,
          source: "amm_settle",
          idempotencyKey,
          metadata: { marketId, reason: "market_voided" },
        });
        settledUserCount++;
        totalRefund += refund;
      }
    } else {
      totalRefund += refund;
    }
  }

  // Mark all AMM bet rows as void with payoutAmount = stakeAmount
  // (so winners' P&L is zero on this market — pure refund).
  await tx
    .update(marketBets)
    .set({
      status: "void",
      payoutAmount: sql`${marketBets.stakeAmount}`,
      settledAt,
    })
    .where(
      and(
        eq(marketBets.marketId, marketId),
        inArray(marketBets.actionType, ["buy", "sell"]),
        eq(marketBets.status, "active"),
      ),
    );

  // House gets back exactly the seed (refunds equal totalUserCreditsIn).
  // Use returnAmmSeedAtSettlement with payoutLiability = totalRefund —
  // the helper computes seed + totalIn - payoutLiability and we expect
  // this to equal seed since totalRefund ≈ totalIn.
  const seedReturn = await returnAmmSeedAtSettlement(
    { marketId, payoutLiability: totalRefund },
    tx,
  );

  await tx
    .update(predictionMarkets)
    .set({
      status: "VOID",
      resolvedAt: settledAt,
      settledBy: settledBy ?? undefined,
      voidReason,
      updatedAt: settledAt,
    })
    .where(eq(predictionMarkets.id, marketId));

  return {
    marketId,
    outcome: "voided",
    winnerEntryId: null,
    payoutLiability: totalRefund,
    creditedToHouse: seedReturn.creditedToHouse,
    settledUserCount,
    idempotentSkip: false,
  };
}
