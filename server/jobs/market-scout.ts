/**
 * Market Scout — automated World Market sourcing (draft-only).
 *
 * Once a day (or on an admin "Scan now" trigger), pulls the trending events
 * from Polymarket's public Gamma API, dedupes them against existing VoxDex
 * markets, asks GPT to curate the best fits (rewriting each question in
 * VoxDex voice — never copying source rules text verbatim), and inserts the
 * winners as DRAFT World Markets for a founder to review, edit, and publish.
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
import { cardRelatedPeople, contentCategories, marketEntries, predictionMarkets, trackedPeople } from "@shared/schema";
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
import {
  fetchPolymarketEventResolutions,
  fetchTrendingPolymarketEvents,
  type PolymarketCandidate,
} from "../providers/polymarket";

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
const MAX_OUTPUT_TOKENS = 4_000;
/** How many raw trending events to pull from Gamma per run. Generous because
 *  many trending events are filtered out (same-day sports, non-exhaustive
 *  outcome sets, already imported). */
const FETCH_LIMIT = 150;
/** How many deduped candidates to show GPT (largest 24h volume first). */
const MAX_CANDIDATES_FOR_LLM = 30;

function scoutEnabled(): boolean {
  return envFlag(process.env.MARKET_SCOUT_ENABLED);
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
  errors: number;
  drafts: ScoutDraftSummary[];
}

/** Shape GPT must return for each curated market. */
interface ScoutSelection {
  eventId: string;
  title: string;
  slug: string;
  teaser: string;
  summary: string;
  category: string;
  secondaryCategories: string[];
  resolutionCriteria: string[];
  scoutWatch: string;
  linkedPerson: string | null;
  relatedPeople: string[];
  fitScore: number;
  entryLabels: string[];
}

// ---- Helpers ---------------------------------------------------------------

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

/** Lowercase, strip diacritics, collapse whitespace — canonical key for name matching. */
function normalizeNameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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

// ---- Prompt ---------------------------------------------------------------

function buildSystemPrompt(maxDrafts: number, allowedCategories: string[]): string {
  return `You are the Market Scout for VoxDex, a play-money prediction platform about trending people and real-world events. You are given a list of currently-trending prediction markets from an external source. Curate the BEST candidates to import as VoxDex "World Markets" drafts for a human founder to review.

Selection principles:
- Pick broadly interesting, high-engagement questions a general entertainment/news audience would enjoy predicting on. Variety across categories beats five markets on one theme.
- Skip anything that duplicates or nearly duplicates an EXISTING VoxDex market (list provided).
- Skip questions that are incomprehensible without the source platform's context, purely financial microstructure (e.g. hourly crypto candles), or distasteful (deaths, tragedies, graphic violence).
- Prefer questions resolving within days-to-months over ones resolving in a year.

For each selected market, produce:
- "title": the question rewritten in your own words, clear and punchy (max 120 chars, must end with "?").
- "slug": URL-safe kebab-case, lowercase letters/numbers/dashes only.
- "teaser": one catchy sentence (max 140 chars) hooking a casual reader.
- "summary": 2-3 sentences of neutral context explaining what the market is about.
- "category": exactly one of: ${allowedCategories.join(", ")}.
- "secondaryCategories": 0-2 additional ids from the same list.
- "resolutionCriteria": 1-3 short bullet strings, IN YOUR OWN WORDS, stating precisely how the market resolves (source of truth, deadline, edge cases). Do not copy the source rules text.
- "scoutWatch": one sentence listing the leading indicators a human should watch to know the outcome early.
- "relatedPeople": ALL names from the TRACKED PEOPLE list genuinely relevant to this market — the subject of the question, anyone named in an outcome, or known key participants (use your own world knowledge: e.g. a country's star players for a scheduled national-team match, a company's famous CEO for a company question). Exact names from the list only. Max 6. [] when none apply.
- "linkedPerson": the single most prominent name from relatedPeople — the "face" of the market; null if relatedPeople is empty.
- "fitScore": integer 0-100 for how well this fits VoxDex (engagement potential, clarity, settleability).
- "entryLabels": the outcome labels, SAME COUNT AND SAME ORDER as the source outcomes given for that event. You may shorten/clean labels but never reorder, add, or remove outcomes.

Select AT MOST ${maxDrafts} markets. Quality over quantity — returning fewer (or zero) is correct when candidates are weak or duplicative.

Respond with ONE JSON object and nothing else — no markdown, no code fences:
{ "selections": [ { "eventId": "...", "title": "...", "slug": "...", "teaser": "...", "summary": "...", "category": "...", "secondaryCategories": [], "resolutionCriteria": ["..."], "scoutWatch": "...", "linkedPerson": null, "relatedPeople": [], "fitScore": 0, "entryLabels": ["..."] } ] }`;
}

