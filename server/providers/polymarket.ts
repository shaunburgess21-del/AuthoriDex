/**
 * Polymarket Gamma API provider (read-only market discovery).
 *
 * Fully public, no API key. Used by the Market Scout job to source trending
 * real-world prediction markets as candidates for VoxDex World Markets, and
 * (Phase 3) to check whether a sourced market has resolved upstream.
 *
 * Docs: https://docs.polymarket.com — Gamma API at gamma-api.polymarket.com.
 * Rate limits are generous (~500 req/10s on /events); the scout makes a
 * handful of calls per day.
 */

import {
  OTHER_OUTCOME_LABEL,
  OTHER_OUTCOME_RESIDUAL_THRESHOLD,
  isOtherStyleOutcomeLabel,
} from "@shared/lib/other-outcome";
import { log } from "../log";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Kill switch for auto-appending a residual "Other" outcome on multi
 * (negRisk) imports. Default ON — set SCOUT_OTHER_OUTCOME_ENABLED=false
 * to disable. Binary Yes/No markets are never affected.
 */
function otherOutcomeEnabled(): boolean {
  const v = process.env.SCOUT_OTHER_OUTCOME_ENABLED;
  if (v === undefined || v === "") return true;
  const normalized = v.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

/**
 * When a multi-outcome event's named prices leave a meaningful residual
 * (and no catch-all already exists), append a synthetic "Other" row so
 * VoxDex can settle cleanly if no listed name wins. Exported for tests.
 */
export function maybeAppendOtherOutcome(
  outcomes: PolymarketOutcome[],
  structure: "binary" | "multi",
  maxOutcomes: number,
): PolymarketOutcome[] {
  if (!otherOutcomeEnabled()) return outcomes;
  if (structure !== "multi") return outcomes;
  if (outcomes.length < 2 || outcomes.length >= maxOutcomes) return outcomes;
  if (outcomes.some((o) => isOtherStyleOutcomeLabel(o.label))) return outcomes;

  const namedSum = outcomes.reduce((s, o) => s + o.price, 0);
  const residual = 1 - namedSum;
  if (residual < OTHER_OUTCOME_RESIDUAL_THRESHOLD) return outcomes;
  // Don't invent Other when the book is over-subscribed (misread prices).
  if (namedSum > 1.05) return outcomes;

  return [
    ...outcomes,
    {
      label: OTHER_OUTCOME_LABEL,
      price: Math.max(0, Math.min(1, residual)),
      sourceMarketId: "",
      sourceOutcomeIndex: 0,
      isResidual: true,
    },
  ];
}

/** One tradable outcome on the source event, with its live price. */
export interface PolymarketOutcome {
  /** Display label, e.g. "Yes" / "No" / a candidate name. */
  label: string;
  /** Current price in [0, 1] (probability implied by the order book). */
  price: number;
  /**
   * Gamma market id this outcome belongs to. Empty string for a VoxDex-
   * synthesized residual "Other" row that has no upstream market.
   */
  sourceMarketId: string;
  /**
   * Index into that market's `outcomes` array (0 = Yes side for negRisk
   * multi events; 0/1 for plain binary markets).
   */
  sourceOutcomeIndex: number;
  /**
   * True when this row is a VoxDex-synthesized catch-all ("Other") whose
   * price is the residual 1 − Σ named prices. Source-watch treats these
   * specially (propose Other when no named upstream winner).
   */
  isResidual?: boolean;
}

/** A normalized candidate event suitable for import as a VoxDex World Market. */
export interface PolymarketCandidate {
  /** Gamma event id — the stable external identifier used for dedupe. */
  eventId: string;
  eventSlug: string;
  title: string;
  /** Event/market description text (includes resolution rules prose). */
  description: string | null;
  /** Public URL on polymarket.com. */
  url: string;
  image: string | null;
  /** ISO datetime the event resolves by. */
  endDate: string;
  /**
   * ISO datetime the event/game actually starts (kickoff), when the source
   * exposes it. For scheduled sports the result is known well before the
   * padded `endDate`, so the scout uses this to close betting at kickoff.
   * Null when the source provides no start time.
   */
  gameStartTime: string | null;
  volume24hr: number;
  tags: string[];
  /** binary = single Yes/No market; multi = negRisk event, one entry per market. */
  structure: "binary" | "multi";
  outcomes: PolymarketOutcome[];
}

interface GammaMarket {
  id?: string | number;
  question?: string;
  slug?: string;
  description?: string;
  endDate?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  groupItemTitle?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  negRisk?: boolean;
  volume24hr?: string | number;
  /** Kickoff/start time for sports markets, e.g. "2026-07-07 00:00:00+00". */
  gameStartTime?: string;
}

interface GammaEvent {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  image?: string;
  icon?: string;
  endDate?: string;
  /** Event-level start time (ISO), fallback when markets omit gameStartTime. */
  startTime?: string;
  volume24hr?: string | number;
  active?: boolean;
  closed?: boolean;
  negRisk?: boolean;
  tags?: Array<{ label?: string; slug?: string }>;
  markets?: GammaMarket[];
}

function toNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize a Gamma timestamp to an ISO string, or null when unparseable.
 * Gamma mixes formats: event `startTime` is ISO ("2026-07-07T00:00:00Z"),
 * while market `gameStartTime` is space-separated with a short offset
 * ("2026-07-07 00:00:00+00"). Expands a trailing "+HH"/"-HH" offset to
 * "+HH:00" so Date.parse accepts it, and treats a designator-less value as
 * UTC (Gamma times are UTC) so we never fall back to the server's local zone.
 * Exported for unit testing.
 */
export function parseGammaTimestamp(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let s = v.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  if (!/[zZ]$/.test(s) && !/[+-]\d{2}:\d{2}$/.test(s)) s += "Z";
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Earliest valid kickoff across market-level `gameStartTime` values,
 * falling back to the event-level `startTime`. Null when neither is
 * provided / parseable. Exported for unit tests and the source-watch
 * time re-sync path (same formula as scout import).
 */
export function earliestGameStartTime(
  markets: Array<{ gameStartTime?: string }>,
  fallbackStartTime?: string | null,
): string | null {
  const marketStartTimes = markets
    .map((m) => parseGammaTimestamp(m.gameStartTime))
    .filter((s): s is string => !!s);
  if (marketStartTimes.length > 0) {
    return marketStartTimes.reduce((earliest, s) =>
      Date.parse(s) < Date.parse(earliest) ? s : earliest,
    );
  }
  return parseGammaTimestamp(fallbackStartTime);
}

/** Gamma serializes `outcomes` / `outcomePrices` as JSON strings. */
function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v !== "string") return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

async function gammaGet(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${GAMMA_BASE}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Gamma API ${res.status} on ${path}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Normalize one Gamma event into a scout candidate, or null when the event
 * shape isn't importable (no end date, unsupported outcome count, etc.).
 */
function normalizeEvent(
  ev: GammaEvent,
  opts: { minOutcomes: number; maxOutcomes: number },
): PolymarketCandidate | null {
  const eventId = ev.id != null ? String(ev.id) : null;
  const title = ev.title?.trim();
  const endDate = ev.endDate;
  if (!eventId || !title || !endDate) return null;
  if (Number.isNaN(Date.parse(endDate))) return null;

  const markets = (ev.markets ?? []).filter(
    (m) => m.id != null && m.active !== false && m.closed !== true && m.archived !== true,
  );
  if (markets.length === 0) return null;

  let structure: "binary" | "multi";
  let outcomes: PolymarketOutcome[];

  if (markets.length === 1) {
    // Single Yes/No (or two-sided) market.
    const m = markets[0];
    const labels = parseJsonArray(m.outcomes);
    const prices = parseJsonArray(m.outcomePrices).map((p) => toNumber(p));
    if (labels.length !== 2) return null;
    structure = "binary";
    outcomes = labels.map((label, i) => ({
      label,
      price: Math.max(0, Math.min(1, prices[i] ?? 0.5)),
      sourceMarketId: String(m.id),
      sourceOutcomeIndex: i,
    }));
  } else {
    // negRisk multi event: each market is one mutually-exclusive outcome;
    // its "Yes" price is the outcome's probability.
    structure = "multi";
    outcomes = markets
      .map((m) => {
        const prices = parseJsonArray(m.outcomePrices).map((p) => toNumber(p));
        const label = (m.groupItemTitle || m.question || "").trim();
        if (!label) return null;
        return {
          label,
          price: Math.max(0, Math.min(1, prices[0] ?? 0)),
          sourceMarketId: String(m.id),
          sourceOutcomeIndex: 0,
        } satisfies PolymarketOutcome;
      })
      .filter((o): o is PolymarketOutcome => o !== null)
      .sort((a, b) => b.price - a.price);
  }

  // Append a residual "Other" when the named set is non-exhaustive, so the
  // exhaustiveness guard below sees a complete probability vector and
  // settlement has a clean target if no listed name wins.
  outcomes = maybeAppendOtherOutcome(outcomes, structure, opts.maxOutcomes);

  if (outcomes.length < opts.minOutcomes || outcomes.length > opts.maxOutcomes) {
    return null;
  }

  // Kickoff/start time: earliest valid market-level gameStartTime, falling
  // back to the event-level startTime. Null when neither is provided.
  const gameStartTime = earliestGameStartTime(markets, ev.startTime);

  return {
    eventId,
    eventSlug: ev.slug ?? "",
    title,
    description: ev.description?.trim() || markets[0]?.description?.trim() || null,
    url: ev.slug ? `https://polymarket.com/event/${ev.slug}` : "https://polymarket.com",
    image: ev.image || ev.icon || null,
    endDate,
    gameStartTime,
    volume24hr: toNumber(ev.volume24hr),
    tags: (ev.tags ?? [])
      .map((t) => t.label?.trim())
      .filter((t): t is string => !!t),
    structure,
    outcomes,
  };
}

export interface FetchTrendingOptions {
  /** How many raw events to pull from Gamma (max 500). */
  limit?: number;
  /** Skip events resolving sooner than this many hours from now. */
  minHoursToEnd?: number;
  /** Skip events resolving further out than this many days. */
  maxDaysToEnd?: number;
  /** Outcome-count bounds (VoxDex supports 2 for binary, 3–30 for multi). */
  minOutcomes?: number;
  maxOutcomes?: number;
  /**
   * Optional Gamma tag id to scope the feed (e.g. Movies=53, Music=100).
   * When set, appends `tag_id` so the scout can pull category-stratified
   * candidates instead of only the global volume leaderboard.
   */
  tagId?: string;
}

/**
 * Build the Gamma `/events` path for a trending fetch. Exported for unit tests.
 */
export function buildTrendingEventsPath(options: {
  limit: number;
  tagId?: string;
}): string {
  const limit = Math.max(1, Math.min(Math.floor(options.limit), 500));
  let path =
    `/events?active=true&closed=false&order=volume24hr&ascending=false&limit=${limit}`;
  if (typeof options.tagId === "string" && options.tagId.trim()) {
    path += `&tag_id=${encodeURIComponent(options.tagId.trim())}`;
  }
  return path;
}

/**
 * Fetch the currently-trending Polymarket events (by 24h volume) and
 * normalize them into importable candidates. Failures throw — the caller
 * (scout job) decides how to log/degrade.
 */
export async function fetchTrendingPolymarketEvents(
  options: FetchTrendingOptions = {},
): Promise<PolymarketCandidate[]> {
  const {
    limit = 60,
    minHoursToEnd = 48,
    maxDaysToEnd = 365,
    minOutcomes = 2,
    maxOutcomes = 12,
    tagId,
  } = options;

  const raw = await gammaGet(buildTrendingEventsPath({ limit, tagId }));
  if (!Array.isArray(raw)) {
    throw new Error("Gamma /events returned a non-array payload");
  }

  const now = Date.now();
  const minEndMs = now + minHoursToEnd * 60 * 60 * 1000;
  const maxEndMs = now + maxDaysToEnd * 24 * 60 * 60 * 1000;

  const candidates: PolymarketCandidate[] = [];
  for (const ev of raw as GammaEvent[]) {
    const candidate = normalizeEvent(ev, { minOutcomes, maxOutcomes });
    if (!candidate) continue;
    const endMs = Date.parse(candidate.endDate);
    if (endMs < minEndMs || endMs > maxEndMs) continue;
    // Exhaustiveness guard: outcome prices must sum to ~1. Non-exhaustive
    // events (e.g. "closure by when?" with no "never" bucket) can end with
    // NO listed outcome winning, which a VoxDex market can't settle.
    const priceSum = candidate.outcomes.reduce((s, o) => s + o.price, 0);
    if (priceSum < 0.85 || priceSum > 1.15) continue;
    candidates.push(candidate);
  }

  log(
    `[Polymarket] Fetched ${raw.length} trending events` +
      (tagId ? ` (tag_id=${tagId})` : "") +
      `, ${candidates.length} importable candidates`,
  );
  return candidates;
}

// ---------------------------------------------------------------------------
// Resolution lookups (Phase 3 source-resolution watcher)
// ---------------------------------------------------------------------------

export interface PolymarketMarketResolution {
  marketId: string;
  closed: boolean;
  /** Outcome labels, aligned with `winningOutcomeIndex` and `prices`. */
  outcomes: string[];
  /**
   * Index of the outcome whose settlement price is ~1, or null while the
   * market is unresolved / ambiguous.
   */
  winningOutcomeIndex: number | null;
  /**
   * Live outcome prices in [0,1], aligned with `outcomes`. While the
   * market is open these are the order-book consensus — the source
   * fair-value anchor for agent convergence on scouted markets.
   */
  prices: number[];
}

function toMarketResolution(raw: GammaMarket): PolymarketMarketResolution | null {
  if (!raw || raw.id == null) return null;

  const outcomes = parseJsonArray(raw.outcomes);
  const prices = parseJsonArray(raw.outcomePrices).map((p) => toNumber(p));

  let winningOutcomeIndex: number | null = null;
  if (raw.closed === true && prices.length === outcomes.length) {
    const idx = prices.findIndex((p) => p >= 0.99);
    if (idx >= 0) winningOutcomeIndex = idx;
  }

  return {
    marketId: String(raw.id),
    closed: raw.closed === true,
    outcomes,
    winningOutcomeIndex,
    prices: prices.map((p) => Math.max(0, Math.min(1, p))),
  };
}

/**
 * Fetch the resolution state of a single Gamma market. A resolved market is
 * `closed: true` with one outcome priced at ~1.
 */
export async function fetchPolymarketMarketResolution(
  marketId: string,
): Promise<PolymarketMarketResolution | null> {
  try {
    const raw = (await gammaGet(`/markets/${encodeURIComponent(marketId)}`)) as GammaMarket;
    return toMarketResolution(raw);
  } catch (err) {
    log(
      `[Polymarket] Resolution lookup failed for market=${marketId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Event-level schedule + per-market resolution map from one Gamma fetch. */
export interface PolymarketEventSnapshot {
  /** Map keyed by source market id. */
  resolutions: Map<string, PolymarketMarketResolution>;
  /** Event-level endDate (ISO), or null when missing / unparseable. */
  endDate: string | null;
  /** Earliest kickoff across markets (or event startTime), or null. */
  gameStartTime: string | null;
}

/**
 * Fetch resolution state for every market inside one Gamma event (single
 * API call — cheaper than per-market lookups on multi-outcome events).
 * Also returns event-level endDate / kickoff so the source watch can
 * re-sync VoxDex times when Polymarket reschedules — at zero extra cost.
 * Returns null on fetch failure.
 */
export async function fetchPolymarketEventResolutions(
  eventId: string,
): Promise<PolymarketEventSnapshot | null> {
  try {
    const raw = (await gammaGet(`/events/${encodeURIComponent(eventId)}`)) as GammaEvent;
    if (!raw || raw.id == null) return null;
    const resolutions = new Map<string, PolymarketMarketResolution>();
    for (const m of raw.markets ?? []) {
      const resolution = toMarketResolution(m);
      if (resolution) resolutions.set(resolution.marketId, resolution);
    }
    return {
      resolutions,
      endDate: parseGammaTimestamp(raw.endDate),
      gameStartTime: earliestGameStartTime(raw.markets ?? [], raw.startTime),
    };
  } catch (err) {
    log(
      `[Polymarket] Event resolution lookup failed for event=${eventId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
