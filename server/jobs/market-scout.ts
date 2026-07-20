/**
 * Market Scout — automated World Market sourcing (draft-only).
 *
 * Once a day (or on an admin "Scan now" trigger), pulls trending events from
 * Polymarket's public Gamma API across a stratified set of feeds (global
 * volume plus Movies / Music / Celebrities / TV tags), dedupes them against
 * existing VoxDex markets, asks GPT to curate the best fits (rewriting each
 * question in VoxDex voice — never copying source rules text verbatim), and
 * inserts the winners as DRAFT World Markets for a founder to review, edit,
 * and publish.
 *
 * It NEVER publishes anything: every scouted market lands with
 * `visibility: 'draft'` (hidden from users, AMM seed deferred) and is
 * created by the scout system user so the self-resolution guard never
 * blocks a founder from settling it later.
 *
 * Design notes (mirrors resolution-scout.ts):
 *   - Kill switch: MARKET_SCOUT_ENABLED (default OFF). When off, this is a
 *     no-op.
 *   - Budget rail: MARKET_SCOUT_DAILY_BUDGET_USD / _PER_CALL_ESTIMATE_USD
 *     bound LLM calls per UTC day (one curation call per run, so this mainly
 *     guards against a spammed manual trigger).
 *   - Volume rail: MARKET_SCOUT_MAX_DRAFTS_PER_RUN caps inserted drafts.
 *   - Diversity: reserved shortlist slots per source bucket + soft
 *     politics/sports caps and a fitScore floor after GPT returns.
 *   - Dedupe: source event ids are stored in
 *     `prediction_markets.metadata.source.externalId`; existing titles are
 *     also passed to GPT so near-duplicate manual markets are skipped.
 *   - Provenance: `metadata.source` records provider / externalId / url /
 *     outcome mapping / prices at import, which Phase 2 (price-matched
 *     seeding) and Phase 3 (source resolution watcher) build on.
 */

import OpenAI from "openai";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db, withDbAdvisoryLock } from "../db";
import {
  cardRelatedPeople,
  contentCategories,
  inductionCandidates,
  marketEntries,
  predictionMarkets,
  trackedPeople,
} from "@shared/schema";
import {
  CANONICAL_MARKET_CATEGORIES,
  OPINION_POLL_MAX_OPTIONS,
  OPINION_POLL_MIN_OPTIONS,
  normalizeMarketCategory,
  sanitizeSecondaryCategories,
} from "@shared/constants";
import { log } from "../log";
import { getAiModel } from "../config/ai-models";
import { getMarketBettingCutoff } from "../native-markets/lifecycle";
import { getAmmCooldownMs } from "../native-markets/amm-settings";
import {
  computeLockCloseAt,
  computeResyncedTimes,
  shouldApplyResync,
} from "./market-time-sync-utils";
import {
  fetchPolymarketEventResolutions,
  fetchTrendingPolymarketEvents,
  type PolymarketCandidate,
} from "../providers/polymarket";
import {
  OTHER_OUTCOME_LABEL,
  computeOtherOutcomeAdvice,
  isOtherStyleOutcomeLabel,
} from "@shared/lib/other-outcome";
import { isSettlementEligibleVisibility } from "@shared/lib/market-visibility";
import {
  isDrawStyleOutcomeLabel,
  isSingleWinnerKnockoutMarket,
  inferDrawEligibleForSportsImport,
  knockoutHintsFromMarket,
  normalizeKnockoutResolutionCriteria,
  stripDrawForKnockoutImport,
} from "@shared/lib/knockout-market";
import { logAutoResolveShadowDecision } from "./auto-resolve-shadow";
import { sanitizeResolutionSources } from "@shared/lib/resolution-sources";

const MARKET_SCOUT_LOCK_KEY = 5_212;
const SOURCE_WATCH_LOCK_KEY = 5_213;

/**
 * Singleton system profile that owns scouted drafts. Created idempotently in
 * migration 0086_market_scout_profile.sql. Mirrors HOUSE_PROFILE_ID
 * (amm-house.ts); listings should already filter `role = 'system'` profiles
 * out via the is_agent/is_house conventions — the scout never trades or
 * comments, it only appears as `createdBy` on drafts.
 */
export const SCOUT_PROFILE_ID = "00000000-0000-0000-0000-0000000000bb";

// ---- Config ---------------------------------------------------------------

function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

const API_TIMEOUT_MS = 90_000;
/** Longer summaries + resolutionSources across a multi-draft run. */
const MAX_OUTPUT_TOKENS = 6_000;
/** How many deduped candidates to show GPT after stratified shortlisting. */
const MAX_CANDIDATES_FOR_LLM = 30;
/** Soft floor — GPT fitScore below this is dropped before insert. */
const MIN_FIT_SCORE = 55;
/** Soft per-run caps when other valid selections exist. */
const MAX_POLITICS_PER_RUN = 2;
const MAX_SPORTS_PER_RUN = 2;

/**
 * Stratified Polymarket source buckets. Global keeps high-liquidity
 * politics/sports/business; tagged feeds surface entertainment that rarely
 * appears on the global volume leaderboard.
 */
export const SCOUT_SOURCE_BUCKETS = [
  { id: "global" as const, tagId: undefined, fetchLimit: 80, shortlistSlots: 10 },
  { id: "movies" as const, tagId: "53", fetchLimit: 40, shortlistSlots: 6 },
  { id: "music" as const, tagId: "100", fetchLimit: 40, shortlistSlots: 5 },
  { id: "celebrities" as const, tagId: "286", fetchLimit: 40, shortlistSlots: 5 },
  { id: "tv" as const, tagId: "100338", fetchLimit: 40, shortlistSlots: 4 },
] as const;

export type ScoutSourceBucketId = (typeof SCOUT_SOURCE_BUCKETS)[number]["id"];

/** Candidate annotated with which stratified feed it came from. */
export type ScoutCandidate = PolymarketCandidate & {
  sourceBucket: ScoutSourceBucketId;
};

function scoutEnabled(): boolean {
  return envFlag(process.env.MARKET_SCOUT_ENABLED);
}

/** Auto-lock trading (freeze closeAt) when an outcome becomes public. Default OFF. */
function autoLockOnResolutionEnabled(): boolean {
  return envFlag(process.env.AUTO_LOCK_ON_RESOLUTION_ENABLED);
}

/** Auto-apply endAt/closeAt when Polymarket reschedules a source event. Default OFF. */
function sourceTimeResyncEnabled(): boolean {
  return envFlag(process.env.SOURCE_TIME_RESYNC_ENABLED);
}

function dailyBudgetUsd(): number {
  const raw = Number(process.env.MARKET_SCOUT_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 2.0;
}

function perCallEstimateUsd(): number {
  const raw = Number(process.env.MARKET_SCOUT_PER_CALL_ESTIMATE_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.25;
}

function maxDraftsPerRun(): number {
  const raw = Number(process.env.MARKET_SCOUT_MAX_DRAFTS_PER_RUN);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 20) : 5;
}

/** Max LLM calls allowed per UTC day (in-process counter, like the world
 *  market budget). One curation call per run, so this only matters when the
 *  manual admin trigger is hammered. */
function maxCallsPerDay(): number {
  return Math.max(1, Math.floor(dailyBudgetUsd() / perCallEstimateUsd()));
}

let llmCallDay = "";
let llmCallsToday = 0;

function tryReserveLlmCall(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== llmCallDay) {
    llmCallDay = today;
    llmCallsToday = 0;
  }
  if (llmCallsToday >= maxCallsPerDay()) return false;
  llmCallsToday += 1;
  return true;
}

// ---- Lazy OpenAI client ---------------------------------------------------

let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  _openaiClient = new OpenAI({
    apiKey:
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });
  return _openaiClient;
}

// ---- Types ----------------------------------------------------------------

export interface ScoutDraftSummary {
  marketId: string;
  title: string;
  slug: string;
  fitScore: number | null;
  sourceUrl: string;
}

export interface MarketScoutResult {
  enabled: boolean;
  /** Importable candidates fetched from the source. */
  fetched: number;
  /** Candidates dropped because the source event was already imported. */
  deduped: number;
  llmCalls: number;
  budgetBlocked: boolean;
  created: number;
  /** GPT selections that failed validation/insert. */
  skipped: number;
  /** Selections dropped because their series already has an unresolved market. */
  seriesBlocked: number;
  errors: number;
  drafts: ScoutDraftSummary[];
}

/** Authoritative real-world resolution source proposed by the scout. */
export interface ScoutResolutionSource {
  label: string;
  url?: string;
}

/** Shape GPT must return for each curated market. */
export interface ScoutSelection {
  eventId: string;
  title: string;
  slug: string;
  teaser: string;
  summary: string;
  category: string;
  secondaryCategories: string[];
  resolutionCriteria: string[];
  /**
   * Authoritative real-world sources of truth (never Polymarket).
   * Persisted to prediction_markets.resolution_sources.
   */
  resolutionSources: ScoutResolutionSource[];
  scoutWatch: string;
  linkedPerson: string | null;
  relatedPeople: string[];
  fitScore: number;
  entryLabels: string[];
  /**
   * Stable series id that ignores deadline/threshold/date so sibling
   * rungs (e.g. Hormuz by Jul 15 / Jul 31 / Dec 31) share one key.
   */
  seriesKey: string;
  /**
   * False for knockout / single-elimination ties where a draw after
   * regulation is not a final result (extra time / penalties decide).
   * True for group-stage / league fixtures where Draw is a valid outcome.
   * When false, import strips any Draw outcome and marks the market
   * single-winner.
   */
  drawEligible: boolean;
}

/** Unresolved community market shown to the curation prompt for series suppression. */
export interface UnresolvedMarketRef {
  title: string;
  seriesKey: string | null;
}

// ---- Helpers ---------------------------------------------------------------

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function knockoutHintsFromRow(
  row: { title: string; category?: string | null; metadata?: unknown },
  entryLabels: Array<{ label: string }>,
): ReturnType<typeof knockoutHintsFromMarket> {
  return knockoutHintsFromMarket(row, entryLabels.map((e) => e.label));
}

