/**
 * Pure helpers powering the AMM admin dashboard audit (Phase 5).
 *
 * The route handlers in `server/routes.ts` query the DB and feed the
 * raw rows into these functions. Splitting the math/semantics out
 * here keeps the route layer thin and lets tests cover the invariant
 * checks without spinning up a Postgres instance.
 *
 * Tolerances mirror the values used in the route:
 *   shares  → 1e-6   (LMSR uses fractional shares; floating-point dust)
 *   credits → 1e-2   (we round credits but a sub-cent drift is harmless)
 */

export const SHARE_DRIFT_TOLERANCE = 1e-6;
export const CREDITS_DRIFT_TOLERANCE = 1e-2;
export const RECONCILIATION_TOLERANCE = 1; // sub-credit drift acceptable

export type AuditSeverity = "ok" | "warn" | "error";

export interface AuditCheckResult {
  check: string;
  severity: AuditSeverity;
  message: string;
  affected: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// CHECK 1 + 2: state vs bets drift
// ---------------------------------------------------------------------------

export interface AmmStateRow {
  marketId: string;
  marketTitle: string | null;
  marketStatus: string;
  /** Map<entryId, shareCount> from market_amm_state.share_quantities. */
  shareQuantities: Record<string, number> | null;
  totalUserCreditsIn: number | null;
  outcomeOrder: string[] | null;
}

export interface BetAggRow {
  marketId: string;
  entryId: string;
  /** SUM(buy.shares) − SUM(sell.shares). */
  netShares: number;
  /** SUM(stakeAmount). Sells store stakeAmount as negative, so this
   *  matches market_amm_state.total_user_credits_in by construction. */
  netStake: number;
}

export interface ShareDriftRow {
  marketId: string;
  marketTitle: string | null;
  entryId: string;
  stateShares: number;
  betShares: number;
  drift: number;
}

export function detectShareDrift(
  states: AmmStateRow[],
  bets: BetAggRow[],
  tolerance = SHARE_DRIFT_TOLERANCE,
): ShareDriftRow[] {
  const sharesByMarketEntry = new Map<string, number>();
  for (const r of bets) {
    sharesByMarketEntry.set(`${r.marketId}::${r.entryId}`, r.netShares);
  }
  const out: ShareDriftRow[] = [];
  for (const s of states) {
    if (!s.shareQuantities || !s.outcomeOrder) continue;
    for (const eid of s.outcomeOrder) {
      const stateShares = Number(s.shareQuantities[eid] ?? 0);
      const betShares = sharesByMarketEntry.get(`${s.marketId}::${eid}`) ?? 0;
      const diff = stateShares - betShares;
      if (Math.abs(diff) > tolerance) {
        out.push({
          marketId: s.marketId,
          marketTitle: s.marketTitle,
          entryId: eid,
          stateShares,
          betShares,
          drift: diff,
        });
      }
    }
  }
  return out;
}

export interface CreditsDriftRow {
  marketId: string;
  marketTitle: string | null;
  stateCreditsIn: number;
  betCreditsIn: number;
  drift: number;
}

export function detectCreditsDrift(
  states: AmmStateRow[],
  bets: BetAggRow[],
  tolerance = CREDITS_DRIFT_TOLERANCE,
): CreditsDriftRow[] {
  const stakeByMarket = new Map<string, number>();
  for (const r of bets) {
    stakeByMarket.set(r.marketId, (stakeByMarket.get(r.marketId) ?? 0) + r.netStake);
  }
  const out: CreditsDriftRow[] = [];
  for (const s of states) {
    if (!s.shareQuantities) continue;
    const stateCreditsIn = Number(s.totalUserCreditsIn ?? 0);
    const betCreditsIn = stakeByMarket.get(s.marketId) ?? 0;
    const diff = stateCreditsIn - betCreditsIn;
    if (Math.abs(diff) > tolerance) {
      out.push({
        marketId: s.marketId,
        marketTitle: s.marketTitle,
        stateCreditsIn,
        betCreditsIn,
        drift: diff,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CHECK 3: settlement idempotency
// ---------------------------------------------------------------------------

export interface SettlementIssue {
  marketId: string;
  marketTitle: string | null;
  marketStatus: string;
  settleCreditCount: number;
  expected: 1;
}

/**
 * For every RESOLVED / VOID AMM market, exactly one
 * `amm_settle_credit` ledger row keyed `amm_settle_${marketId}` must
 * exist. Anything else (0, 2+, or missing-key counts) is a bug.
 */
export function detectSettlementIssues(
  states: AmmStateRow[],
  ledgerCountByKey: Map<string, number>,
): SettlementIssue[] {
  const out: SettlementIssue[] = [];
  for (const m of states) {
    if (m.marketStatus !== "RESOLVED" && m.marketStatus !== "VOID") continue;
    const key = `amm_settle_${m.marketId}`;
    const count = ledgerCountByKey.get(key) ?? 0;
    if (count !== 1) {
      out.push({
        marketId: m.marketId,
        marketTitle: m.marketTitle,
        marketStatus: m.marketStatus,
        settleCreditCount: count,
        expected: 1,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CHECK 4: house ledger reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  profileCredits: number;
  ledgerSum: number;
  drift: number;
  ok: boolean;
}

export function reconcileHouseLedger(
  profileCredits: number,
  ledgerSum: number,
  tolerance = RECONCILIATION_TOLERANCE,
): ReconciliationResult {
  const drift = profileCredits - ledgerSum;
  return {
    profileCredits,
    ledgerSum,
    drift,
    ok: Math.abs(drift) < tolerance,
  };
}

// ---------------------------------------------------------------------------
// Result wrappers — used to build the API response straight from the
// raw drift rows. Keeps the route handler dumb.
// ---------------------------------------------------------------------------

export function shareDriftCheck(rows: ShareDriftRow[]): AuditCheckResult {
  return {
    check: "state_vs_bets_shares",
    severity: rows.length === 0 ? "ok" : "error",
    message:
      rows.length === 0
        ? "All AMM markets agree between market_amm_state.share_quantities and SUM(market_bets) per entry."
        : `${rows.length} market+entry pair(s) show drift between state and bets.`,
    affected: rows.map((r) => ({ ...r })),
  };
}

export function creditsDriftCheck(rows: CreditsDriftRow[]): AuditCheckResult {
  return {
    check: "state_vs_bets_credits_in",
    severity: rows.length === 0 ? "ok" : "error",
    message:
      rows.length === 0
        ? "All AMM markets agree between total_user_credits_in and SUM(market_bets.stake_amount)."
        : `${rows.length} market(s) show drift between state and bets credits-in.`,
    affected: rows.map((r) => ({ ...r })),
  };
}

export function settlementIdempotencyCheck(
  rows: SettlementIssue[],
  closedMarketCount: number,
): AuditCheckResult {
  return {
    check: "settlement_idempotency",
    severity: rows.length === 0 ? "ok" : "error",
    message:
      rows.length === 0
        ? `All ${closedMarketCount} closed AMM market(s) have exactly one amm_settle_credit ledger row.`
        : `${rows.length} closed AMM market(s) have missing or duplicate settle ledger rows.`,
    affected: rows.map((r) => ({ ...r })),
  };
}

export function reconciliationCheck(rec: ReconciliationResult): AuditCheckResult {
  return {
    check: "house_ledger_reconciliation",
    severity: rec.ok ? "ok" : "error",
    message: rec.ok
      ? `House profile.predict_credits matches SUM(credit_ledger.amount) (${rec.profileCredits.toLocaleString()}).`
      : `House profile.predict_credits (${rec.profileCredits}) does not match SUM(credit_ledger.amount) (${rec.ledgerSum}); drift = ${rec.drift}.`,
    affected: rec.ok ? [] : [{ profileCredits: rec.profileCredits, ledgerSum: rec.ledgerSum, drift: rec.drift }],
  };
}

export function sourceAnchorDesyncCheck(
  rows: Array<Record<string, unknown>>,
): AuditCheckResult {
  const unanchorable = rows.filter((r) => r.anchorable === false);
  if (rows.length === 0) {
    return {
      check: "source_anchor_desync",
      severity: "ok",
      message:
        "All scouted World Markets have entry counts aligned with source outcomeMapping / livePrices.",
      affected: [],
    };
  }
  if (unanchorable.length > 0) {
    return {
      check: "source_anchor_desync",
      severity: "warn",
      message: `${unanchorable.length} scouted World Market(s) cannot source-anchor (plus ${rows.length - unanchorable.length} healable length mismatch(es)).`,
      affected: rows,
    };
  }
  return {
    check: "source_anchor_desync",
    severity: "warn",
    message: `${rows.length} scouted World Market(s) have a healable entry/mapping length mismatch (agents can still source-anchor).`,
    affected: rows,
  };
}

export function summariseOverallSeverity(
  checks: AuditCheckResult[],
): AuditSeverity {
  if (checks.every((c) => c.severity === "ok")) return "ok";
  if (checks.some((c) => c.severity === "error")) return "error";
  return "warn";
}
