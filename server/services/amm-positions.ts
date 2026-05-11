/**
 * Shared AMM position aggregation.
 *
 * Single source of truth for:
 *   - "What shares does a user hold across every open AMM market?"
 *     (OpenPositionsSection, /api/me/amm-positions)
 *   - "What is each user's realised + unrealised AMM P&L?"
 *     (profile headline stats, Top Predictors leaderboard)
 *
 * --------------------------------------------------------------------------
 * Accounting model: weighted-average-cost (FIFO-equivalent for a single
 * entry, since AMM shares are fungible). For each (user, market, entry):
 *
 *   avg_buy_cost      = sum(buy.stake)  / sum(buy.shareCount)
 *   cost_basis_sold   = sum(sell.shares) * avg_buy_cost
 *   realised_from_sells       = sum(sell.proceeds) - cost_basis_sold
 *   cost_basis_resolved       = remaining_shares * avg_buy_cost
 *   realised_from_resolution  = sum(buy.payoutAmount[won|lost])
 *                                 - cost_basis_resolved   (won/lost only)
 *                             = 0                          (void; full refund)
 *   unrealised        = remaining_shares * (currentPrice - avg_buy_cost)
 *
 * Total open-position P&L = realised_from_sells + unrealised
 * Total settled P&L       = realised_from_sells + realised_from_resolution
 *
 * Why this and not naive `payout - stake` per row: the resolver writes
 * `payoutAmount` based on REMAINING shares (after partial sells) but
 * `stakeAmount` is the ORIGINAL buy stake. Per-row `payout - stake`
 * therefore systematically understates the resolved P&L of partial-
 * sell users, and double-counts the sell proceeds when added on top.
 * Weighted-avg keeps the math invariant across the sell/resolve
 * transition.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  marketAmmState,
  marketBets,
  marketEntries,
  predictionMarkets,
  trendingPeople,
} from "@shared/schema";
import { currentPrices } from "@shared/lib/amm/positions";

export interface AmmOpenPosition {
  marketId: string;
  marketSlug: string;
  marketTitle: string;
  marketStatus: string;
  marketType: string;
  marketCadence: string | null;
  marketCategory: string | null;
  marketStartAt: Date | null;
  marketEndAt: Date | null;
  entryId: string;
  entryLabel: string;
  entryResolutionStatus: string | null;
  personName: string | null;
  personAvatar: string | null;
  netShares: number;
  netCreditsIn: number;
  /** Weighted-average cost per share at buy time. */
  avgEntryPrice: number;
  currentPrice: number;
  /** netShares * currentPrice. */
  currentValue: number;
  /** (currentPrice - avgEntryPrice) * netShares. */
  unrealisedPnl: number;
}

export interface AmmAggregatePnl {
  /** Sum of (sell_proceeds - sold_shares * avg_buy_cost) across all the
   *  user's AMM (market, entry) groups. */
  realisedFromSells: number;
  /** Sum of (won/lost buy payouts - remaining_shares * avg_buy_cost)
   *  across all the user's AMM (market, entry) groups whose markets
   *  have resolved. Void markets contribute 0 (full refund). */
  realisedFromResolution: number;
  /** Sum of remaining_shares * (currentPrice - avg_buy_cost) across all
   *  the user's open AMM (market, entry) groups. */
  unrealised: number;
  /** Sum of remaining_shares * currentPrice (gross MTM, not P&L). */
  openPositionsValue: number;
  /** Count of (market, entry) groups with non-zero remaining shares. */
  openPositionsCount: number;
  /** Gross AMM turnover (buys + sell proceeds) within the helper's
   *  period filter. Used by the leaderboard so AMM-only traders show
   *  a real volume number, not zero. */
  turnover: number;
}

const EMPTY_PNL: AmmAggregatePnl = {
  realisedFromSells: 0,
  realisedFromResolution: 0,
  unrealised: 0,
  openPositionsValue: 0,
  openPositionsCount: 0,
  turnover: 0,
};