async function persistSingleWinnerKnockoutFlag(marketId: string): Promise<void> {
  const payload = { singleWinnerKnockout: true, drawEligible: false };
  await db
    .update(predictionMarkets)
    .set({
      metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(predictionMarkets.id, marketId));
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[''`"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Max tracked people auto-linked per draft (primary + Display on Profiles). */
const MAX_LINKED_PEOPLE = 6;

export type ScoutLinkablePerson = { id: string; name: string };

/** Lowercase, strip diacritics, collapse whitespace — canonical key for name matching. */
export function normalizeNameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merge main-leaderboard + active-induction people into a name-keyed map.
 * Main leaderboard wins on name collision (defensive; should not occur).
 * Exported for unit tests.
 */
export function mergeLinkablePeople(
  mainLeaderboard: ScoutLinkablePerson[],
  activeInduction: ScoutLinkablePerson[],
): Map<string, ScoutLinkablePerson> {
  const byKey = new Map<string, ScoutLinkablePerson>();
  for (const p of activeInduction) {
    const key = normalizeNameKey(p.name);
    if (key) byKey.set(key, p);
  }
  for (const p of mainLeaderboard) {
    const key = normalizeNameKey(p.name);
    if (key) byKey.set(key, p);
  }
  return byKey;
}

/**
 * People scout may link to World Markets: main leaderboard plus induction
 * shadow rows that have an active induction_candidates match (same 1:1
 * name rule as public induction profile pages).
 */
export async function loadLinkablePeopleForScout(): Promise<ScoutLinkablePerson[]> {
  const [mainRows, inductionRows] = await Promise.all([
    db
      .select({ id: trackedPeople.id, name: trackedPeople.name })
      .from(trackedPeople)
      .where(eq(trackedPeople.status, "main_leaderboard")),
    db
      .select({ id: trackedPeople.id, name: trackedPeople.name })
      .from(trackedPeople)
      .innerJoin(
        inductionCandidates,
        and(
          eq(inductionCandidates.displayName, trackedPeople.name),
          eq(inductionCandidates.isActive, true),
        ),
      )
      .where(eq(trackedPeople.status, "induction")),
  ]);
  return Array.from(mergeLinkablePeople(mainRows, inductionRows).values());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic safety net for celebrity linking: tracked people whose FULL
 * name appears verbatim (case/diacritic-insensitive, word-bounded) in the
 * candidate's title, description, or outcome labels. No fuzzy or partial
 * matching — "Jordan" alone never matches "Michael Jordan" — so this can
 * only add people the source text explicitly names (e.g. tracked players
 * listed as outcomes of a "top scorer" market the LLM under-linked).
 */
function scanCandidateForTrackedPeople(
  candidate: PolymarketCandidate,
  tracked: Iterable<{ id: string; name: string }>,
): string[] {
  // " | " separators survive normalization, so a name can never
  // false-positive by spanning two adjacent fields.
  const haystack = normalizeNameKey(
    [candidate.title, candidate.description ?? "", ...candidate.outcomes.map((o) => o.label)].join(" | "),
  );
  const hits: string[] = [];
  for (const person of tracked) {
    const needle = normalizeNameKey(person.name);
    if (!needle) continue;
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`);
    if (re.test(haystack)) hits.push(person.name);
  }
  return hits;
}

/** Allowed category ids from the live registry, canonical set as fallback. */
async function getAllowedCategoryIds(): Promise<Set<string>> {
  try {
    const rows = await db.select({ id: contentCategories.id }).from(contentCategories);
    const ids = rows.length > 0
      ? rows.map((r) => r.id)
      : (CANONICAL_MARKET_CATEGORIES as readonly string[]);
    return new Set(ids.map((id) => normalizeMarketCategory(id)));
  } catch {
    return new Set(
      (CANONICAL_MARKET_CATEGORIES as readonly string[]).map((id) => normalizeMarketCategory(id)),
    );
  }
}

function readSourceExternalId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return null;
  const id = (source as Record<string, unknown>).externalId;
  return typeof id === "string" ? id : null;
}

/** Reads metadata.seriesKey when present. Exported for unit tests. */
export function readSeriesKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const key = (metadata as Record<string, unknown>).seriesKey;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

/**
 * Strip deadline/threshold wording from a title before using it as a
 * seriesKey fallback. Keeps in-batch siblings ("by July 15" / "by July 31")
 * colliding when the LLM omits seriesKey. Only used as a fallback — a
 * real LLM-assigned seriesKey is preferred and left untouched.
 */
export function stripSeriesDeadlineNoise(title: string): string {
  const months =
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  return title
    // "by July 15", "by Jul. 31, 2026", "by the end of December"
    .replace(
      new RegExp(
        `\\bby\\s+(?:the\\s+)?(?:end\\s+of\\s+)?(?:${months})\\.?\\s*\\d{0,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?`,
        "gi",
      ),
      " ",
    )
    // "by 15 July 2026"
    .replace(
      new RegExp(
        `\\bby\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${months})\\.?(?:,?\\s*\\d{4})?`,
        "gi",
      ),
      " ",
    )
    // "by 2026-07-15", "by end of 2026", "by 2026"
    .replace(/\bby\s+\d{4}-\d{2}-\d{2}\b/gi, " ")
    .replace(/\bby\s+(?:the\s+)?(?:end\s+of\s+)?\d{4}\b/gi, " ")
    // Trailing bare date after the question core: "… normal July 15?"
    .replace(
      new RegExp(
        `\\b(?:${months})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?(?=\\s*\\??\\s*$)`,
        "gi",
      ),
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(/\s+\?/g, "?")
    .trim();
}

/**
 * Normalize a series key to lowercase kebab-case. When the LLM omits or
 * garbles the key, fall back to a deadline-stripped slugified title so
 * sibling rungs still share a key. Exported for unit tests.
 */
export function normalizeSeriesKey(
  raw: string | null | undefined,
  fallbackTitle: string,
): string {
  const fromRaw =
    typeof raw === "string"
      ? raw
          .toLowerCase()
          .replace(/[''`"]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80)
      : "";
  if (fromRaw) return fromRaw;
  const fromTitle = slugifyTitle(
    stripSeriesDeadlineNoise(fallbackTitle || "") || fallbackTitle || "series",
  );
  return fromTitle || "series";
}

/**
 * Hard series-slot filter: drop selections whose series already has an
 * unresolved VoxDex market, and de-dupe within the batch (first-wins;
 * callers should pass rank-ordered selections).
 *
 * Each selection is checked under BOTH its LLM seriesKey and its
 * deadline-stripped title key, so legacy unresolved markets (no stored
 * seriesKey yet) still hard-block siblings via the title stem.
 * Exported for unit tests.
 */
export function filterSelectionsBySeries(
  selections: ScoutSelection[],
  occupiedSeriesKeys: Set<string>,
): { kept: ScoutSelection[]; blocked: ScoutSelection[] } {
  const kept: ScoutSelection[] = [];
  const blocked: ScoutSelection[] = [];
  const seenInBatch = new Set<string>();

  for (const selection of selections) {
    const primaryKey = normalizeSeriesKey(selection.seriesKey, selection.title);
    const titleKey = normalizeSeriesKey(null, selection.title);
    const keys = primaryKey === titleKey ? [primaryKey] : [primaryKey, titleKey];

    const blockedByOccupied = keys.some((k) => occupiedSeriesKeys.has(k));
    const blockedByBatch = keys.some((k) => seenInBatch.has(k));
    if (blockedByOccupied || blockedByBatch) {
      blocked.push(selection);
      continue;
    }
    for (const k of keys) seenInBatch.add(k);
    kept.push(selection);
  }

  return { kept, blocked };
}

/** True when a community market still occupies its series slot. */
function isUnresolvedCommunityMarket(status: string, visibility: string | null): boolean {
  if (visibility === "archived") return false;
  return status === "OPEN" || status === "CLOSED_PENDING";
}

function extractOutputText(response: any): string | null {
  if (response.output_text) return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if ((part.type === "output_text" || part.type === "text") && part.text) {
          return part.text;
        }
      }
    }
  }
  return null;
}

/**
 * Deterministic reject for invasive celebrity/culture gossip that would
 * otherwise dominate tagged celebrity feeds. Awards, box office, charts,
 * casting, sports, politics, business, and tech are unaffected.
 * Exported for unit tests.
 */
export function isInvasiveGossipCandidate(candidate: {
  title: string;
  description?: string | null;
}): boolean {
  const text = `${candidate.title} ${candidate.description ?? ""}`.toLowerCase();
  const patterns = [
    /\bpregnan(?:t|cy)\b/,
    /\bcustody\b/,
    /\bwho will die\b/,
    /\bwill .+ die\b/,
    /\bdeath of\b/,
    /\b(?:break\s*up|breakup|divorced?|engaged|engagement|married|marries|wedding|separat(?:e|es|ed|ion))\b/,
    /\bsexiest (?:man|woman)\b/,
  ];
  return patterns.some((re) => re.test(text));
}

function byVolumeDesc(a: PolymarketCandidate, b: PolymarketCandidate): number {
  return b.volume24hr - a.volume24hr;
}

/**
 * Build a diversified GPT shortlist with reserved slots per source bucket,
 * then backfill remaining slots by 24h volume. Exported for unit tests.
 */
export function buildDiversifiedShortlist(
  candidates: ScoutCandidate[],
  maxSlots: number = MAX_CANDIDATES_FOR_LLM,
): ScoutCandidate[] {
  const safe = candidates.filter((c) => !isInvasiveGossipCandidate(c));
  const picked = new Set<string>();
  const out: ScoutCandidate[] = [];

  const takeFrom = (pool: ScoutCandidate[], n: number) => {
    const sorted = [...pool].sort(byVolumeDesc);
    for (const c of sorted) {
      if (out.length >= maxSlots) break;
      if (n <= 0) break;
      if (picked.has(c.eventId)) continue;
      picked.add(c.eventId);
      out.push(c);
      n -= 1;
    }
  };

  for (const bucket of SCOUT_SOURCE_BUCKETS) {
    if (out.length >= maxSlots) break;
    const pool = safe.filter((c) => c.sourceBucket === bucket.id);
    takeFrom(pool, bucket.shortlistSlots);
  }

  // Backfill empty reserved slots from leftovers (any bucket), volume-first.
  if (out.length < maxSlots) {
    takeFrom(safe, maxSlots - out.length);
  }

  return out;
}

/**
 * Soft post-GPT guardrails: fit floor + politics/sports caps, preferring
 * higher fit, then celebrity-linkable titles, then source volume.
 * Exported for unit tests.
 */
export function applySelectionDiversityGuards(
  selections: ScoutSelection[],
  candidateById: Map<string, ScoutCandidate>,
  maxDrafts: number,
): ScoutSelection[] {
  const scored = selections
    .map((s) => {
      const fit =
        typeof s.fitScore === "number" && Number.isFinite(s.fitScore)
          ? Math.round(s.fitScore)
          : null;
      const candidate = candidateById.get(s.eventId);
      const hasLinkHint =
        (typeof s.linkedPerson === "string" && s.linkedPerson.trim().length > 0) ||
        (Array.isArray(s.relatedPeople) &&
          s.relatedPeople.some((n) => typeof n === "string" && n.trim()));
      return { selection: s, fit, candidate, hasLinkHint };
    })
    .filter((row) => row.fit !== null && row.fit >= MIN_FIT_SCORE)
    .sort((a, b) => {
      const fitDelta = (b.fit ?? 0) - (a.fit ?? 0);
      if (fitDelta !== 0) return fitDelta;
      if (a.hasLinkHint !== b.hasLinkHint) return a.hasLinkHint ? -1 : 1;
      return (b.candidate?.volume24hr ?? 0) - (a.candidate?.volume24hr ?? 0);
    });

  const picked: ScoutSelection[] = [];
  let politics = 0;
  let sports = 0;

  const categoryOf = (s: ScoutSelection) =>
    normalizeMarketCategory(typeof s.category === "string" ? s.category : "misc");

  // First pass: respect soft caps.
  for (const row of scored) {
    if (picked.length >= maxDrafts) break;
    const cat = categoryOf(row.selection);
    if (cat === "politics" && politics >= MAX_POLITICS_PER_RUN) continue;
    if (cat === "sports" && sports >= MAX_SPORTS_PER_RUN) continue;
    picked.push(row.selection);
    if (cat === "politics") politics += 1;
    if (cat === "sports") sports += 1;
  }

  // Overflow politics/sports past the soft cap only when every remaining
  // fit-qualified selection is politics or sports (no film-tv/music/etc. left).
  if (picked.length < maxDrafts) {
    const pickedIds = new Set(picked.map((s) => s.eventId));
    const remaining = scored.filter((row) => !pickedIds.has(row.selection.eventId));
    const onlyPoliticsSportsLeft =
      remaining.length > 0 &&
      remaining.every((row) => {
        const cat = categoryOf(row.selection);
        return cat === "politics" || cat === "sports";
      });
    if (onlyPoliticsSportsLeft) {
      for (const row of remaining) {
        if (picked.length >= maxDrafts) break;
        picked.push(row.selection);
      }
    }
  }

  return picked;
}

async function fetchStratifiedCandidates(): Promise<ScoutCandidate[]> {
  const results = await Promise.all(
    SCOUT_SOURCE_BUCKETS.map(async (bucket) => {
      try {
        const rows = await fetchTrendingPolymarketEvents({
          limit: bucket.fetchLimit,
          tagId: bucket.tagId,
        });
        return rows.map(
          (c): ScoutCandidate => ({ ...c, sourceBucket: bucket.id }),
        );
      } catch (err) {
        log(
          `[MarketScout] Bucket "${bucket.id}" fetch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as ScoutCandidate[];
      }
    }),
  );

  const byId = new Map<string, ScoutCandidate>();
  // Tagged buckets first so high-volume entertainment events that also appear
  // on the global leaderboard keep their category label (movies/music/etc.)
  // for slot reservation. Global backfills only events not seen in a tag feed.
  for (const batch of results.slice(1)) {
    for (const c of batch) {
      if (!byId.has(c.eventId)) byId.set(c.eventId, c);
    }
  }
  for (const c of results[0] ?? []) {
    if (!byId.has(c.eventId)) byId.set(c.eventId, c);
  }
  return Array.from(byId.values());
}

