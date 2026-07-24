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

// ---- Resolution backstop / data-lags trading window -----------------------
//
// Polymarket often sets event `endDate` to the *event start* (album release,
// film opening weekend) while the real resolution data lands days/weeks later
// (Hits Daily Double, box-office finals). Importing that endDate verbatim
// queues World Markets for manual resolution before any outcome is knowable.
//
// These helpers derive:
//   1. resolutionBackstopAt — hard ceiling for when we force CLOSED_PENDING
//      even if the upstream source is still open (parsed from rules, else
//      endDate + buffer).
//   2. trading closeAt — for data-lags markets, keep betting open through the
//      measurement window (endDate + extensionDays), capped by the backstop.
//   3. decideCommunityResolution — resolver gate: only queue when upstream
//      has resolved OR the backstop is reached.

/** Default days past nominal endDate when rules have no explicit backstop. */
export const DEFAULT_RESOLUTION_BACKSTOP_DAYS = 45;
/** Default days past event start to keep trading open on data-lags markets. */
export const DEFAULT_TRADING_EXTENSION_DAYS = 7;
/** Backstop must be this far past endDate to count as a data-lags signal. */
export const DATA_LAGS_BACKSTOP_GAP_MS = 2 * 24 * 60 * 60 * 1000;

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Keywords that signal "data lands after the event" markets even when the
 * rules prose has no explicit backstop date (fallback detection).
 */
const DATA_LAGS_KEYWORDS = [
  "first week",
  "debut week",
  "opening weekend",
  "opening week",
  "week one",
  "tracking week",
  "box office",
  "album sales",
  "first-week",
  "hits daily double",
  "sales_plus_streaming",
  "pure album sales",
];

/**
 * Parse an explicit "by Month DD, YYYY" (or "before …") date from rules
 * prose. Returns the latest such date found, or null.
 */