interface BuildAggregateOptions {
  userIds?: string[];
  /** Restrict realised AMM contributions by `settledAt` (for the
   *  leaderboard period filter). Open-market unrealised contributions
   *  are always current-state and ignore this filter. */
  settledAfter?: Date;
}

/**
 * Aggregate every AMM bet row into per-(user, market, entry) summaries
 * and compute weighted-avg P&L splits. Internal helper used by both
 * the bulk leaderboard path and the per-user profile path.
 */
async function loadAmmAggregates(opts: BuildAggregateOptions = {}) {
  const conditions: SQL[] = [
    eq(predictionMarkets.engine, "amm"),
    sql`${marketBets.actionType} IN ('buy','sell')`,
  ];
  if (opts.userIds && opts.userIds.length > 0) {
    conditions.push(
      sql`${marketBets.userId} IN (${sql.join(
        opts.userIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  // One row per individual bet — we aggregate in JS so we can apply the
  // per-row `settledAfter` filter to sells/resolutions independently
  // (period filters only restrict realised P&L, never unrealised MTM).
  const rows = await db
    .select({
      userId: marketBets.userId,
      marketId: marketBets.marketId,
      entryId: marketBets.entryId,
      actionType: marketBets.actionType,
      status: marketBets.status,
      shareCount: marketBets.shareCount,
      stakeAmount: marketBets.stakeAmount,
      payoutAmount: marketBets.payoutAmount,
      createdAt: marketBets.createdAt,
      settledAt: marketBets.settledAt,
      marketStatus: predictionMarkets.status,
    })
    .from(marketBets)
    .innerJoin(
      predictionMarkets,
      eq(marketBets.marketId, predictionMarkets.id),
    )
    .where(and(...conditions));

  type Group = {
    userId: string;
    marketId: string;
    entryId: string;
    marketStatus: string;
    totalBuyShares: number;
    totalBuyCost: number;
    totalSellShares: number;
    sellProceedsInWindow: number;
    sellSharesInWindow: number;
    resolvedPayoutInWindow: number;
    /** Gross AMM turnover (buys + sell proceeds) within the period
     *  filter. Buys count their stake; sells count their proceeds
     *  (NOT the bookkeeping -proceeds stake). Open AMM buys count
     *  too because the credits left the user's wallet at buy time —
     *  that's the action that matters for "turnover". */
    turnoverInWindow: number;
    /** True if any buy row is status='won'/'lost'. */
    hasResolution: boolean;
    /** True if any won/lost row's settledAt is within the period filter.
     *  Tracked separately so lost rows (payout=0) still drag the cost
     *  basis into the period — otherwise they'd silently disappear from
     *  windowed P&L because resolvedPayoutInWindow would stay 0. */
    hasResolutionInWindow: boolean;
    /** True if any buy row is status='void' (market got voided). The
     *  resolver refunds full stakeAmount on void, so void markets need
     *  bespoke P&L handling — see the void branch below. */
    hasVoid: boolean;
    /** True if any void row is in window (gates the windfall booked
     *  by the void branch). */
    hasVoidInWindow: boolean;
  };

  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.userId}|${r.marketId}|${r.entryId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        userId: r.userId,
        marketId: r.marketId,
        entryId: r.entryId,
        marketStatus: r.marketStatus,
        totalBuyShares: 0,
        totalBuyCost: 0,
        totalSellShares: 0,
        sellProceedsInWindow: 0,
        sellSharesInWindow: 0,
        resolvedPayoutInWindow: 0,
        turnoverInWindow: 0,
        hasResolution: false,
        hasResolutionInWindow: false,
        hasVoid: false,
        hasVoidInWindow: false,
      };
      groups.set(key, g);
    }
    const shares = Number(r.shareCount ?? 0);
    // Period gates: buys use createdAt (cash-out event), sells and
    // buy resolutions use settledAt (cash-in event). Turnover counts
    // each event in its own window — keeps "today's volume" honest.
    const createdInWindow =
      !opts.settledAfter ||
      (r.createdAt != null && r.createdAt >= opts.settledAfter);
    const settledInWindow =
      !opts.settledAfter ||
      (r.settledAt != null && r.settledAt >= opts.settledAfter);
    if (r.actionType === "buy") {
      g.totalBuyShares += shares;
      g.totalBuyCost += r.stakeAmount;
      if (createdInWindow) {
        g.turnoverInWindow += Math.abs(r.stakeAmount);
      }
      if (r.status === "won" || r.status === "lost") {
        g.hasResolution = true;
        if (settledInWindow) {
          g.hasResolutionInWindow = true;
          g.resolvedPayoutInWindow += Number(r.payoutAmount ?? 0);
        }
      } else if (r.status === "void") {
        g.hasVoid = true;
        if (settledInWindow) g.hasVoidInWindow = true;
      }
    } else if (r.actionType === "sell" && r.status === "settled") {
      g.totalSellShares += shares;
      if (settledInWindow) {
        g.sellProceedsInWindow += Number(r.payoutAmount ?? 0);
        g.sellSharesInWindow += shares;
        g.turnoverInWindow += Number(r.payoutAmount ?? 0);
      }
    }
  }

  return groups;
}

/**
 * Per-user AMM realised + unrealised P&L. Bulk version used by the Top
 * Predictors leaderboard. Returns an entry for every user with any AMM
 * activity, even ones with no resolved bets yet (so fresh AMM-only
 * traders show up on the board).
 *
 * Pass `userIds` to scope to a candidate set (cheaper); omit for a full
 * scan. `settledAfter` filters realised contributions to bets settled
 * after a cutoff (today/week/month leaderboard filters) — unrealised
 * MTM is current-state and ignores it.
 */
export async function loadAmmAggregatePnlPerUser(
  opts: BuildAggregateOptions = {},
): Promise<Map<string, AmmAggregatePnl>> {
  const groups = await loadAmmAggregates(opts);
  if (groups.size === 0) return new Map();

  const openMarketIds = new Set<string>();
  for (const g of groups.values()) {
    if (g.marketStatus === "OPEN" || g.marketStatus === "CLOSED_PENDING") {
      openMarketIds.add(g.marketId);
    }
  }

  let pricesByMarket = new Map<string, Record<string, number>>();
  if (openMarketIds.size > 0) {
    const stateRows = await db
      .select()
      .from(marketAmmState)
      .where(
        sql`${marketAmmState.marketId} IN (${sql.join(
          Array.from(openMarketIds).map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    pricesByMarket = new Map(
      stateRows.map((s) => [
        s.marketId,
        currentPrices({
          liquidityB: Number(s.liquidityB),
          outcomeOrder: s.outcomeOrder as string[],
          shareQuantities: s.shareQuantities as Record<string, number>,
        }),
      ]),
    );
  }

  const out = new Map<string, AmmAggregatePnl>();
  for (const g of groups.values()) {
    if (g.totalBuyShares <= 0) continue; // defensive: orphan sell with no buy
    const avgBuyCost = g.totalBuyCost / g.totalBuyShares;
    const remainingShares = g.totalBuyShares - g.totalSellShares;
    const costBasisSoldInWindow = g.sellSharesInWindow * avgBuyCost;

    let realisedFromSells = g.sellProceedsInWindow - costBasisSoldInWindow;
    let realisedFromResolution = 0;
    let unrealised = 0;
    let openValue = 0;
    let openCount = 0;

    const isMarketOpen =
      g.marketStatus === "OPEN" || g.marketStatus === "CLOSED_PENDING";

    if (isMarketOpen) {
      // Open: remaining shares contribute MTM-style unrealised.
      if (Math.abs(remainingShares) > 1e-9) {
        const prices = pricesByMarket.get(g.marketId);
        const currentPrice = prices?.[g.entryId] ?? 0;
        unrealised = remainingShares * (currentPrice - avgBuyCost);
        openValue = remainingShares * currentPrice;
        openCount = 1;
      }
    } else if (g.hasResolution) {
      // Resolved (won/lost): the resolver wrote payoutAmount based on
      // remaining_shares, so the cost basis we subtract here also uses
      // remaining_shares — keeps the math invariant across the
      // sell-then-resolve transition. `hasResolutionInWindow` (rather
      // than `resolvedPayoutInWindow > 0`) is the period gate, so a
      // losing resolution (payout = 0) still drags its cost basis into
      // the period's realised P&L.
      const includeResolution =
        !opts.settledAfter || g.hasResolutionInWindow;
      if (includeResolution) {
        const cb = remainingShares * avgBuyCost;
        realisedFromResolution = g.resolvedPayoutInWindow - cb;
      }
    } else if (g.hasVoid) {
      // Void: resolver refunds the full buy stakeAmount (covers BOTH
      // remaining-shares cost basis AND the cost basis of any shares
      // that were sold pre-void). The "sold pre-void" piece is a
      // windfall — the user keeps the sell proceeds AND gets their
      // cost back. realisedFromSells already subtracted that cost
      // basis (avg-cost accounting), so we add it back here to keep
      // the per-(market, entry) total honest:
      //
      //   true P&L on a void (market, entry) = total_sell_proceeds
      //   our decomposition                  =
      //       realisedFromSells   = sell_proceeds − sold_shares × avg
      //     + realisedFromVoid    = sold_shares × avg            (this)
      //     ───────────────────────────────────────────────────────
      //                          = sell_proceeds   ✓
      const includeVoid = !opts.settledAfter || g.hasVoidInWindow;
      if (includeVoid) {
        realisedFromResolution = g.sellSharesInWindow * avgBuyCost;
      }
    }

    const acc = out.get(g.userId) ?? { ...EMPTY_PNL };
    acc.realisedFromSells += realisedFromSells;
    acc.realisedFromResolution += realisedFromResolution;
    acc.unrealised += unrealised;
    acc.openPositionsValue += openValue;
    acc.openPositionsCount += openCount;
    acc.turnover += g.turnoverInWindow;
    out.set(g.userId, acc);
  }

  return out;
}

/**
 * Single-user convenience wrapper for the profile headline endpoint.
 * Returns the empty PnL shape (all zeros) when the user has no AMM
 * activity, so callers don't have to null-check.
 */
export async function loadAmmAggregatePnlForUser(
  userId: string,
): Promise<AmmAggregatePnl> {
  const map = await loadAmmAggregatePnlPerUser({ userIds: [userId] });
  return map.get(userId) ?? { ...EMPTY_PNL };
}

/**
 * Aggregate open AMM positions for a user. One row per (market, entry)
 * with non-zero net shares. Used by the public /u/:username panel and
 * the owner-only /api/me/amm-positions endpoint.
 *
 * `avgEntryPrice` is the weighted-average buy cost per share (NOT
 * `netCreditsIn / netShares`, which is sensitive to partial sells and
 * therefore misleading as an "entry price").
 */
export async function loadAmmPositionsFor(
  userId: string,
): Promise<AmmOpenPosition[]> {
  const rows = await db
    .select({
      marketId: marketBets.marketId,
      entryId: marketBets.entryId,
      actionType: marketBets.actionType,
      shareCount: marketBets.shareCount,
      stakeAmount: marketBets.stakeAmount,
      marketSlug: predictionMarkets.slug,
      marketTitle: predictionMarkets.title,
      marketStatus: predictionMarkets.status,
      marketType: predictionMarkets.marketType,
      marketCadence: predictionMarkets.cadence,
      marketCategory: predictionMarkets.category,
      marketStartAt: predictionMarkets.startAt,
      marketEndAt: predictionMarkets.endAt,
      entryLabel: marketEntries.label,
      entryResolutionStatus: marketEntries.resolutionStatus,
      personName: trendingPeople.name,
      personAvatar: trendingPeople.avatar,
    })
    .from(marketBets)
    .innerJoin(
      predictionMarkets,
      eq(marketBets.marketId, predictionMarkets.id),
    )
    .innerJoin(marketEntries, eq(marketBets.entryId, marketEntries.id))
    .leftJoin(
      trendingPeople,
      eq(predictionMarkets.personId, trendingPeople.id),
    )
    .where(
      and(
        eq(marketBets.userId, userId),
        eq(predictionMarkets.engine, "amm"),
        sql`${marketBets.actionType} IN ('buy','sell')`,
        sql`${predictionMarkets.status} IN ('OPEN','CLOSED_PENDING')`,
      ),
    );

  if (rows.length === 0) return [];

  const ammMarketIds = Array.from(new Set(rows.map((r) => r.marketId)));
  const stateRows = await db
    .select()
    .from(marketAmmState)
    .where(
      sql`${marketAmmState.marketId} IN (${sql.join(
        ammMarketIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  const stateByMarket = new Map(stateRows.map((s) => [s.marketId, s]));

  // Group by (market, entry) and compute weighted-avg buy cost.
  type Slot = {
    sample: (typeof rows)[number];
    totalBuyShares: number;
    totalBuyCost: number;
    totalSellShares: number;
    totalSellProceedsBookkeeping: number; // = sum(-stakeAmount) on sells
  };
  const slots = new Map<string, Slot>();
  for (const r of rows) {
    const key = `${r.marketId}|${r.entryId}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        sample: r,
        totalBuyShares: 0,
        totalBuyCost: 0,
        totalSellShares: 0,
        totalSellProceedsBookkeeping: 0,
      };
      slots.set(key, slot);
    }
    const shares = Number(r.shareCount ?? 0);
    if (r.actionType === "buy") {
      slot.totalBuyShares += shares;
      slot.totalBuyCost += r.stakeAmount;
    } else if (r.actionType === "sell") {
      slot.totalSellShares += shares;
      // stakeAmount on sells is stored as -proceeds; flip for display.
      slot.totalSellProceedsBookkeeping += -r.stakeAmount;
    }
  }

  const positions: AmmOpenPosition[] = [];
  for (const slot of slots.values()) {
    const netShares = slot.totalBuyShares - slot.totalSellShares;
    if (Math.abs(netShares) <= 1e-9) continue;
    if (slot.totalBuyShares <= 0) continue;

    const stateRow = stateByMarket.get(slot.sample.marketId);
    if (!stateRow) continue;
    const prices = currentPrices({
      liquidityB: Number(stateRow.liquidityB),
      outcomeOrder: stateRow.outcomeOrder as string[],
      shareQuantities: stateRow.shareQuantities as Record<string, number>,
    });
    const currentPrice = prices[slot.sample.entryId] ?? 0;
    const avgEntryPrice = slot.totalBuyCost / slot.totalBuyShares;
    const currentValue = netShares * currentPrice;
    const unrealisedPnl = netShares * (currentPrice - avgEntryPrice);
    // netCreditsIn kept for back-compat with existing UI; it's
    // signed-cash-flow ("how much net cash is tied up here").
    const netCreditsIn =
      slot.totalBuyCost - slot.totalSellProceedsBookkeeping;

    positions.push({
      marketId: slot.sample.marketId,
      marketSlug: slot.sample.marketSlug,
      marketTitle: slot.sample.marketTitle,
      marketStatus: slot.sample.marketStatus,
      marketType: slot.sample.marketType,
      marketCadence: slot.sample.marketCadence,
      marketCategory: slot.sample.marketCategory,
      marketStartAt: slot.sample.marketStartAt,
      marketEndAt: slot.sample.marketEndAt,
      entryId: slot.sample.entryId,
      entryLabel: slot.sample.entryLabel,
      entryResolutionStatus: slot.sample.entryResolutionStatus,
      personName: slot.sample.personName,
      personAvatar: slot.sample.personAvatar,
      netShares,
      netCreditsIn,
      avgEntryPrice,
      currentPrice,
      currentValue,
      unrealisedPnl,
    });
  }

  return positions;
}

/**
 * Aggregate stats for headline tiles: total mark-to-market value of
 * every open position and the count of distinct (market, entry) rows.
 */
export async function loadAmmPositionTotals(
  userId: string,
): Promise<{ openPositionsValue: number; openPositionsCount: number }> {
  const pnl = await loadAmmAggregatePnlForUser(userId);
  return {
    openPositionsValue: pnl.openPositionsValue,
    openPositionsCount: pnl.openPositionsCount,
  };
}