// ---- Prompt ---------------------------------------------------------------

function buildSystemPrompt(maxDrafts: number, allowedCategories: string[]): string {
  return `You are the Market Scout for VoxDex, a play-money prediction platform about trending people and real-world events. You are given a list of currently-trending prediction markets from an external source. Curate the BEST candidates to import as VoxDex "World Markets" drafts for a human founder to review.

Selection principles:
- Pick broadly interesting, high-engagement questions a general entertainment/news audience would enjoy predicting on.
- Category variety is required. For a typical ${maxDrafts}-draft run: at most 2 politics and at most 2 sports. Prefer at least 1–2 from film-tv, music, creator, or comedy when those candidates are present in the list (sourceBucket movies/music/celebrities/tv are strong signals).
- Sports slot mix: when the shortlist includes a UFC or boxing main-card market headlined by a LINKABLE PERSON with competitive volume (roughly top ~20 sports candidates by volume24hUsd), include at least one such combat headliner when fitScore ≥ 55 — do not let a single ongoing tournament (e.g. World Cup) consume both sports slots while this kind of market is present.
- When quality is equal, prefer markets that can link to a LINKABLE PERSON from the list provided (main leaderboard or induction queue).
- Induction-queue names on the LINKABLE PEOPLE list are valid for relatedPeople / linkedPerson when genuinely relevant. Prefer them as linkedPerson when they are the face of the market (e.g. a company CEO for a company question).
- Skip anything that duplicates or nearly duplicates an EXISTING VoxDex market (list provided).
- ONE MARKET PER SERIES: VoxDex allows at most one unresolved market per series. A series is the same underlying question differing only by deadline, date, or numeric threshold (e.g. "Strait of Hormuz traffic normal by July 15?" and "...by July 31?" and "...recover by Dec 31?" are ONE series). Treat wording variants ("recover" vs "return to normal") as the same series when the subject and resolution condition are the same. Do NOT select any candidate whose series already appears in the EXISTING UNRESOLVED list. Distinct questions about the same topic stay separate series (e.g. Wimbledon Men's vs Women's; "Who wins X?" vs "Will Y happen at X?").
- Skip questions that are incomprehensible without the source platform's context, purely financial microstructure (e.g. hourly crypto candles), or distasteful (deaths, tragedies, graphic violence, invasive pregnancy/relationship gossip).
- Prefer questions resolving within days-to-months over ones resolving in a year.

For each selected market, produce:
- "title": the question rewritten in your own words, clear and punchy (max 120 chars, must end with "?").
- "slug": URL-safe kebab-case, lowercase letters/numbers/dashes only.
- "seriesKey": short stable kebab-case id for the series that IGNORES the specific deadline/threshold/date (e.g. "strait-of-hormuz-traffic-normal" for every Hormuz-by-date variant). Reuse the same key for siblings; never encode a date or threshold in the key.
- "teaser": one catchy sentence (max 140 chars) hooking a casual reader.
- "summary": 3-5 sentences (~60-110 words) of engaging BACKGROUND CONTEXT so a casual reader instantly gets why this market is interesting. Cover: what's happening, who the key players are, why it matters / what's at stake, and the current state of play or key date. Write it self-contained, neutral, and in your own words. Do NOT restate how the market resolves, outcome labels, "Other" catch-alls, or resolution mechanics — that belongs in resolutionCriteria only.
- "category": exactly one of: ${allowedCategories.join(", ")}. Use film-tv (not "entertainment") for movies/TV/awards.
- "secondaryCategories": 0-2 additional ids from the same list.
- "resolutionCriteria": 1-3 short bullet strings, IN YOUR OWN WORDS, stating precisely how the market resolves (source of truth, deadline, edge cases). Do not copy the source rules text. For knockout / single-elimination sports (drawEligible=false), criteria MUST say the market resolves to the team/player that wins the tie and advances (including extra time and penalties) — never "draw wins if level after regulation".
- "resolutionSources": 1-3 objects { "label": "...", "url"?: "..." } naming the AUTHORITATIVE real-world source(s) of truth a human would check to settle the market (e.g. "Official UK Parliament by-election result", "FIFA match report", "Box Office Mojo opening weekend"). Prefer a public URL when you know a stable one; omit url when unsure. NEVER include Polymarket, Kalshi, PredictIt, or other prediction-market platforms as sources.
- "scoutWatch": 1-2 sentences of leading indicators a user (and our resolution scout) should watch to know the outcome early. This is shown to users as "What to watch" — write it for a casual reader, not as internal ops notes.
- "relatedPeople": ALL names from the LINKABLE PEOPLE list genuinely relevant to this market — the subject of the question, anyone named in an outcome, or known key participants (use your own world knowledge: e.g. a country's star players for a scheduled national-team match, a company's famous CEO for a company question). For markets about a named work, release, album, tour, show, franchise, or event — even when the source text does not name people — include every linkable person you know is a principal participant (headline cast, billed artists, hosts, recurring leads). Do not stop at one marquee name when multiple linkable people are clearly attached to the same work. Exact names from the list only. Max 6. [] when none apply.
- "linkedPerson": the single most prominent name from relatedPeople — the "face" of the market; null if relatedPeople is empty.
- "fitScore": integer 0-100 for how well this fits VoxDex (engagement potential, clarity, settleability). Prefer 55+; weak fits should be omitted.
- "entryLabels": the outcome labels, SAME COUNT AND SAME ORDER as the source outcomes given for that event. You may shorten/clean labels but never reorder, add, or remove outcomes. Some multi-outcome events include a trailing synthesized "Other" catch-all — preserve it exactly as listed. (Code may later strip Draw when drawEligible is false.)
- "drawEligible": boolean. true when a regulation-time Draw/Tie is a valid FINAL result (group stage, league, round-robin). false for knockout / single-elimination / "must have a winner" ties (World Cup knockout, playoffs, cup ties) even if the source lists a Draw outcome for the 90-minute moneyline. Tennis/UFC/boxing with no Draw listed → true is fine (no Draw to strip). Prefer false whenever the title reads like "Who will win A vs B?" for a scheduled knockout.

Select AT MOST ${maxDrafts} markets. Quality over quantity — returning fewer (or zero) is correct when candidates are weak or duplicative.

Respond with ONE JSON object and nothing else — no markdown, no code fences:
{ "selections": [ { "eventId": "...", "title": "...", "slug": "...", "seriesKey": "...", "teaser": "...", "summary": "...", "category": "...", "secondaryCategories": [], "resolutionCriteria": ["..."], "resolutionSources": [{ "label": "...", "url": "..." }], "scoutWatch": "...", "linkedPerson": null, "relatedPeople": [], "fitScore": 0, "entryLabels": ["..."], "drawEligible": true } ] }`;
}

function buildUserPrompt(
  candidates: ScoutCandidate[],
  unresolvedMarkets: UnresolvedMarketRef[],
  trackedNames: string[],
): string {
  const candidateBlocks = candidates.map((c) => ({
    eventId: c.eventId,
    title: c.title,
    description: c.description ? c.description.slice(0, 2000) : null,
    endDate: c.endDate,
    volume24hUsd: Math.round(c.volume24hr),
    sourceBucket: c.sourceBucket,
    tags: c.tags.slice(0, 6),
    outcomes: c.outcomes.map((o) => ({ label: o.label, price: Number(o.price.toFixed(3)) })),
  }));

  const unresolvedBlock =
    unresolvedMarkets.length > 0
      ? unresolvedMarkets
          .map((m) =>
            m.seriesKey
              ? `- ${m.title} [seriesKey: ${m.seriesKey}]`
              : `- ${m.title}`,
          )
          .join("\n")
      : "(none)";

  return `CANDIDATE MARKETS (diversified shortlist — mix of global volume + category-tagged feeds):
${JSON.stringify(candidateBlocks, null, 1)}

EXISTING UNRESOLVED VOXDEX MARKETS (one per series max — do not draft siblings):
${unresolvedBlock}

LINKABLE PEOPLE (main leaderboard + induction queue — for relatedPeople / linkedPerson matching only — exact names):
${trackedNames.join(", ")}

Today's date: ${new Date().toISOString().split("T")[0]}. Curate now.`;
}

// ---- Curation call ---------------------------------------------------------