function buildUserPrompt(
  candidates: PolymarketCandidate[],
  existingTitles: string[],
  trackedNames: string[],
): string {
  const candidateBlocks = candidates.map((c) => ({
    eventId: c.eventId,
    title: c.title,
    description: c.description ? c.description.slice(0, 400) : null,
    endDate: c.endDate,
    volume24hUsd: Math.round(c.volume24hr),
    tags: c.tags.slice(0, 6),
    outcomes: c.outcomes.map((o) => ({ label: o.label, price: Number(o.price.toFixed(3)) })),
  }));

  return `CANDIDATE MARKETS (trending by 24h volume):
${JSON.stringify(candidateBlocks, null, 1)}

EXISTING VOXDEX MARKET TITLES (do not duplicate):
${existingTitles.length > 0 ? existingTitles.map((t) => `- ${t}`).join("\n") : "(none)"}

TRACKED PEOPLE (for relatedPeople / linkedPerson matching only — exact names):
${trackedNames.join(", ")}

Today's date: ${new Date().toISOString().split("T")[0]}. Curate now.`;
}

// ---- Curation call ---------------------------------------------------------

async function curateCandidates(
  candidates: PolymarketCandidate[],
  existingTitles: string[],
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
        input: buildUserPrompt(candidates, existingTitles, trackedNames),
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

    return parsed.selections.filter(
      (s: unknown): s is ScoutSelection =>
        !!s &&
        typeof s === "object" &&
        typeof (s as any).eventId === "string" &&
        typeof (s as any).title === "string" &&
        Array.isArray((s as any).entryLabels),
    );
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
  const sourceOutcomes = candidate.outcomes;
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

  const category = ctx.allowedCategoryIds.has(normalizeMarketCategory(selection.category))
    ? normalizeMarketCategory(selection.category)
    : "misc";
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

  const resolutionCriteria = Array.isArray(selection.resolutionCriteria)
    ? selection.resolutionCriteria
        .map((c) => (typeof c === "string" ? c.trim() : ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const metadata: Record<string, unknown> = {
    source: {
      provider: "polymarket",
      externalId: candidate.eventId,
      externalSlug: candidate.eventSlug,
      url: candidate.url,
      structure: candidate.structure,
      gameStartTime: candidate.gameStartTime,
      // Aligned with entry displayOrder — Phase 3 uses this to map the
      // source winner back to a VoxDex entry.
      outcomeMapping: sourceOutcomes.map((o, i) => ({
        entryLabel: entryLabels[i],
        sourceLabel: o.label,
        sourceMarketId: o.sourceMarketId,
        sourceOutcomeIndex: o.sourceOutcomeIndex,
      })),
      // Aligned with entry displayOrder — Phase 2 price-matched seeding input.
      pricesAtImport: sourceOutcomes.map((o) => Number(o.price.toFixed(4))),
      volume24hrAtImport: Math.round(candidate.volume24hr),
      fetchedAt: new Date().toISOString(),
    },
    scoutedByMarketScout: true,
  };
  if (fitScore !== null) metadata.fitScore = fitScore;
  if (typeof selection.scoutWatch === "string" && selection.scoutWatch.trim()) {
    metadata.scoutWatch = selection.scoutWatch.trim();
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
        summary: typeof selection.summary === "string" ? selection.summary.trim() || null : null,
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

  // 1. Fetch trending candidates from the source.
  let candidates: PolymarketCandidate[];
  try {
    candidates = await fetchTrendingPolymarketEvents({ limit: FETCH_LIMIT });
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
  // Only open/draft titles matter for duplicate-question detection.
  const existingTitles = communityRows
    .filter((r) => r.status === "OPEN" && r.visibility !== "archived")
    .map((r) => r.title);

  const fresh = candidates.filter((c) => !importedEventIds.has(c.eventId));
  result.deduped = candidates.length - fresh.length;
  if (fresh.length === 0) {
    log("[MarketScout] All trending candidates already imported — nothing to curate.");
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
  // Main-leaderboard people only: tracked_people also retains induction-queue
  // rows (including demoted ex-leaderboard people), and linking those to a
  // market would point at someone with no live leaderboard presence.
  const people = await db
    .select({ id: trackedPeople.id, name: trackedPeople.name })
    .from(trackedPeople)
    .where(eq(trackedPeople.status, "main_leaderboard"));
  const peopleByKey = new Map(people.map((p) => [normalizeNameKey(p.name), p]));

  const maxDrafts = maxDraftsPerRun();
  const forLlm = fresh.slice(0, MAX_CANDIDATES_FOR_LLM);
  const selections = await curateCandidates(
    forLlm,
    existingTitles,
    people.map((p) => p.name),
    maxDrafts,
    Array.from(allowedCategoryIds),
  );

  if (selections.length === 0) {
    log("[MarketScout] Curation returned no selections.");
    return result;
  }

  // 4. Insert drafts.
  const candidateById = new Map(forLlm.map((c) => [c.eventId, c]));
  const [cmsMax] = await db
    .select({ max: sql<number>`COALESCE(MAX(cms_display_order), 0)` })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.marketType, "community"));
  let nextCmsOrder = (cmsMax?.max || 0) + 1;

  for (const selection of selections.slice(0, maxDrafts)) {
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
      `skipped=${result.skipped} errors=${result.errors}`,
  );

  return result;
}

// ===========================================================================
// Source resolution watcher (Phase 3)
// ===========================================================================
//
// For scouted markets (metadata.source.provider = 'polymarket'), the source
// market resolves authoritatively upstream. This watcher polls Gamma for
// resolutions and, when the source has settled, writes a
// `metadata.scoutAssessment` (stage 'met', action 'resolve_now', with the
// mapped `proposedWinnerEntryId`) — the exact shape the resolution scout
// uses, so the settlement center + AmmResolutionDialog surface it with the
// winner pre-selected. It NEVER settles anything: a founder confirms with
// one click. Zero LLM cost, so it runs regardless of MARKET_SCOUT_ENABLED.

interface SourceOutcomeMappingEntry {
  entryLabel?: string;
  sourceLabel?: string;
  sourceMarketId?: string;
  sourceOutcomeIndex?: number;
}

interface WatchableSource {
  provider?: string;
  externalId?: string;
  url?: string;
  outcomeMapping?: SourceOutcomeMappingEntry[];
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
    errors: 0,
    findings: [],
  };

  const rows = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      slug: predictionMarkets.slug,
      status: predictionMarkets.status,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
      ),
    );

  for (const row of rows) {
    const source = readWatchableSource(row.metadata);
    if (!source || source.upstreamResolvedAt) continue;
    const mapping = Array.isArray(source.outcomeMapping) ? source.outcomeMapping : [];
    if (mapping.length === 0) continue;

    result.checked += 1;

    const resolutions = await fetchPolymarketEventResolutions(source.externalId!);
    if (!resolutions) {
      result.errors += 1;
      continue;
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

    const allClosed = mapping.every((m) => {
      const res = m.sourceMarketId ? resolutions.get(m.sourceMarketId) : undefined;
      return res?.closed === true;
    });

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

    if (unmappedWinner || winners.length !== 1) {
      if (allClosed) {
        // Upstream fully closed but no clean single winner (voided /
        // ambiguous). Flag for the human without proposing a winner.
        result.unmappable += 1;
        log(
          `[MarketScout] Source event ${source.externalId} closed without a mappable winner ` +
            `for market=${row.id.slice(0, 8)} (winners=${winners.length})`,
        );
      } else {
        // Source still open: refresh the live consensus prices. These are
        // the fair-value anchor for agent convergence on scouted markets
        // (metadata.source.livePrices, aligned with pricesAtImport /
        // entry displayOrder). Best effort — any gap skips the refresh.
        const livePrices: number[] = [];
        let pricesComplete = true;
        for (const m of mapping) {
          if (!m.sourceMarketId || typeof m.sourceOutcomeIndex !== "number") {
            pricesComplete = false;
            break;
          }
          const res = resolutions.get(m.sourceMarketId);
          const p = res?.prices?.[m.sourceOutcomeIndex];
          if (typeof p !== "number" || !Number.isFinite(p)) {
            pricesComplete = false;
            break;
          }
          livePrices.push(Number(p.toFixed(4)));
        }
        if (pricesComplete && livePrices.length === mapping.length) {
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

    try {
      // JSONB merge (same pattern as resolution-scout) so we never
      // clobber concurrent metadata writers. `source` is deep-merged
      // manually since `||` is a shallow merge at the top level.
      const payload = {
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
          const { sendOpsAlert, adminDashboardUrl, getAdminBaseUrl } = await import(
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
                    url: `${getAdminBaseUrl()}/markets/${row.slug}`,
                  },
                ],
              },
            ],
            ctaUrl: adminDashboardUrl(),
            ctaLabel: "Open Settlement Center",
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
        `unmappable=${result.unmappable} livePricesRefreshed=${result.livePricesRefreshed} errors=${result.errors}`,
    );
  }

  return result;
}