export function parseExplicitBackstopFromRules(
  rulesText: string | null | undefined,
): Date | null {
  if (!rulesText || typeof rulesText !== "string") return null;
  // Match: by|before|until|through <Month> <D>, <YYYY>  (optional time / ET)
  const re =
    /\b(?:by|before|until|through)\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  let latest: Date | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rulesText)) !== null) {
    const month = MONTH_INDEX[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    if (day < 1 || day > 31) continue;
    // Treat as 23:59:59 ET ≈ next calendar day 03:59 UTC; we store end-of-day
    // UTC of that calendar date for a clean admin-facing backstop.
    const d = new Date(Date.UTC(year, month, day, 23, 59, 0));
    if (isNaN(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest;
}

export function looksLikeDataLagsMarket(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return DATA_LAGS_KEYWORDS.some((k) => lower.includes(k));
}

export interface DeriveResolutionBackstopInput {
  endDate: string | Date;
  rulesText?: string | null;
  /** Title / teaser / criteria for keyword fallback detection. */
  contextText?: string | null;
  bufferDays?: number;
}

export interface ResolutionBackstopResult {
  backstopAt: Date;
  /** True when the backstop came from an explicit date in the rules. */
  fromRules: boolean;
  /** True when this looks like a data-lags (measurement-after-event) market. */
  isDataLags: boolean;
}

/**
 * Derive the hard resolution ceiling for a scouted World Market.
 * Prefer an explicit "by <date>" in the rules when later than endDate;
 * otherwise endDate + bufferDays.
 */
export function deriveResolutionBackstop(
  input: DeriveResolutionBackstopInput,
): ResolutionBackstopResult | null {
  const endAt = new Date(input.endDate);
  if (isNaN(endAt.getTime())) return null;

  const bufferDays =
    Number.isFinite(input.bufferDays) && (input.bufferDays as number) > 0
      ? (input.bufferDays as number)
      : DEFAULT_RESOLUTION_BACKSTOP_DAYS;

  const parsed = parseExplicitBackstopFromRules(input.rulesText);
  const bufferBackstop = new Date(
    endAt.getTime() + bufferDays * 24 * 60 * 60 * 1000,
  );

  let backstopAt = bufferBackstop;
  let fromRules = false;
  if (parsed && parsed.getTime() > endAt.getTime() + DATA_LAGS_BACKSTOP_GAP_MS) {
    backstopAt = parsed;
    fromRules = true;
  }

  // Data-lags = measurement window after the event (album sales, box office).
  // An explicit "by <date>" void clause alone is NOT enough — many markets
  // (Emmys, politics) have a far fallback date but resolve on event night.
  const isDataLags =
    looksLikeDataLagsMarket(input.rulesText) ||
    looksLikeDataLagsMarket(input.contextText);

  // Non-data-lags: keep a modest 7d safety buffer past endDate so a slightly
  // early Polymarket endDate doesn't force-queue them. Sports usually resolve
  // via upstreamResolvedAt long before this fires. If rules named a later
  // explicit date, prefer that as the hard ceiling.
  if (!isDataLags && !fromRules) {
    backstopAt = new Date(endAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  return { backstopAt, fromRules, isDataLags };
}

export interface DeriveTradingCloseAtInput {
  endDate: string | Date;
  backstopAt: Date;
  isDataLags: boolean;
  cooldownMs: number;
  extensionDays?: number;
  /** Kickoff for sports — when earlier than the derived cutoff, wins. */
  gameStartTime?: string | Date | null;
  now?: Date;
}

/**
 * Trading cutoff for a scouted World Market.
 * - Instant / sports: endDate − cooldown (or kickoff if earlier).
 * - Data-lags: min(endDate + extensionDays, backstopAt) − cooldown so users
 *   can keep trading through the measurement window.
 */
export function deriveTradingCloseAt(input: DeriveTradingCloseAtInput): Date | null {
  const now = input.now ?? new Date();
  const endAt = new Date(input.endDate);
  if (isNaN(endAt.getTime())) return null;

  const cooldownMs =
    Number.isFinite(input.cooldownMs) && input.cooldownMs > 0
      ? input.cooldownMs
      : 5 * 60 * 1000;
  const extensionDays =
    Number.isFinite(input.extensionDays) && (input.extensionDays as number) > 0
      ? (input.extensionDays as number)
      : DEFAULT_TRADING_EXTENSION_DAYS;

  let tradingEnd = endAt;
  if (input.isDataLags) {
    const extended = new Date(
      endAt.getTime() + extensionDays * 24 * 60 * 60 * 1000,
    );
    tradingEnd =
      extended.getTime() < input.backstopAt.getTime() ? extended : input.backstopAt;
  }

  let closeAt = new Date(tradingEnd.getTime() - cooldownMs);

  if (input.gameStartTime) {
    const kickoff = new Date(input.gameStartTime);
    if (
      !isNaN(kickoff.getTime()) &&
      kickoff.getTime() > now.getTime() &&
      kickoff.getTime() < closeAt.getTime()
    ) {
      closeAt = kickoff;
    }
  }

  return closeAt;
}

export type CommunityResolutionDecision =
  | { action: "queue"; reason: "upstream_resolved" | "backstop_reached_unresolved" | "manual_or_unknown" }
  | { action: "defer"; reason: "awaiting_upstream"; deferEndAt: Date };

export interface DecideCommunityResolutionInput {
  /** metadata.source blob (or null for non-scouted / manual markets). */
  source: {
    provider?: string | null;
    upstreamResolvedAt?: string | null;
  } | null | undefined;
  endAt: Date;
  /** metadata.resolutionBackstopAt when present. */
  backstopAt: Date | null | undefined;
  now?: Date;
}

/**
 * Resolver gate for community (World) markets past their nominal endAt.
 * Scouted Polymarket markets defer until upstream resolves or the backstop
 * is hit. Manual / unknown markets keep today's immediate-queue behaviour.
 */
export function decideCommunityResolution(
  input: DecideCommunityResolutionInput,
): CommunityResolutionDecision {
  const now = input.now ?? new Date();
  const source = input.source;
  const isScoutedPolymarket =
    !!source &&
    typeof source === "object" &&
    (source.provider === "polymarket" || source.provider === "Polymarket");

  if (!isScoutedPolymarket) {
    return { action: "queue", reason: "manual_or_unknown" };
  }

  if (typeof source!.upstreamResolvedAt === "string" && source!.upstreamResolvedAt.trim()) {
    return { action: "queue", reason: "upstream_resolved" };
  }

  const backstop =
    input.backstopAt instanceof Date && !isNaN(input.backstopAt.getTime())
      ? input.backstopAt
      : null;

  if (!backstop) {
    // Scouted but no backstop stamped yet (pre-backfill) — fall through to
    // today's behaviour so we never silently swallow a real resolution.
    return { action: "queue", reason: "manual_or_unknown" };
  }

  if (now.getTime() >= backstop.getTime()) {
    return { action: "queue", reason: "backstop_reached_unresolved" };
  }

  return {
    action: "defer",
    reason: "awaiting_upstream",
    deferEndAt: backstop,
  };
}

/** Read resolutionBackstopAt from market metadata (ISO string → Date). */
export function readResolutionBackstopAt(metadata: unknown): Date | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).resolutionBackstopAt;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Read metadata.source for the resolver gate (provider + upstreamResolvedAt). */
export function readSourceForResolutionGate(metadata: unknown): {
  provider?: string | null;
  upstreamResolvedAt?: string | null;
} | null {
  if (!metadata || typeof metadata !== "object") return null;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return null;
  const s = source as Record<string, unknown>;
  return {
    provider: typeof s.provider === "string" ? s.provider : null,
    upstreamResolvedAt:
      typeof s.upstreamResolvedAt === "string" ? s.upstreamResolvedAt : null,
  };
}