async function curateCandidates(
  candidates: ScoutCandidate[],
  unresolvedMarkets: UnresolvedMarketRef[],
  trackedNames: string[],
  maxDrafts: number,
  allowedCategories: string[],
): Promise<ScoutSelection[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await getOpenAIClient().responses.create(
      {
        model: getAiModel("marketScout"),
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: buildSystemPrompt(maxDrafts, allowedCategories),
        input: buildUserPrompt(candidates, unresolvedMarkets, trackedNames),
      } as any,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const outputText = extractOutputText(response);
    if (!outputText) return [];

    let jsonText = outputText.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed?.selections)) return [];

    return parsed.selections
      .filter(
        (s: unknown): s is ScoutSelection =>
          !!s &&
          typeof s === "object" &&
          typeof (s as any).eventId === "string" &&
          typeof (s as any).title === "string" &&
          Array.isArray((s as any).entryLabels),
      )
      .map((s: ScoutSelection) => ({
        ...s,
        seriesKey: normalizeSeriesKey(
          typeof (s as any).seriesKey === "string" ? (s as any).seriesKey : null,
          s.title,
        ),
        // Default true (keep Draw) when GPT omits the field — safer for
        // group-stage imports than accidentally stripping Draw.
        drawEligible: (s as any).drawEligible === false ? false : true,
        resolutionSources: Array.isArray((s as any).resolutionSources)
          ? (s as any).resolutionSources
          : [],
      }));
  } catch (err) {
    clearTimeout(timeout);
    log(
      `[MarketScout] Curation call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

// ---- Draft insertion -------------------------------------------------------

async function insertScoutedDraft(
  selection: ScoutSelection,
  candidate: PolymarketCandidate,
  ctx: {
    allowedCategoryIds: Set<string>;
    existingSlugs: Set<string>;
    /** normalizeNameKey(name) -> canonical tracked person. */
    peopleByKey: Map<string, { id: string; name: string }>;
    nextCmsOrder: number;
  },
): Promise<{ marketId: string; slug: string } | null> {
  const endAt = new Date(candidate.endDate);
  if (isNaN(endAt.getTime()) || endAt <= new Date()) {
    log(`[MarketScout] Skipping "${selection.title}" — invalid/past end date`);
    return null;
  }

  // Betting cutoff: default to endAt − AMM pre-resolve cooldown, but for
  // scheduled events (sports) the source exposes a kickoff time (gameStartTime)
  // well before the padded endDate — the result is public knowledge by then.
  // Close betting at the earlier of the two. Ignore a kickoff that is invalid
  // or already in the past at import time.
  const defaultCutoff = getMarketBettingCutoff(endAt, "amm", "community");
  let closeAt = defaultCutoff;
  if (candidate.gameStartTime) {
    const kickoff = new Date(candidate.gameStartTime);
    if (
      !isNaN(kickoff.getTime()) &&
      kickoff.getTime() > Date.now() &&
      kickoff.getTime() < defaultCutoff.getTime()
    ) {
      closeAt = kickoff;
    }
  }

  // Outcome labels must stay aligned with the source so the outcome
  // mapping (and the Phase 3 resolution watcher) stays trustworthy. GPT
  // may polish labels but any count mismatch OR positional drift (a label
  // that doesn't correspond to the source outcome at the same index —
  // e.g. a swapped Yes/No) falls back to the source labels wholesale.
  let sourceOutcomes = candidate.outcomes;
  const gptLabels = selection.entryLabels
    .map((l) => (typeof l === "string" ? l.trim() : ""))
    .filter(Boolean);
  const positionallyAligned =
    gptLabels.length === sourceOutcomes.length &&
    gptLabels.every((label, i) => {
      const a = label.toLowerCase();
      const b = sourceOutcomes[i].label.trim().toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
  let entryLabels = gptLabels;
  if (!positionallyAligned) {
    if (gptLabels.length > 0) {
      log(
        `[MarketScout] "${selection.title}" — GPT labels don't align positionally with source outcomes; using source labels`,
      );
    }
    entryLabels = sourceOutcomes.map((o) => o.label);
  }

  // Knockout / single-elimination: strip regulation-time Draw so the
  // market is two-team single-winner (who advances). Source mapping and
  // prices stay aligned with the remaining outcomes.
  const category = ctx.allowedCategoryIds.has(normalizeMarketCategory(selection.category))
    ? normalizeMarketCategory(selection.category)
    : "misc";

  const drawEligible = inferDrawEligibleForSportsImport({
    drawEligible: selection.drawEligible,
    category,
    entryLabels,
    externalSlug: candidate.eventSlug,
    tags: candidate.tags,
    title: selection.title,
    summary: selection.summary,
    description: candidate.description,
  });

  let resolutionCriteria = Array.isArray(selection.resolutionCriteria)
    ? selection.resolutionCriteria
        .map((c) => (typeof c === "string" ? c.trim() : ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const resolutionSources = sanitizeResolutionSources(selection.resolutionSources, {
    max: 3,
  });

  if (!drawEligible) {
    const stripped = stripDrawForKnockoutImport(sourceOutcomes, entryLabels);
    if (stripped.stripped) {
      sourceOutcomes = stripped.outcomes;
      entryLabels = stripped.labels;
      resolutionCriteria = normalizeKnockoutResolutionCriteria(resolutionCriteria);
      log(
        `[MarketScout] "${selection.title}" — knockout (drawEligible=false); stripped Draw → [${entryLabels.join(", ")}]`,
      );
    }
  }

  const openMarketType = entryLabels.length === 2 ? "binary" : "multi";
  if (
    openMarketType === "multi" &&
    (entryLabels.length < OPINION_POLL_MIN_OPTIONS || entryLabels.length > OPINION_POLL_MAX_OPTIONS)
  ) {
    log(`[MarketScout] Skipping "${selection.title}" — unsupported outcome count ${entryLabels.length}`);
    return null;
  }

  // Slug: prefer GPT's, fall back to the title; suffix on collision.
  let slug =
    typeof selection.slug === "string" && SLUG_REGEX.test(selection.slug.trim())
      ? selection.slug.trim()
      : slugifyTitle(selection.title);
  if (!slug) slug = `world-market-${Date.now().toString(36)}`;
  if (ctx.existingSlugs.has(slug)) {
    let i = 2;
    while (ctx.existingSlugs.has(`${slug}-${i}`)) i += 1;
    slug = `${slug}-${i}`;
  }

  const secondaryCategories = sanitizeSecondaryCategories(
    Array.isArray(selection.secondaryCategories) ? selection.secondaryCategories : [],
    category,
    ctx.allowedCategoryIds,
  );

  // Celebrity linking: union the LLM's suggestions (linkedPerson first, so
  // it stays the primary when valid) with the deterministic name scan over
  // the source text, validate every name against the tracked-people list,
  // and dedupe by person id. Unknown names are silently dropped — the scout
  // must never invent a link.
  const suggestedNames: string[] = [];
  if (typeof selection.linkedPerson === "string" && selection.linkedPerson.trim()) {
    suggestedNames.push(selection.linkedPerson);
  }
  if (Array.isArray(selection.relatedPeople)) {
    for (const n of selection.relatedPeople) {
      if (typeof n === "string" && n.trim()) suggestedNames.push(n);
    }
  }
  suggestedNames.push(...scanCandidateForTrackedPeople(candidate, ctx.peopleByKey.values()));

  const seenPersonIds = new Set<string>();
  const linkedPeople: Array<{ id: string; name: string }> = [];
  for (const name of suggestedNames) {
    if (linkedPeople.length >= MAX_LINKED_PEOPLE) break;
    const person = ctx.peopleByKey.get(normalizeNameKey(name));
    if (person && !seenPersonIds.has(person.id)) {
      seenPersonIds.add(person.id);
      linkedPeople.push(person);
    }
  }

  // Primary linked celebrity (market.personId) = first validated name;
  // everyone else goes to "Display on Profiles" (card_related_people).
  const linkedPersonId = linkedPeople[0]?.id ?? null;
  const relatedPersonIds = linkedPeople.slice(1).map((p) => p.id);

  const fitScore =
    typeof selection.fitScore === "number" && Number.isFinite(selection.fitScore)
      ? Math.max(0, Math.min(100, Math.round(selection.fitScore)))
      : null;

  const metadata: Record<string, unknown> = {
    source: {
      provider: "polymarket",
      externalId: candidate.eventId,
      externalSlug: candidate.eventSlug,
      url: candidate.url,
      structure: candidate.structure,
      gameStartTime: candidate.gameStartTime,
      // Baseline for source-watch time re-sync — so we know which schedule
      // we "own" and can detect admin manual edits (currentEndAt ≠ synced).
      // Normalize to ISO so comparisons with the watcher's Gamma snapshot
      // (also ISO) don't depend on Gamma's mixed timestamp formats.
      syncedEndDate: new Date(Date.parse(candidate.endDate)).toISOString(),
      syncedGameStartTime: candidate.gameStartTime,
      // Verbatim upstream rules prose (tie-breakers, "Other" clauses, etc.).
      // Shown in the admin resolve modal; GPT summary stays in resolutionCriteria.
      resolutionRulesText: candidate.description
        ? candidate.description.slice(0, 8000)
        : null,
      // Aligned with entry displayOrder — Phase 3 uses this to map the
      // source winner back to a VoxDex entry.
      outcomeMapping: sourceOutcomes.map((o, i) => ({
        entryLabel: entryLabels[i],
        sourceLabel: o.label,
        sourceMarketId: o.sourceMarketId,
        sourceOutcomeIndex: o.sourceOutcomeIndex,
        ...(o.isResidual ? { isResidual: true } : {}),
      })),
      // Aligned with entry displayOrder — Phase 2 price-matched seeding input.
      pricesAtImport: sourceOutcomes.map((o) => Number(o.price.toFixed(4))),
      volume24hrAtImport: Math.round(candidate.volume24hr),
      fetchedAt: new Date().toISOString(),
    },
    scoutedByMarketScout: true,
    seriesKey: normalizeSeriesKey(selection.seriesKey, selection.title),
    // Knockout single-winner: Draw must never be proposed/settled as winner.
    drawEligible,
    ...(drawEligible ? {} : { singleWinnerKnockout: true }),
  };
  if (fitScore !== null) metadata.fitScore = fitScore;
  if (typeof selection.scoutWatch === "string" && selection.scoutWatch.trim()) {
    // Cap length — this is user-facing "What to watch" as well as scout input.
    metadata.scoutWatch = selection.scoutWatch.trim().slice(0, 600);
  }

  // Advisory: should this market carry an "Other" catch-all? Persisted so the
  // admin edit modal can surface a recommendation next to the toggle. New
  // augmented-negRisk imports already ship an Other (auto-added above), so
  // this mostly documents why — but it also flags borderline/manual cases.
  if (openMarketType === "multi") {
    const namedPriceSum = sourceOutcomes
      .filter((o) => !isOtherStyleOutcomeLabel(o.label))
      .reduce((s, o) => s + o.price, 0);
    metadata.otherOutcomeAdvice = computeOtherOutcomeAdvice({
      structure: candidate.structure,
      entryLabels,
      namedPriceSum,
      augmentedNegRisk: candidate.augmentedNegRisk,
      hasExplicitOther: candidate.hasExplicitOther,
      placeholderCount: candidate.placeholderCount,
      title: selection.title,
    });
  }
  // Traceability: canonical names of everyone the scout auto-linked
  // (index 0 = primary). Founders can prune/extend in the edit modal.
  if (linkedPeople.length > 0) {
    metadata.scoutLinkedPeople = linkedPeople.map((p) => p.name);
  }

  const title = selection.title.trim().slice(0, 200);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(predictionMarkets)
      .values({
        marketType: "community",
        engine: "amm",
        title,
        slug,
        openMarketType,
        teaser: typeof selection.teaser === "string" ? selection.teaser.trim().slice(0, 200) || null : null,
        summary:
          typeof selection.summary === "string"
            ? selection.summary.trim().slice(0, 2000) || null
            : null,
        category,
        secondaryCategories,
        coverImageUrl: candidate.image || null,
        // Public source link deliberately left empty — the market page
        // renders `sourceUrl` to users, and VoxDex markets shouldn't ship
        // with a Polymarket link by default. The URL lives on in
        // metadata.source.url (admin provenance chip, resolution watcher),
        // and the edit modal offers a one-click fill for admins who DO
        // want it public.
        sourceUrl: null,
        featured: false,
        timezone: "UTC",
        startAt: new Date(),
        endAt,
        // AMM trading cutoff — earlier of (endAt − cooldown) and kickoff, so
        // the trade path and the slug bet route agree on when trading closes.
        closeAt,
        resolutionCriteria: resolutionCriteria.length > 0 ? resolutionCriteria : null,
        resolutionSources,
        resolveMethod: "admin_manual",
        status: "OPEN",
        // Draft: hidden from users, AMM house seed deferred until a founder
        // publishes it (batch-visibility / PATCH triggers the seed).
        visibility: "draft",
        isLive: false,
        personId: linkedPersonId,
        createdBy: SCOUT_PROFILE_ID,
        cmsDisplayOrder: ctx.nextCmsOrder,
        metadata,
      })
      .returning({ id: predictionMarkets.id });

    await tx.insert(marketEntries).values(
      entryLabels.map((label, i) => ({
        marketId: row.id,
        entryType: "custom" as const,
        label: label.slice(0, 120),
        displayOrder: i,
      })),
    );

    // "Display on Profiles" suggestions — secondary linked celebrities.
    // Plain insert (no sync/delete) is safe: the market row is brand new.
    if (relatedPersonIds.length > 0) {
      await tx.insert(cardRelatedPeople).values(
        relatedPersonIds.map((pid) => ({
          cardType: "world_market",
          cardId: row.id,
          personId: pid,
        })),
      );
    }

    return row;
  });

  ctx.existingSlugs.add(slug);
  return { marketId: created.id, slug };
}

