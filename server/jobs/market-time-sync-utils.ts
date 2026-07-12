/**
 * Pure helpers for World Market cutoff safety:
 *   1. Auto-lock trading (freeze closeAt) when an outcome becomes public.
 *   2. Re-sync endAt/closeAt when Polymarket reschedules a source event.
 *
 * Kept free of DB / network so unit tests cover the edge cases without
 * spinning up a pool. Call sites (source watch, resolution scout) own
 * the flags, persistence, and ops alerts.
 */

/** Ignore source-time drift smaller than this (Gamma clock jitter). */
export const DEFAULT_RESYNC_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Compute the new closeAt for an auto-lock, or null when the market is
 * already past its cutoff (idempotent no-op). Never pushes closeAt later.
 */
export function computeLockCloseAt(
  currentCloseAt: Date | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (currentCloseAt && currentCloseAt.getTime() <= now.getTime()) {
    return null;
  }
  return new Date(now.getTime());
}

export interface ComputeResyncedTimesInput {
  sourceEndDate: string | Date;
  sourceGameStartTime?: string | Date | null;
  /** AMM pre-resolve cooldown in ms (default 5 min). */
  cooldownMs: number;
  now?: Date;
}

export interface ResyncedTimes {
  endAt: Date;
  closeAt: Date;
}

/**
 * Recompute endAt / closeAt from a source schedule using the same formula
 * as Market Scout import: closeAt = earlier of (endAt − cooldown) and a
 * future kickoff. Returns null when the source end date is invalid or
 * already in the past (that's a resolution path, not a reschedule).
 */
export function computeResyncedTimes(
  input: ComputeResyncedTimesInput,
): ResyncedTimes | null {
  const now = input.now ?? new Date();
  const endAt = new Date(input.sourceEndDate);
  if (isNaN(endAt.getTime()) || endAt.getTime() <= now.getTime()) {
    return null;
  }

  const cooldownMs =
    Number.isFinite(input.cooldownMs) && input.cooldownMs > 0
      ? input.cooldownMs
      : 5 * 60 * 1000;
  const defaultCutoff = new Date(endAt.getTime() - cooldownMs);
  let closeAt = defaultCutoff;

  if (input.sourceGameStartTime) {
    const kickoff = new Date(input.sourceGameStartTime);
    if (
      !isNaN(kickoff.getTime()) &&
      kickoff.getTime() > now.getTime() &&
      kickoff.getTime() < defaultCutoff.getTime()
    ) {
      closeAt = kickoff;
    }
  }

  return { endAt, closeAt };
}

export interface ShouldApplyResyncInput {
  currentEndAt: Date;
  /**
   * Last source endDate we applied (or adopted). Null on legacy markets
   * that predate the baseline field — then we only adopt when the current
   * endAt still matches the source (safe), otherwise we skip so we never
   * clobber a manual admin edit we can't detect.
   */
  syncedEndDate: string | Date | null | undefined;
  sourceEndDate: string | Date;
  /** Last applied kickoff; used so sports postponements that keep the
   *  padded endDate but move gameStartTime still trigger a re-sync. */
  syncedGameStartTime?: string | Date | null;
  sourceGameStartTime?: string | Date | null;
  now?: Date;
  thresholdMs?: number;
}

function parseOptionalMs(v: string | Date | null | undefined): number | null {
  if (v == null || v === "") return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when we still "own" the schedule and the source moved by more than
 * `thresholdMs` (endDate and/or kickoff). Manual-edit guard: if currentEndAt
 * diverges from syncedEndDate, an admin edited times — leave them alone.
 *
 * Legacy adopt-baseline: when syncedEndDate is missing, only return true
 * if currentEndAt ≈ sourceEndDate (within threshold). The caller should
 * then persist syncedEndDate without moving times on that first pass
 * (use `isLegacyBaselineAdopt` to distinguish).
 */
export function shouldApplyResync(input: ShouldApplyResyncInput): {
  apply: boolean;
  /** True when we should only write the baseline, not move times. */
  isLegacyBaselineAdopt: boolean;
} {
  const now = input.now ?? new Date();
  const thresholdMs =
    Number.isFinite(input.thresholdMs) && (input.thresholdMs as number) >= 0
      ? (input.thresholdMs as number)
      : DEFAULT_RESYNC_THRESHOLD_MS;

  const sourceEndMs = new Date(input.sourceEndDate).getTime();
  if (!Number.isFinite(sourceEndMs) || sourceEndMs <= now.getTime()) {
    return { apply: false, isLegacyBaselineAdopt: false };
  }

  const currentEndMs = input.currentEndAt.getTime();
  if (!Number.isFinite(currentEndMs)) {
    return { apply: false, isLegacyBaselineAdopt: false };
  }

  if (input.syncedEndDate == null || input.syncedEndDate === "") {
    // Legacy: only adopt a baseline when we still match the source.
    const matchesSource = Math.abs(currentEndMs - sourceEndMs) <= thresholdMs;
    return {
      apply: matchesSource,
      isLegacyBaselineAdopt: matchesSource,
    };
  }

  const syncedEndMs = new Date(input.syncedEndDate).getTime();
  if (!Number.isFinite(syncedEndMs)) {
    return { apply: false, isLegacyBaselineAdopt: false };
  }

  // Manual override: admin moved endAt off our last synced value.
  if (Math.abs(currentEndMs - syncedEndMs) > thresholdMs) {
    return { apply: false, isLegacyBaselineAdopt: false };
  }

  const endMoved = Math.abs(sourceEndMs - syncedEndMs) > thresholdMs;

  const syncedKickMs = parseOptionalMs(input.syncedGameStartTime);
  const sourceKickMs = parseOptionalMs(input.sourceGameStartTime);
  let kickoffMoved = false;
  if (syncedKickMs == null && sourceKickMs == null) {
    kickoffMoved = false;
  } else if (syncedKickMs == null || sourceKickMs == null) {
    // Appeared or disappeared — treat as a material schedule change.
    kickoffMoved = true;
  } else {
    kickoffMoved = Math.abs(sourceKickMs - syncedKickMs) > thresholdMs;
  }

  if (!endMoved && !kickoffMoved) {
    return { apply: false, isLegacyBaselineAdopt: false };
  }

  return { apply: true, isLegacyBaselineAdopt: false };
}
