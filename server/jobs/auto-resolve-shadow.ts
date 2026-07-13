/**
 * Auto-resolve SHADOW MODE (read-only, never settles anything).
 *
 * Purpose: before we ever let the platform auto-settle World Markets, we
 * run the exact eligibility gate we WOULD use — but only log the verdict.
 * Two structured log lines are emitted, matchable by `marketId`:
 *
 *   [AutoResolveShadow] { ... wouldAutoResolve, holdReasons, proposedWinnerEntryId ... }
 *       — written when the deterministic source watch (or LLM scout) reaches
 *         a resolution signal. Says what auto-resolve WOULD have done.
 *
 *   [AutoResolveActual] { ... outcome, winnerEntryId ... }
 *       — written when a human actually settles the market. Ground truth.
 *
 * Over a testing window, join the two by `marketId`:
 *   - shadow.wouldAutoResolve && shadow.proposedWinnerEntryId === actual.winnerEntryId
 *     → auto-resolve would have been CORRECT.
 *   - shadow.wouldAutoResolve but winners differ (or actual voided)
 *     → auto-resolve would have been WRONG (investigate before enabling).
 *   - shadow HOLD → auto-resolve correctly deferred to a human.
 *
 * Design:
 *   - Zero side effects. Only logging. Never touches settlement.
 *   - Kill switch: AUTO_RESOLVE_SHADOW_ENABLED (default OFF). Turn on in
 *     Railway to start collecting data.
 *   - `evaluateAutoResolveEligibility` is a PURE function — it is the
 *     intended core of real auto-resolve v1, so the shadow data directly
 *     validates the gate we would ship.
 */

import { log } from "../log";

/** Where the resolution signal originated. Only the deterministic upstream
 *  watch is trustworthy enough to (eventually) auto-settle; the LLM scout is
 *  advisory and always held in v1. */
export type ShadowSignalSource = "source_watch" | "llm_scout";

/** Minimum LLM/scout confidence before auto-resolve would fire. Deterministic
 *  source-watch winners are 0.99 by construction, so this only bites LLM. */
function minConfidence(): number {
  const raw = Number(process.env.AUTO_RESOLVE_MIN_CONFIDENCE);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.95;
}

export function autoResolveShadowEnabled(): boolean {
  const v = process.env.AUTO_RESOLVE_SHADOW_ENABLED;
  if (typeof v !== "string") return false;
  const n = v.trim().toLowerCase();
  return n === "true" || n === "1" || n === "yes" || n === "on";
}

export interface AutoResolveShadowSignal {
  marketId: string;
  title: string;
  slug: string;
  marketType: string;
  openMarketType: string | null;
  signalSource: ShadowSignalSource;
  stage: string;
  recommendedAction: string;
  confidence: number;
  /** Mapped winning entry, or null for void/unmappable/knockout-confirm. */
  proposedWinnerEntryId: string | null;
  proposedWinnerLabel: string | null;
  entryCount: number;
  /** Proposed winner is a synthesized residual "Other" (new; held in v1). */
  isResidualOther: boolean;
  /** Single-winner knockout that needs the advancing team confirmed. */
  isKnockoutSingleWinner: boolean;
  /** Deterministic upstream (Polymarket) close confirmed for this market. */
  upstreamResolved: boolean;
}

export interface AutoResolveShadowVerdict {
  wouldAutoResolve: boolean;
  holdReasons: string[];
}

/**
 * The auto-resolve eligibility gate. PURE — no I/O. Conservative by design:
 * only a deterministic, single-winner, non-knockout, non-residual upstream
 * resolution on a World Market clears the gate. Everything else is HOLD
 * (routed to a human), which is exactly today's behaviour.
 */
export function evaluateAutoResolveEligibility(
  signal: AutoResolveShadowSignal,
): AutoResolveShadowVerdict {
  const holdReasons: string[] = [];

  if (signal.signalSource !== "source_watch") {
    // LLM scout is advisory only — never the trigger.
    holdReasons.push("llm_only_signal");
  }
  if (!signal.upstreamResolved) {
    holdReasons.push("upstream_not_resolved");
  }
  if (signal.recommendedAction !== "resolve_now" || signal.stage !== "met") {
    holdReasons.push("not_met_resolve_now");
  }
  if (!signal.proposedWinnerEntryId) {
    holdReasons.push("no_single_winner");
  }
  if (signal.isKnockoutSingleWinner) {
    holdReasons.push("knockout_needs_advancer");
  }
  if (signal.isResidualOther) {
    // Residual "Other" settlement is new — observe before trusting it.
    holdReasons.push("residual_other_unproven");
  }
  if (!(signal.confidence >= minConfidence())) {
    holdReasons.push("low_confidence");
  }
  if (signal.marketType !== "community") {
    // v1 scope: World Markets only.
    holdReasons.push("not_world_market");
  }

  return { wouldAutoResolve: holdReasons.length === 0, holdReasons };
}

/**
 * Emit the shadow verdict as a single-line JSON log (greppable in Railway
 * as `[AutoResolveShadow]`). No-op unless AUTO_RESOLVE_SHADOW_ENABLED.
 * Never throws — logging must not affect the watcher.
 */
export function logAutoResolveShadowDecision(signal: AutoResolveShadowSignal): void {
  if (!autoResolveShadowEnabled()) return;
  try {
    const verdict = evaluateAutoResolveEligibility(signal);
    log(
      `[AutoResolveShadow] ${JSON.stringify({
        marketId: signal.marketId,
        title: signal.title,
        slug: signal.slug,
        marketType: signal.marketType,
        openMarketType: signal.openMarketType,
        signalSource: signal.signalSource,
        stage: signal.stage,
        recommendedAction: signal.recommendedAction,
        confidence: signal.confidence,
        proposedWinnerEntryId: signal.proposedWinnerEntryId,
        proposedWinnerLabel: signal.proposedWinnerLabel,
        entryCount: signal.entryCount,
        isResidualOther: signal.isResidualOther,
        isKnockoutSingleWinner: signal.isKnockoutSingleWinner,
        upstreamResolved: signal.upstreamResolved,
        wouldAutoResolve: verdict.wouldAutoResolve,
        holdReasons: verdict.holdReasons,
        ts: new Date().toISOString(),
      })}`,
    );
  } catch {
    // Shadow logging must never break the watcher.
  }
}

export interface AutoResolveActualOutcome {
  marketId: string;
  title: string;
  marketType: string;
  outcome: "resolved" | "voided";
  winnerEntryId: string | null;
  /** Admin user id or null for system-initiated (auto-resolve is off today). */
  settledBy: string | null;
}

/**
 * Emit the human-settled ground truth (greppable as `[AutoResolveActual]`),
 * so shadow decisions can be scored against what actually happened. No-op
 * unless AUTO_RESOLVE_SHADOW_ENABLED. Never throws.
 */
export function logAutoResolveActual(actual: AutoResolveActualOutcome): void {
  if (!autoResolveShadowEnabled()) return;
  try {
    log(
      `[AutoResolveActual] ${JSON.stringify({
        marketId: actual.marketId,
        title: actual.title,
        marketType: actual.marketType,
        outcome: actual.outcome,
        winnerEntryId: actual.winnerEntryId,
        settledBy: actual.settledBy,
        ts: new Date().toISOString(),
      })}`,
    );
  } catch {
    // Ground-truth logging must never break settlement.
  }
}