// ---- Orchestration ---------------------------------------------------------

function emptyResult(): MarketScoutResult {
  return {
    enabled: scoutEnabled(),
    fetched: 0,
    deduped: 0,
    llmCalls: 0,
    budgetBlocked: false,
    created: 0,
    skipped: 0,
    seriesBlocked: 0,
    errors: 0,
    drafts: [],
  };
}

/**
 * Run one scout sweep: fetch trending source markets, curate with GPT,
 * insert drafts. No-op when the kill switch is off. Advisory-locked so the
 * daily scheduler and the manual admin trigger can't race.
 */
export async function runMarketScout(): Promise<MarketScoutResult> {
  if (!scoutEnabled()) {
    log("[MarketScout] Disabled (MARKET_SCOUT_ENABLED is off) — skipping.");
    return emptyResult();
  }

  const locked = await withDbAdvisoryLock(
    MARKET_SCOUT_LOCK_KEY,
    "MarketScout",
    runMarketScoutOnce,
  );
  if (!locked.acquired || !locked.result) {
    if (!locked.acquired) {
      log("[MarketScout] Skipping run; another instance holds the lock");
    }
    return emptyResult();
  }
  return locked.result;
}

async function runMarketScoutOnce(): Promise<MarketScoutResult> {
  const result = emptyResult();
  result.enabled = true;

  // 1. Fetch stratified candidates (global volume + category-tagged feeds).
  let candidates: ScoutCandidate[];
  try {
    candidates = await fetchStratifiedCandidates();
  } catch (err) {
    log(
      `[MarketScout] Source fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    result.errors += 1;
    return result;
  }
  result.fetched = candidates.length;
  if (candidates.length === 0) return result;

  // 2. Dedupe against already-imported source events (any status/visibility —
  //    a previously imported market must never come back, even after resolve).
  const communityRows = await db
    .select({
      title: predictionMarkets.title,
      slug: predictionMarkets.slug,
      status: predictionMarkets.status,
      visibility: predictionMarkets.visibility,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.marketType, "community"));

  const importedEventIds = new Set(
    communityRows
      .map((r) => readSourceExternalId(r.metadata))
      .filter((id): id is string => !!id),
  );
  const existingSlugs = new Set(communityRows.map((r) => r.slug));
  // Unresolved = OPEN (live or draft) or CLOSED_PENDING; archived never
  // occupies a series slot. RESOLVED/VOID free the slot for the next rung.
  const unresolvedRows = communityRows.filter((r) =>
    isUnresolvedCommunityMarket(r.status, r.visibility),
  );
  const unresolvedMarkets: UnresolvedMarketRef[] = unresolvedRows.map((r) => ({
    title: r.title,
    seriesKey: readSeriesKey(r.metadata),
  }));
  // Occupy both stored seriesKeys AND deadline-stripped title stems so
  // legacy unresolved markets (pre-seriesKey) still hard-block siblings.
  const occupiedSeriesKeys = new Set<string>();
  for (const m of unresolvedMarkets) {
    if (m.seriesKey) {
      occupiedSeriesKeys.add(normalizeSeriesKey(m.seriesKey, m.seriesKey));
    }
    occupiedSeriesKeys.add(normalizeSeriesKey(null, m.title));
  }

  const fresh = candidates.filter((c) => !importedEventIds.has(c.eventId));
  result.deduped = candidates.length - fresh.length;
  if (fresh.length === 0) {
    log("[MarketScout] All trending candidates already imported — nothing to curate.");
    return result;
  }

  const maxDrafts = maxDraftsPerRun();
  const forLlm = buildDiversifiedShortlist(fresh, MAX_CANDIDATES_FOR_LLM);
  log(
    `[MarketScout] Shortlist ${forLlm.length}/${fresh.length} fresh ` +
      `(buckets: ${SCOUT_SOURCE_BUCKETS.map((b) => {
        const n = forLlm.filter((c) => c.sourceBucket === b.id).length;
        return `${b.id}=${n}`;
      }).join(", ")})`,
  );
  if (forLlm.length === 0) {
    log("[MarketScout] No candidates passed shortlist/gossip filter — skipping curation.");
    return result;
  }

  // 3. Curate with GPT (single batch call, budget-railed).
  if (!tryReserveLlmCall()) {
    log("[MarketScout] Daily LLM budget exhausted — skipping curation.");
    result.budgetBlocked = true;
    return result;
  }
  result.llmCalls = 1;

  const allowedCategoryIds = await getAllowedCategoryIds();
  // Main leaderboard + active induction queue (shadow rows with an active
  // induction_candidates match). World Markets can feature induction people
  // on their profile Predict tab; inactive/rejected queue history is excluded.
  const people = await loadLinkablePeopleForScout();
  const peopleByKey = new Map(people.map((p) => [normalizeNameKey(p.name), p]));

  const selections = await curateCandidates(
    forLlm,
    unresolvedMarkets,
    people.map((p) => p.name),
    maxDrafts,
    Array.from(allowedCategoryIds),
  );

  if (selections.length === 0) {
    log("[MarketScout] Curation returned no selections.");
    return result;
  }

  // 4. Soft diversity + fit floor, then hard series-slot filter, then insert.
  const candidateById = new Map(forLlm.map((c) => [c.eventId, c]));
  const guarded = applySelectionDiversityGuards(selections, candidateById, maxDrafts);
  if (guarded.length < selections.length) {
    log(
      `[MarketScout] Diversity/fit guards kept ${guarded.length}/${selections.length} GPT selections`,
    );
  }

  const { kept, blocked } = filterSelectionsBySeries(guarded, occupiedSeriesKeys);
  result.seriesBlocked = blocked.length;
  if (blocked.length > 0) {
    log(
      `[MarketScout] Series filter blocked ${blocked.length}/${guarded.length} ` +
        `(occupiedKeys=${occupiedSeriesKeys.size}): ` +
        blocked.map((s) => `"${s.title}"`).join(", "),
    );
  }

  const [cmsMax] = await db
    .select({ max: sql<number>`COALESCE(MAX(cms_display_order), 0)` })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.marketType, "community"));
  let nextCmsOrder = (cmsMax?.max || 0) + 1;

  for (const selection of kept) {
    const candidate = candidateById.get(selection.eventId);
    if (!candidate) {
      result.skipped += 1;
      continue;
    }
    try {
      const inserted = await insertScoutedDraft(selection, candidate, {
        allowedCategoryIds,
        existingSlugs,
        peopleByKey,
        nextCmsOrder,
      });
      if (!inserted) {
        result.skipped += 1;
        continue;
      }
      nextCmsOrder += 1;
      result.created += 1;
      // Occupy both the LLM key and the title stem for subsequent picks
      // in this same run (defensive; filterSelectionsBySeries already first-wins).
      occupiedSeriesKeys.add(normalizeSeriesKey(selection.seriesKey, selection.title));
      occupiedSeriesKeys.add(normalizeSeriesKey(null, selection.title));
      result.drafts.push({
        marketId: inserted.marketId,
        title: selection.title,
        slug: inserted.slug,
        fitScore:
          typeof selection.fitScore === "number" && Number.isFinite(selection.fitScore)
            ? Math.round(selection.fitScore)
            : null,
        sourceUrl: candidate.url,
      });
    } catch (err) {
      result.errors += 1;
      log(
        `[MarketScout] Draft insert failed for "${selection.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log(
    `[MarketScout] fetched=${result.fetched} deduped=${result.deduped} ` +
      `llmCalls=${result.llmCalls} created=${result.created} ` +
      `skipped=${result.skipped} seriesBlocked=${result.seriesBlocked} ` +
      `errors=${result.errors}`,
  );

  return result;
}

// ===========================================================================
// Source resolution watcher (Phase 3)
// ===========================================================================
//
// For scouted markets (metadata.source.provider = 'polymarket'), the source
// market resolves authoritatively upstream. This watcher polls Gamma for
// resolutions and, when the source has settled on a *live or inactive*
// VoxDex market, writes a `metadata.scoutAssessment` (stage 'met', action
// 'resolve_now', with the mapped `proposedWinnerEntryId`) — the exact shape
// the resolution scout uses, so the settlement center + AmmResolutionDialog
// surface it with the winner pre-selected. Draft/archived markets only get
// `upstreamResolvedAt` stamped (so we stop re-polling) — never a settle
// recommendation, since they were never made live. It NEVER settles
// anything: a founder confirms with one click. Zero LLM cost, so it runs
// regardless of MARKET_SCOUT_ENABLED.

interface SourceOutcomeMappingEntry {
  entryLabel?: string;
  sourceLabel?: string;
  sourceMarketId?: string;
  sourceOutcomeIndex?: number;
  /** True for a VoxDex-synthesized residual "Other" with no upstream market. */
  isResidual?: boolean;
}

interface WatchableSource {
  provider?: string;
  externalId?: string;
  url?: string;
  outcomeMapping?: SourceOutcomeMappingEntry[];
  gameStartTime?: string | null;
  /** Last source endDate we applied (or adopted). Used to detect admin overrides. */
  syncedEndDate?: string | null;
  syncedGameStartTime?: string | null;
  lastTimeSyncAt?: string;
  /** Set by the watcher after the upstream resolution is recorded, so
   *  future runs skip the API call. */
  upstreamResolvedAt?: string;
}

export interface SourceWatchResult {
  /** Scouted markets checked against the source this run. */
  checked: number;
  /** Markets whose upstream source has resolved (assessment written). */
  resolvedUpstream: number;
  /** Upstream resolved but the winner couldn't be mapped to an entry. */
  unmappable: number;
  /** Markets whose live source prices were refreshed this run. */
  livePricesRefreshed: number;
  /** Markets whose endAt/closeAt were re-synced from a source reschedule. */
  timesResynced: number;
  /** Markets whose closeAt was frozen because the outcome became public. */
  autoLocked: number;
  errors: number;
  findings: Array<{
    marketId: string;
    title: string;
    slug: string;
    proposedWinnerLabel: string;
  }>;
}

function readWatchableSource(metadata: unknown): WatchableSource | null {
  if (!metadata || typeof metadata !== "object") return null;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return null;
  const s = source as WatchableSource;
  if (s.provider !== "polymarket" || typeof s.externalId !== "string") return null;
  return s;
}

function readAutoLockedAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).autoLockedAt;
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Poll upstream resolutions for scouted markets that are still OPEN or
 * CLOSED_PENDING. Advisory-locked; safe to trigger concurrently with the
 * daily scheduler.
 */
export async function runSourceResolutionWatch(): Promise<SourceWatchResult> {
  const empty: SourceWatchResult = {
    checked: 0,
    resolvedUpstream: 0,
    unmappable: 0,
    livePricesRefreshed: 0,
    timesResynced: 0,
    autoLocked: 0,
    errors: 0,
    findings: [],
  };
  const locked = await withDbAdvisoryLock(
    SOURCE_WATCH_LOCK_KEY,
    "MarketScoutSourceWatch",
    runSourceResolutionWatchOnce,
  );
  if (!locked.acquired || !locked.result) {
    if (!locked.acquired) {
      log("[MarketScout] Source watch skipped; another instance holds the lock");
    }
    return empty;
  }
  return locked.result;
}

async function runSourceResolutionWatchOnce(): Promise<SourceWatchResult> {
  const result: SourceWatchResult = {
    checked: 0,
    resolvedUpstream: 0,
    unmappable: 0,
    livePricesRefreshed: 0,
    timesResynced: 0,
    autoLocked: 0,
    errors: 0,
    findings: [],
  };

  const rows = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      slug: predictionMarkets.slug,
      status: predictionMarkets.status,
      visibility: predictionMarkets.visibility,
      openMarketType: predictionMarkets.openMarketType,
      closeAt: predictionMarkets.closeAt,
      endAt: predictionMarkets.endAt,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
      ),
    );

  const resyncEnabled = sourceTimeResyncEnabled();
  const autoLockEnabled = autoLockOnResolutionEnabled();
  const cooldownMs = getAmmCooldownMs();

  for (const row of rows) {
    const source = readWatchableSource(row.metadata);
    if (!source || source.upstreamResolvedAt) continue;
    const mapping = Array.isArray(source.outcomeMapping) ? source.outcomeMapping : [];
    if (mapping.length === 0) continue;

    result.checked += 1;

    const snapshot = await fetchPolymarketEventResolutions(source.externalId!);
    if (!snapshot) {
      result.errors += 1;
      continue;
    }
    const { resolutions, endDate: sourceEndDate, gameStartTime: sourceGameStartTime } =
      snapshot;

    // ---- Time re-sync (flag-gated) ----------------------------------------
    // When Polymarket reschedules, update our endAt/closeAt using the same
    // formula as scout import. Skip if already auto-locked or admin-edited.
    const alreadyLocked = !!readAutoLockedAt(row.metadata);
    if (
      resyncEnabled &&
      !alreadyLocked &&
      row.status === "OPEN" &&
      sourceEndDate &&
      row.endAt
    ) {
      const decision = shouldApplyResync({
        currentEndAt: new Date(row.endAt),
        syncedEndDate: source.syncedEndDate ?? null,
        sourceEndDate,
        syncedGameStartTime: source.syncedGameStartTime ?? source.gameStartTime ?? null,
        sourceGameStartTime,
      });

      if (decision.apply && decision.isLegacyBaselineAdopt) {
        // First encounter on a pre-baseline market: record ownership without
        // moving times (current already matches source).
        try {
          const payload = {
            source: {
              ...source,
              syncedEndDate: sourceEndDate,
              syncedGameStartTime: sourceGameStartTime,
              lastTimeSyncAt: new Date().toISOString(),
            },
          };
          await db
            .update(predictionMarkets)
            .set({
              metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
              updatedAt: new Date(),
            })
            .where(eq(predictionMarkets.id, row.id));
          // Keep local source in sync for the rest of this iteration.
          source.syncedEndDate = sourceEndDate;
          source.syncedGameStartTime = sourceGameStartTime;
        } catch (err) {
          result.errors += 1;
          log(
            `[MarketScout] Legacy baseline adopt failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (decision.apply) {
        const times = computeResyncedTimes({
          sourceEndDate,
          sourceGameStartTime,
          cooldownMs,
        });
        if (times) {
          const prevEnd = row.endAt;
          const prevClose = row.closeAt;
          const endChanged =
            !prevEnd ||
            Math.abs(times.endAt.getTime() - new Date(prevEnd).getTime()) > 60_000;
          const closeChanged =
            !prevClose ||
            Math.abs(times.closeAt.getTime() - new Date(prevClose).getTime()) > 60_000;

          // Kickoff can move without affecting our cutoff (e.g. still after
          // endAt − cooldown). Refresh the synced baseline so we don't
          // re-detect the same move every watch tick, but skip the write
          // + ops alert when nothing user-facing changed.
          if (!endChanged && !closeChanged) {
            try {
              const payload = {
                source: {
                  ...source,
                  gameStartTime: sourceGameStartTime,
                  syncedEndDate: sourceEndDate,
                  syncedGameStartTime: sourceGameStartTime,
                  lastTimeSyncAt: new Date().toISOString(),
                },
              };
              await db
                .update(predictionMarkets)
                .set({
                  metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
                  updatedAt: new Date(),
                })
                .where(eq(predictionMarkets.id, row.id));
              source.syncedEndDate = sourceEndDate;
              source.syncedGameStartTime = sourceGameStartTime;
              source.gameStartTime = sourceGameStartTime;
            } catch (err) {
              result.errors += 1;
              log(
                `[MarketScout] Baseline refresh after no-op schedule drift failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          } else {
          try {
            const syncedAt = new Date().toISOString();
            const payload = {
              source: {
                ...source,
                gameStartTime: sourceGameStartTime,
                syncedEndDate: sourceEndDate,
                syncedGameStartTime: sourceGameStartTime,
                lastTimeSyncAt: syncedAt,
              },
            };
            await db
              .update(predictionMarkets)
              .set({
                endAt: times.endAt,
                closeAt: times.closeAt,
                metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
                updatedAt: new Date(),
              })
              .where(eq(predictionMarkets.id, row.id));
            result.timesResynced += 1;
            row.endAt = times.endAt;
            row.closeAt = times.closeAt;
            source.syncedEndDate = sourceEndDate;
            source.syncedGameStartTime = sourceGameStartTime;
            source.gameStartTime = sourceGameStartTime;
            log(
              `[MarketScout] Time re-sync for "${row.title}" — endAt ${prevEnd?.toISOString?.() ?? prevEnd} → ${times.endAt.toISOString()} ` +
                `(market=${row.id.slice(0, 8)})`,
            );

            void (async () => {
              try {
                const { sendOpsAlert, adminResolveMarketUrl } = await import(
                  "../services/ops-alerts"
                );
                await sendOpsAlert({
                  kind: "market_source_rescheduled",
                  severity: "info",
                  title: "Scouted market rescheduled on Polymarket",
                  summary: `"${row.title}" source times changed — VoxDex endAt/closeAt were auto-updated.`,
                  sections: [
                    {
                      heading: "Schedule change",
                      items: [
                        {
                          text: row.title,
                          detail:
                            `endAt: ${prevEnd instanceof Date ? prevEnd.toISOString() : String(prevEnd)} → ${times.endAt.toISOString()}` +
                            (prevClose
                              ? ` · closeAt: ${prevClose instanceof Date ? prevClose.toISOString() : String(prevClose)} → ${times.closeAt.toISOString()}`
                              : ` · closeAt: → ${times.closeAt.toISOString()}`),
                          url: adminResolveMarketUrl(row.id),
                        },
                      ],
                    },
                  ],
                  ctaUrl: adminResolveMarketUrl(row.id),
                  ctaLabel: "Review market",
                  idempotencyKeyBase: `market_source_rescheduled:${row.id}:${sourceEndDate}:${sourceGameStartTime ?? "none"}`,
                });
              } catch (err) {
                log(
                  `[MarketScout] Reschedule ops alert failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            })();
          } catch (err) {
            result.errors += 1;
            log(
              `[MarketScout] Time re-sync failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          }
        }
      }
    }

    // An entry wins when its source market resolved with the entry's
    // outcome index as the winner. Binary markets map both entries to
    // the same source market (indices 0/1); multi (negRisk) events map
    // each entry to its own market's "Yes" side (index 0). Exactly one
    // winner must emerge — anything else (void, split, partial data)
    // stays with the human.
    const entryLabels = await db
      .select({ id: marketEntries.id, label: marketEntries.label, displayOrder: marketEntries.displayOrder })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, row.id))
      .orderBy(asc(marketEntries.displayOrder));
    if (entryLabels.length !== mapping.length) {
      // Entries were edited after import; mapping no longer trustworthy.
      continue;
    }

    // Auto-resolve SHADOW MODE (read-only): whenever this watcher reaches a
    // resolution signal below, log what auto-resolve WOULD do vs. what a
    // human actually settles. Never affects settlement. No-op unless
    // AUTO_RESOLVE_SHADOW_ENABLED. `upstreamResolved` is true at every call
    // site (they all sit under an all-closed / upstream-settled branch).
    const shadowKnockout = isSingleWinnerKnockoutMarket(
      row.metadata,
      knockoutHintsFromRow(row, entryLabels),
    );
    const emitShadow = (partial: {
      stage: string;
      recommendedAction: string;
      confidence: number;
      proposedWinnerEntryId: string | null;
      proposedWinnerLabel: string | null;
      isResidualOther: boolean;
    }) => {
      logAutoResolveShadowDecision({
        marketId: row.id,
        title: row.title,
        slug: row.slug,
        marketType: "community",
        openMarketType: row.openMarketType ?? null,
        signalSource: "source_watch",
        entryCount: entryLabels.length,
        isKnockoutSingleWinner: shadowKnockout,
        upstreamResolved: true,
        ...partial,
      });
    };

    // Residual "Other" rows have no upstream market — they don't participate
    // in the closed check. Require every named source market to be closed.
    const namedMappings = mapping.filter((m) => !m.isResidual && !!m.sourceMarketId);
    const allClosed =
      namedMappings.length > 0 &&
      namedMappings.every((m) => resolutions.get(m.sourceMarketId!)?.closed === true);

    // Resolve a mapping row to a VoxDex entry by LABEL first (robust to
    // admins reordering entries after import), falling back to position
    // only when the positional label still matches. An admin who renamed
    // AND reordered entries defeats both checks — that market stays with
    // the human rather than risking a wrong proposed winner.
    const entriesByLabel = new Map<string, Array<{ id: string; label: string }>>();
    for (const e of entryLabels) {
      const key = e.label.trim().toLowerCase();
      const bucket = entriesByLabel.get(key) ?? [];
      bucket.push(e);
      entriesByLabel.set(key, bucket);
    }
    const resolveMappedEntry = (m: SourceOutcomeMappingEntry, positionalIdx: number) => {
      for (const candidate of [m.entryLabel, m.sourceLabel]) {
        if (typeof candidate !== "string" || !candidate.trim()) continue;
        const bucket = entriesByLabel.get(candidate.trim().toLowerCase());
        if (bucket?.length === 1) return bucket[0];
      }
      const positional = entryLabels[positionalIdx];
      const positionalMatches =
        positional &&
        [m.entryLabel, m.sourceLabel].some(
          (l) => typeof l === "string" && l.trim().toLowerCase() === positional.label.trim().toLowerCase(),
        );
      return positionalMatches ? positional : null;
    };

    const winners: Array<{ entryId: string; label: string }> = [];
    let unmappedWinner = false;
    for (let i = 0; i < mapping.length; i++) {
      const m = mapping[i];
      if (!m.sourceMarketId || typeof m.sourceOutcomeIndex !== "number") continue;
      const res = resolutions.get(m.sourceMarketId);
      if (res?.winningOutcomeIndex === m.sourceOutcomeIndex) {
        const entry = resolveMappedEntry(m, i);
        if (entry) {
          winners.push({ entryId: entry.id, label: entry.label });
        } else {
          unmappedWinner = true;
        }
      }
    }

    /** Freeze closeAt when the outcome is public knowledge (flag-gated). */
    const tryAutoLock = async (reason: string): Promise<boolean> => {
      if (!autoLockEnabled || row.status !== "OPEN") return false;
      if (readAutoLockedAt(row.metadata)) return false;
      const lockAt = computeLockCloseAt(row.closeAt);
      if (!lockAt) return false;
      const lockedAt = new Date().toISOString();
      try {
        const payload = {
          autoLockedAt: lockedAt,
          autoLockReason: reason,
        };
        await db
          .update(predictionMarkets)
          .set({
            closeAt: lockAt,
            metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(predictionMarkets.id, row.id));
        row.closeAt = lockAt;
        if (row.metadata && typeof row.metadata === "object") {
          (row.metadata as Record<string, unknown>).autoLockedAt = lockedAt;
        }
        result.autoLocked += 1;
        log(
          `[MarketScout] Auto-locked trading for "${row.title}" (${reason}) ` +
            `(market=${row.id.slice(0, 8)})`,
        );
        return true;
      } catch (err) {
        result.errors += 1;
        log(
          `[MarketScout] Auto-lock failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    };

    // Draft / archived: never recommend settlement. If upstream is done,
    // stamp upstreamResolvedAt so we stop re-polling; still allow live
    // price refresh below when the source is open.
    const settlementEligible = isSettlementEligibleVisibility(row.visibility);
    const wouldRecommendSettlement =
      winners.length === 1 && !unmappedWinner ? true : allClosed;
    if (wouldRecommendSettlement && !settlementEligible) {
      const assessedAt = new Date().toISOString();
      try {
        const payload = {
          source: { ...source, upstreamResolvedAt: assessedAt },
        };
        await db
          .update(predictionMarkets)
          .set({
            metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(predictionMarkets.id, row.id));
        log(
          `[MarketScout] Upstream resolved for ${row.visibility ?? "non-live"} ` +
            `"${row.title}" — skipping settle recommendation ` +
            `(market=${row.id.slice(0, 8)})`,
        );
      } catch (err) {
        result.errors += 1;
        log(
          `[MarketScout] Failed to stamp upstreamResolvedAt for non-live ` +
            `${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    if (unmappedWinner || winners.length !== 1) {
      if (allClosed) {
        // Prefer a residual / catch-all "Other" entry when every named
        // upstream outcome clearly lost (Yes-side = No) — settles cleanly
        // instead of voiding. Skip when any named market is ambiguous
        // (closed without a ~1 price) or we failed to map a winner.
        const allNamedClearlyLost =
          !unmappedWinner &&
          winners.length === 0 &&
          namedMappings.length > 0 &&
          namedMappings.every((m) => {
            const res = resolutions.get(m.sourceMarketId!);
            return (
              res?.closed === true &&
              typeof res.winningOutcomeIndex === "number" &&
              res.winningOutcomeIndex !== m.sourceOutcomeIndex
            );
          });

        // Knockout single-winner (Draw stripped at import, or flagged):
        // Polymarket's 90-min Draw winning means both team sub-markets lost.
        // Do NOT void / propose Other — ask the operator to confirm who
        // advanced in ET/penalties.
        if (
          allNamedClearlyLost &&
          isSingleWinnerKnockoutMarket(
            row.metadata,
            knockoutHintsFromRow(row, entryLabels),
          )
        ) {
          result.resolvedUpstream += 1;
          await tryAutoLock("upstream_knockout_level_at_90");
          await persistSingleWinnerKnockoutFlag(row.id);

          const assessedAt = new Date().toISOString();
          const assessment = {
            leaning: "Confirm advancing team",
            proposedWinnerEntryId: null as string | null,
            confidence: 0.9,
            stage: "near_certain" as const,
            recommendedAction: "resolve_soon" as const,
            whatChanged:
              "Polymarket's 90-minute moneyline settled Draw (level after regulation). " +
              "This is a single-winner knockout — confirm which team advanced in " +
              "extra time / penalties before settling. Do not resolve Draw.",
            sources: source.url ? [source.url] : [],
            assessedAt,
            signature: `near_certain|resolve_soon|knockout_confirm_advancer`,
          };

          emitShadow({
            stage: assessment.stage,
            recommendedAction: assessment.recommendedAction,
            confidence: assessment.confidence,
            proposedWinnerEntryId: assessment.proposedWinnerEntryId,
            proposedWinnerLabel: assessment.leaning,
            isResidualOther: false,
          });

          try {
            const payload: Record<string, unknown> = {
              scoutAssessment: assessment,
              source: { ...source, upstreamResolvedAt: assessedAt },
            };
            await db
              .update(predictionMarkets)
              .set({
                metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
                updatedAt: new Date(),
              })
              .where(eq(predictionMarkets.id, row.id));

            result.findings.push({
              marketId: row.id,
              title: row.title,
              slug: row.slug,
              proposedWinnerLabel: "Confirm advancing team",
            });
            log(
              `[MarketScout] Knockout level-at-90 for "${row.title}" — awaiting advancing team ` +
                `(market=${row.id.slice(0, 8)})`,
            );

            void (async () => {
              try {
                const { sendOpsAlert, adminResolveMarketUrl } = await import(
                  "../services/ops-alerts"
                );
                await sendOpsAlert({
                  kind: "market_source_resolved",
                  severity: "info",
                  title: "Knockout market needs advancing team",
                  summary:
                    `"${row.title}" was level after regulation on Polymarket. ` +
                    `Confirm which team advanced (ET/pens) — do not settle Draw.`,
                  sections: [
                    {
                      heading: "Confirm advancing team",
                      items: [
                        {
                          text: row.title,
                          detail:
                            "Level after 90 minutes — resolve to the team that advanced",
                          url: adminResolveMarketUrl(row.id),
                        },
                      ],
                    },
                  ],
                  ctaUrl: adminResolveMarketUrl(row.id),
                  ctaLabel: "Confirm & resolve",
                  idempotencyKeyBase: `knockout_confirm_advancer:${row.id}`,
                });
              } catch (err) {
                log(
                  `[MarketScout] Knockout confirm-advancer ops alert failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            })();
          } catch (err) {
            result.errors += 1;
            log(
              `[MarketScout] Knockout confirm-advancer write failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          continue;
        }

        const residualMappingIdx = mapping.findIndex((m) => m.isResidual === true);
        const residualMapped =
          residualMappingIdx >= 0
            ? resolveMappedEntry(mapping[residualMappingIdx], residualMappingIdx)
            : null;
        const otherEntry = allNamedClearlyLost
          ? residualMapped ??
            entryLabels.find((e) => isOtherStyleOutcomeLabel(e.label))
          : undefined;

        if (otherEntry) {
          result.resolvedUpstream += 1;
          await tryAutoLock("upstream_resolved_other");

          const assessedAt = new Date().toISOString();
          const assessment = {
            leaning: otherEntry.label,
            proposedWinnerEntryId: otherEntry.id,
            confidence: 0.99,
            stage: "met" as const,
            recommendedAction: "resolve_now" as const,
            whatChanged:
              `Source market on Polymarket closed with no listed name winning — ` +
              `proposing "${otherEntry.label || OTHER_OUTCOME_LABEL}". Verify and settle.`,
            sources: source.url ? [source.url] : [],
            assessedAt,
            signature: `met|resolve_now|${otherEntry.id}`,
          };

          emitShadow({
            stage: assessment.stage,
            recommendedAction: assessment.recommendedAction,
            confidence: assessment.confidence,
            proposedWinnerEntryId: assessment.proposedWinnerEntryId,
            proposedWinnerLabel: assessment.leaning,
            isResidualOther: true,
          });

          try {
            const payload: Record<string, unknown> = {
              scoutAssessment: assessment,
              source: { ...source, upstreamResolvedAt: assessedAt },
            };
            await db
              .update(predictionMarkets)
              .set({
                metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
                updatedAt: new Date(),
              })
              .where(eq(predictionMarkets.id, row.id));

            result.findings.push({
              marketId: row.id,
              title: row.title,
              slug: row.slug,
              proposedWinnerLabel: otherEntry.label,
            });
            log(
              `[MarketScout] Upstream closed with no named winner for "${row.title}" — proposing "${otherEntry.label}" ` +
                `(market=${row.id.slice(0, 8)})`,
            );

            void (async () => {
              try {
                const { sendOpsAlert, adminResolveMarketUrl } = await import(
                  "../services/ops-alerts"
                );
                await sendOpsAlert({
                  kind: "market_source_resolved",
                  severity: "info",
                  title: "Scouted market resolved on Polymarket",
                  summary:
                    `"${row.title}" resolved upstream with no listed name winning — ` +
                    `proposed winner "${otherEntry.label}" is pre-filled in Settlement.`,
                  sections: [
                    {
                      heading: "Ready to settle (one-click confirm)",
                      items: [
                        {
                          text: row.title,
                          detail: `Proposed winner: ${otherEntry.label}`,
                          url: adminResolveMarketUrl(row.id),
                        },
                      ],
                    },
                  ],
                  ctaUrl: adminResolveMarketUrl(row.id),
                  ctaLabel: "Confirm & resolve",
                  idempotencyKeyBase: `market_source_resolved:${row.id}`,
                });
              } catch (err) {
                log(
                  `[MarketScout] Other-outcome ops alert failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            })();
          } catch (err) {
            result.errors += 1;
            log(
              `[MarketScout] Failed to persist Other assessment for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          continue;
        }

        // Upstream fully closed but no clean single winner (voided /
        // ambiguous/cancelled) and no catch-all Other entry. Surface in
        // the Needs Resolution dashboard via scoutAssessment (OPEN +
        // resolve_now) and ping ops — escalate only, never auto-void.
        // Still lock trading when the flag is on.
        result.unmappable += 1;
        await tryAutoLock("upstream_closed_unmappable");

        const assessedAt = new Date().toISOString();
        const assessment = {
          leaning: "Void / review",
          proposedWinnerEntryId: null as string | null,
          confidence: 0.99,
          stage: "met" as const,
          recommendedAction: "resolve_now" as const,
          whatChanged:
            "Upstream resolved on Polymarket with no mappable single winner " +
            "(cancelled, voided, or outcomes no longer match). Review and void.",
          sources: source.url ? [source.url] : [],
          assessedAt,
          signature: `met|resolve_now|void_unmappable`,
        };

        emitShadow({
          stage: assessment.stage,
          recommendedAction: assessment.recommendedAction,
          confidence: assessment.confidence,
          proposedWinnerEntryId: assessment.proposedWinnerEntryId,
          proposedWinnerLabel: assessment.leaning,
          isResidualOther: false,
        });

        try {
          const payload: Record<string, unknown> = {
            scoutAssessment: assessment,
            source: { ...source, upstreamResolvedAt: assessedAt },
          };
          await db
            .update(predictionMarkets)
            .set({
              metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
              updatedAt: new Date(),
            })
            .where(eq(predictionMarkets.id, row.id));
        } catch (err) {
          result.errors += 1;
          log(
            `[MarketScout] Failed to persist unmappable assessment for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        log(
          `[MarketScout] Source event ${source.externalId} closed without a mappable winner ` +
            `for market=${row.id.slice(0, 8)} (winners=${winners.length})`,
        );

        void (async () => {
          try {
            const { sendOpsAlert, adminResolveMarketUrl } = await import(
              "../services/ops-alerts"
            );
            await sendOpsAlert({
              kind: "market_source_unmappable",
              severity: "warning",
              title: "Scouted market needs manual void/review",
              summary:
                `"${row.title}" closed upstream without a mappable winner — ` +
                `review and void (or pick an outcome) in Settlement.`,
              sections: [
                {
                  heading: "Upstream closed — no mappable winner",
                  items: [
                    {
                      text: row.title,
                      detail: `Winners mapped: ${winners.length}. Suggest void.`,
                      url: adminResolveMarketUrl(row.id),
                    },
                  ],
                },
              ],
              ctaUrl: adminResolveMarketUrl(row.id),
              ctaLabel: "Review & void",
              idempotencyKeyBase: `market_source_unmappable:${row.id}`,
            });
          } catch (err) {
            log(
              `[MarketScout] Unmappable ops alert failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        })();
      } else {
        // Source still open: refresh the live consensus prices. These are
        // the fair-value anchor for agent convergence on scouted markets
        // (metadata.source.livePrices, aligned with pricesAtImport /
        // entry displayOrder). Residual "Other" rows have no upstream
        // market — fill them with max(0, 1 − Σ named). Best effort.
        const livePrices: number[] = [];
        let pricesComplete = true;
        let namedSum = 0;
        let residualIdx = -1;
        for (let i = 0; i < mapping.length; i++) {
          const m = mapping[i];
          if (m.isResidual || !m.sourceMarketId) {
            residualIdx = i;
            livePrices.push(0); // placeholder; filled below
            continue;
          }
          if (typeof m.sourceOutcomeIndex !== "number") {
            pricesComplete = false;
            break;
          }
          const res = resolutions.get(m.sourceMarketId);
          const p = res?.prices?.[m.sourceOutcomeIndex];
          if (typeof p !== "number" || !Number.isFinite(p)) {
            pricesComplete = false;
            break;
          }
          const rounded = Number(p.toFixed(4));
          livePrices.push(rounded);
          namedSum += rounded;
        }
        if (pricesComplete && livePrices.length === mapping.length) {
          if (residualIdx >= 0) {
            livePrices[residualIdx] = Number(Math.max(0, 1 - namedSum).toFixed(4));
          }
          try {
            const payload = {
              source: {
                ...source,
                livePrices,
                livePricesAt: new Date().toISOString(),
              },
            };
            await db
              .update(predictionMarkets)
              .set({
                metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
                updatedAt: new Date(),
              })
              .where(eq(predictionMarkets.id, row.id));
            result.livePricesRefreshed += 1;
          } catch (err) {
            result.errors += 1;
            log(
              `[MarketScout] Live price refresh failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      continue;
    }

    const winner = winners[0];

    // Flagged knockout that still lists Draw (e.g. France vs Spain mid-flight):
    // never propose Draw even when Polymarket's 90-min Draw sub-market won.
    if (
      isSingleWinnerKnockoutMarket(
        row.metadata,
        knockoutHintsFromRow(row, entryLabels),
      ) &&
      isDrawStyleOutcomeLabel(winner.label)
    ) {
      result.resolvedUpstream += 1;
      await tryAutoLock("upstream_knockout_draw_blocked");
      await persistSingleWinnerKnockoutFlag(row.id);

      const assessedAt = new Date().toISOString();
      const assessment = {
        leaning: "Confirm advancing team",
        proposedWinnerEntryId: null as string | null,
        confidence: 0.9,
        stage: "near_certain" as const,
        recommendedAction: "resolve_soon" as const,
        whatChanged:
          `Source market on Polymarket resolved "Draw" (level after regulation). ` +
          `This is a single-winner knockout — confirm which team advanced in ` +
          `extra time / penalties. Do not settle Draw.`,
        sources: source.url ? [source.url] : [],
        assessedAt,
        signature: `near_certain|resolve_soon|knockout_draw_blocked`,
      };

      emitShadow({
        stage: assessment.stage,
        recommendedAction: assessment.recommendedAction,
        confidence: assessment.confidence,
        proposedWinnerEntryId: assessment.proposedWinnerEntryId,
        proposedWinnerLabel: assessment.leaning,
        isResidualOther: false,
      });

      try {
        const payload: Record<string, unknown> = {
          scoutAssessment: assessment,
          source: { ...source, upstreamResolvedAt: assessedAt },
          singleWinnerKnockout: true,
          drawEligible: false,
        };
        await db
          .update(predictionMarkets)
          .set({
            metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(predictionMarkets.id, row.id));

        result.findings.push({
          marketId: row.id,
          title: row.title,
          slug: row.slug,
          proposedWinnerLabel: "Confirm advancing team",
        });
        log(
          `[MarketScout] Blocked Draw proposal on knockout "${row.title}" ` +
            `(market=${row.id.slice(0, 8)})`,
        );

        void (async () => {
          try {
            const { sendOpsAlert, adminResolveMarketUrl } = await import(
              "../services/ops-alerts"
            );
            await sendOpsAlert({
              kind: "market_source_resolved",
              severity: "info",
              title: "Knockout market needs advancing team",
              summary:
                `"${row.title}" — Polymarket settled Draw (90 min). ` +
                `Confirm which team advanced — do not settle Draw.`,
              sections: [
                {
                  heading: "Confirm advancing team",
                  items: [
                    {
                      text: row.title,
                      detail: "Level after 90 minutes — pick the team that advanced",
                      url: adminResolveMarketUrl(row.id),
                    },
                  ],
                },
              ],
              ctaUrl: adminResolveMarketUrl(row.id),
              ctaLabel: "Confirm & resolve",
              idempotencyKeyBase: `knockout_draw_blocked:${row.id}`,
            });
          } catch (err) {
            log(
              `[MarketScout] Knockout Draw-blocked ops alert failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        })();
      } catch (err) {
        result.errors += 1;
        log(
          `[MarketScout] Knockout Draw-block write failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    const assessedAt = new Date().toISOString();
    const assessment = {
      leaning: winner.label,
      proposedWinnerEntryId: winner.entryId,
      confidence: 0.99,
      stage: "met" as const,
      recommendedAction: "resolve_now" as const,
      whatChanged: `Source market on Polymarket has resolved: "${winner.label}" won. Verify and settle.`,
      sources: source.url ? [source.url] : [],
      assessedAt,
      signature: `met|resolve_now|${winner.entryId}`,
    };

    emitShadow({
      stage: assessment.stage,
      recommendedAction: assessment.recommendedAction,
      confidence: assessment.confidence,
      proposedWinnerEntryId: assessment.proposedWinnerEntryId,
      proposedWinnerLabel: assessment.leaning,
      isResidualOther: isOtherStyleOutcomeLabel(winner.label),
    });

    try {
      // JSONB merge (same pattern as resolution-scout) so we never
      // clobber concurrent metadata writers. `source` is deep-merged
      // manually since `||` is a shallow merge at the top level.
      const lockAt =
        autoLockEnabled && row.status === "OPEN" && !readAutoLockedAt(row.metadata)
          ? computeLockCloseAt(row.closeAt)
          : null;
      const payload: Record<string, unknown> = {
        scoutAssessment: assessment,
        source: { ...source, upstreamResolvedAt: assessedAt },
      };
      if (lockAt) {
        payload.autoLockedAt = assessedAt;
        payload.autoLockReason = "upstream_resolved";
      }
      await db
        .update(predictionMarkets)
        .set({
          ...(lockAt ? { closeAt: lockAt } : {}),
          metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(predictionMarkets.id, row.id));

      if (lockAt) {
        result.autoLocked += 1;
        log(
          `[MarketScout] Auto-locked trading for "${row.title}" (upstream_resolved) ` +
            `(market=${row.id.slice(0, 8)})`,
        );
      }

      result.resolvedUpstream += 1;
      result.findings.push({
        marketId: row.id,
        title: row.title,
        slug: row.slug,
        proposedWinnerLabel: winner.label,
      });
      log(
        `[MarketScout] Upstream resolved for "${row.title}" — proposing "${winner.label}" ` +
          `(market=${row.id.slice(0, 8)})`,
      );

      // Instant ops ping (fire-and-forget, idempotent per market): the
      // source may resolve while our market is still OPEN, so without
      // this the pre-filled winner sits unseen until the daily digest.
      void (async () => {
        try {
          const { sendOpsAlert, adminResolveMarketUrl } = await import(
            "../services/ops-alerts"
          );
          await sendOpsAlert({
            kind: "market_source_resolved",
            severity: "info",
            title: "Scouted market resolved on Polymarket",
            summary: `"${row.title}" resolved upstream — proposed winner "${winner.label}" is pre-filled in Settlement.`,
            sections: [
              {
                heading: "Ready to settle (one-click confirm)",
                items: [
                  {
                    text: row.title,
                    detail: `Proposed winner: ${winner.label}`,
                    url: adminResolveMarketUrl(row.id),
                  },
                ],
              },
            ],
            // One tap from the email straight to the resolve dialog with the
            // proposed winner pre-selected.
            ctaUrl: adminResolveMarketUrl(row.id),
            ctaLabel: "Confirm & resolve",
            idempotencyKeyBase: `market_source_resolved:${row.id}`,
          });
        } catch (err) {
          log(
            `[MarketScout] Source-resolved ops alert failed for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    } catch (err) {
      result.errors += 1;
      log(
        `[MarketScout] Failed to persist upstream resolution for ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (result.checked > 0) {
    log(
      `[MarketScout] Source watch — checked=${result.checked} resolvedUpstream=${result.resolvedUpstream} ` +
        `unmappable=${result.unmappable} livePricesRefreshed=${result.livePricesRefreshed} ` +
        `timesResynced=${result.timesResynced} autoLocked=${result.autoLocked} errors=${result.errors}`,
    );
  }

  return result;
}
