/**
 * AI early-resolution scout (alert / propose only).
 *
 * Once a day, scans open World Markets (community) and asks GPT — with web
 * search — whether anything has happened in the real world that moves the
 * market toward resolution (condition met, near-certain, or a material
 * development worth a heads-up). It NEVER settles anything: it writes its
 * assessment to `prediction_markets.metadata.scoutAssessment` and returns
 * the actionable findings for the daily ops digest to surface. A human
 * still confirms every resolution.
 *
 * Design notes:
 *   - Kill switch: RESOLUTION_SCOUT_LLM_ENABLED (default OFF). When off,
 *     this is a no-op that returns empty findings.
 *   - Budget rail: a per-run cap derived from RESOLUTION_SCOUT_DAILY_BUDGET_USD
 *     / RESOLUTION_SCOUT_PER_CALL_ESTIMATE_USD bounds worst-case spend.
 *   - Hybrid prioritisation: when there are more open markets than the budget
 *     allows, markets are ranked (1) closing-soon, (2) news-spiking (linked to
 *     a heated main-leaderboard person — free shock-event signal from the
 *     ingest job, no extra API spend), then (3) round-robin by least-recently
 *     scanned, so no market is ever permanently starved.
 *   - Change detection: each market stores a `signature` (stage|action|winner);
 *     a finding is "changed" when the new signature differs from the stored
 *     one, so the digest can lead with what's new instead of repeating the
 *     same standing every day.
 *   - Watch criteria: `metadata.scoutWatch` (admin-authored, AI-suggested)
 *     tells the model exactly which leading indicators to look for.
 */

import OpenAI from "openai";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db, withDbAdvisoryLock } from "../db";
import { marketEntries, predictionMarkets, trackedPeople } from "@shared/schema";
import { log } from "../log";
import { getAiModel } from "../config/ai-models";
import { getTrendContextBatch } from "../services/trend-context";
import { computeLockCloseAt } from "./market-time-sync-utils";

const RESOLUTION_SCOUT_LOCK_KEY = 5_211;

/** Markets resolving within this window are always top priority to scan. */
const CLOSING_SOON_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Only main-leaderboard people get fresh daily trend data (news/wiki). */
const MAIN_LEADERBOARD_STATUS = "main_leaderboard";

// ---- Config ---------------------------------------------------------------

function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

const API_TIMEOUT_MS = 45_000;
/**
 * Generous on purpose: on reasoning models (gpt-5.x) `max_output_tokens`
 * also covers invisible reasoning tokens, and with web_search in the loop
 * a 500 cap truncated the JSON mid-string on ~60% of calls (Jul 2026
 * production logs: "Unterminated string in JSON" / "Empty response").
 * 2000 leaves the model room to reason AND emit the full object; the cost
 * delta is fractions of a cent per call under the daily budget rail.
 */
const MAX_OUTPUT_TOKENS = 2_000;

function scoutEnabled(): boolean {
  return envFlag(process.env.RESOLUTION_SCOUT_LLM_ENABLED);
}

/** Auto-lock trading when scout stage is "met". Default OFF. */
function autoLockOnResolutionEnabled(): boolean {
  return envFlag(process.env.AUTO_LOCK_ON_RESOLUTION_ENABLED);
}

function dailyBudgetUsd(): number {
  const raw = Number(process.env.RESOLUTION_SCOUT_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5.0;
}

function perCallEstimateUsd(): number {
  const raw = Number(process.env.RESOLUTION_SCOUT_PER_CALL_ESTIMATE_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.4;
}

/** Max LLM calls allowed in a single run (per-run budget rail). */
function maxCallsPerRun(): number {
  return Math.max(1, Math.floor(dailyBudgetUsd() / perCallEstimateUsd()));
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

export type ScoutStage = "watch" | "likely" | "near_certain" | "met";
export type ScoutAction = "none" | "watch" | "resolve_soon" | "resolve_now";

export interface ScoutAssessment {
  /** Human-readable leaning, e.g. "Yes" / the leading outcome label. */
  leaning: string;
  /** Entry id of the proposed winning outcome, when one is clear. */
  proposedWinnerEntryId: string | null;
  /** 0..1 confidence in the leaning. */
  confidence: number;
  stage: ScoutStage;
  recommendedAction: ScoutAction;
  /** One sentence describing the latest development vs the prior check. */
  whatChanged: string;
  sources: string[];
  assessedAt: string;
  /** stage|action|winner — used for change detection. */
  signature: string;
}

export interface ScoutFinding {
  marketId: string;
  title: string;
  slug: string;
  assessment: ScoutAssessment;
  /** True when the signature changed since the previous run. */
  changed: boolean;
}

export interface ResolutionScoutResult {
  enabled: boolean;
  scanned: number;
  llmCalls: number;
  budgetBlocked: number;
  errors: number;
  /** Markets whose closeAt was frozen because stage === "met". */
  autoLocked: number;
  findings: ScoutFinding[];
}

interface ScoutMarket {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  teaser: string | null;
  endAt: Date;
  closeAt: Date | null;
  status: string;
  resolutionCriteria: string[] | null;
  metadata: unknown;
  /** Linked celebrity (for the news-spike priority lane). */
  personId: string | null;
}

interface ScoutEntry {
  id: string;
  label: string;
  displayOrder: number;
}

// ---- Helpers --------------------------------------------------------------

const STAGE_RANK: Record<ScoutStage, number> = {
  watch: 0,
  likely: 1,
  near_certain: 2,
  met: 3,
};

const ACTION_RANK: Record<ScoutAction, number> = {
  none: 0,
  watch: 1,
  resolve_soon: 2,
  resolve_now: 3,
};

/** A finding is worth surfacing when it isn't the quiet "nothing happening"
 *  baseline (stage=watch AND action=none). */
function isActionable(a: ScoutAssessment): boolean {
  return STAGE_RANK[a.stage] > 0 || ACTION_RANK[a.recommendedAction] > 0;
}

function readStoredSignature(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const prev = (metadata as Record<string, unknown>).scoutAssessment as
    | Partial<ScoutAssessment>
    | undefined;
  if (!prev || typeof prev !== "object") return null;
  return typeof prev.signature === "string" ? prev.signature : null;
}

function readScoutWatch(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const watch = (metadata as Record<string, unknown>).scoutWatch;
  if (typeof watch === "string" && watch.trim()) return watch.trim();
  if (Array.isArray(watch) && watch.length) {
    return watch.filter((x) => typeof x === "string").join("; ");
  }
  return null;
}

function previousWhatChanged(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const prev = (metadata as Record<string, unknown>).scoutAssessment as
    | Partial<ScoutAssessment>
    | undefined;
  return prev && typeof prev.whatChanged === "string" ? prev.whatChanged : null;
}

/** Epoch-ms of the market's last scout assessment (0 if never scanned). Drives
 *  the round-robin lane so the least-recently-scanned markets rotate in. */
function readLastAssessedAtMs(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const prev = (metadata as Record<string, unknown>).scoutAssessment as
    | Partial<ScoutAssessment>
    | undefined;
  if (!prev || typeof prev.assessedAt !== "string") return 0;
  const ms = Date.parse(prev.assessedAt);
  return Number.isFinite(ms) ? ms : 0;
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
  for (const item of response.output) {
    if (item.type === "text" && item.text) return item.text;
    if (typeof item.text === "string" && item.text.trim().startsWith("{")) {
      return item.text;
    }
  }
  return null;
}

function clampConfidence(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0.5;
  return Math.max(0, Math.min(1, v));
}

function normalizeStage(s: unknown): ScoutStage {
  return s === "likely" || s === "near_certain" || s === "met" ? s : "watch";
}

function normalizeAction(a: unknown): ScoutAction {
  return a === "watch" || a === "resolve_soon" || a === "resolve_now"
    ? a
    : "none";
}

// ---- Prompt ---------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are the resolution scout for VoxDex, a prediction-market platform. Your job is to monitor a real-world prediction market and report whether anything has happened that moves it toward resolution. You DO NOT resolve markets — a human operator confirms every outcome. Your output is an advisory heads-up.

Use web search to find the most recent, credible information relevant to this specific market's resolution criteria. Prefer primary sources and reputable outlets. Always cite the URLs you relied on.

Classify the market's current state:
- stage "met": the resolution condition is now definitively satisfied (or definitively impossible). The market can be resolved.
- stage "near_certain": ~95%+ likely pending only a formality (e.g. an athlete named in the confirmed starting line-up for a match that will be played; a vote scheduled with a near-certain result).
- stage "likely": leaning strongly toward one outcome but not yet certain.
- stage "watch": status quo; no strong signal yet.

Recommend an action:
- "resolve_now": stage is "met" — propose the winning outcome.
- "resolve_soon": near-certain — propose the likely winner; the operator should resolve once the formality completes.
- "watch": a material development worth flagging even though it isn't resolvable yet.
- "none": nothing noteworthy since the last check.

Be honest and conservative about certainty. If sources conflict or you cannot verify, use stage "watch" and action "watch" or "none". The "whatChanged" field must describe the single most important recent development relative to the previous check (or "No material change." if nothing is new).

Respond with ONE JSON object and nothing else — no markdown, no code fences:
{
  "selectedOutcomeIndex": <1-based integer matching an outcome, or null if unclear>,
  "leaning": "<short label of the leading outcome, e.g. Yes / a name>",
  "confidence": <number 0..1>,
  "stage": "watch" | "likely" | "near_certain" | "met",
  "recommendedAction": "none" | "watch" | "resolve_soon" | "resolve_now",
  "whatChanged": "<one sentence>",
  "sources": ["<url>", ...]
}`;
}

function buildUserPrompt(
  market: ScoutMarket,
  entries: ScoutEntry[],
  watch: string | null,
  prevWhatChanged: string | null,
): string {
  const outcomes = entries
    .map((e, i) => `${i + 1}. ${e.label?.trim() || `Outcome ${i + 1}`}`)
    .join("\n");
  const criteria = market.resolutionCriteria?.length
    ? market.resolutionCriteria.join("; ")
    : "Not specified";
  const resolutionDate = market.endAt
    ? market.endAt.toISOString().split("T")[0]
    : "Not specified";

  return `MARKET: ${market.title}
CATEGORY: ${market.category ?? "General"}
TEASER: ${market.teaser ?? "N/A"}
RESOLUTION DATE (deadline): ${resolutionDate}
RESOLUTION CRITERIA: ${criteria}
WHAT TO WATCH FOR: ${watch ?? "Infer the key leading indicators from the title and resolution criteria."}

OUTCOMES:
${outcomes}

PREVIOUS SCOUT NOTE: ${prevWhatChanged ?? "None (first check)."}

Today's date: ${new Date().toISOString().split("T")[0]}. Search the web and assess this market now.`;
}

// ---- Per-market assessment ------------------------------------------------

async function assessMarket(
  market: ScoutMarket,
  entries: ScoutEntry[],
): Promise<ScoutAssessment | null> {
  const watch = readScoutWatch(market.metadata);
  const prevWhatChanged = previousWhatChanged(market.metadata);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await getOpenAIClient().responses.create(
      {
        model: getAiModel("resolutionScout"),
        tools: [{ type: "web_search" as any }],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: buildSystemPrompt(),
        input: buildUserPrompt(market, entries, watch, prevWhatChanged),
      } as any,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const outputText = extractOutputText(response);
    if (!outputText) {
      log(`[ResolutionScout] Empty response for market=${market.id.slice(0, 8)}`);
      return null;
    }

    let jsonText = outputText.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    // Resilience: models sometimes wrap the object in prose or citation
    // markup despite the instructions. Parse the outermost {...} span.
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace > 0 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonText);

    const stage = normalizeStage(parsed.stage);
    const recommendedAction = normalizeAction(parsed.recommendedAction);
    const confidence = clampConfidence(parsed.confidence);

    let proposedWinnerEntryId: string | null = null;
    let leaning =
      typeof parsed.leaning === "string" && parsed.leaning.trim()
        ? parsed.leaning.trim()
        : "Unclear";
    const idx =
      typeof parsed.selectedOutcomeIndex === "number"
        ? parsed.selectedOutcomeIndex - 1
        : -1;
    if (idx >= 0 && idx < entries.length) {
      proposedWinnerEntryId = entries[idx].id;
      if (leaning === "Unclear") leaning = entries[idx].label;
    }

    const sources = Array.isArray(parsed.sources)
      ? parsed.sources
          .filter((s: unknown) => typeof s === "string" && s.startsWith("http"))
          .slice(0, 5)
      : [];

    const whatChanged =
      typeof parsed.whatChanged === "string" && parsed.whatChanged.trim()
        ? parsed.whatChanged.trim()
        : "No material change.";

    const signature = `${stage}|${recommendedAction}|${proposedWinnerEntryId ?? "none"}`;

    return {
      leaning,
      proposedWinnerEntryId,
      confidence,
      stage,
      recommendedAction,
      whatChanged,
      sources,
      assessedAt: new Date().toISOString(),
      signature,
    };
  } catch (err) {
    clearTimeout(timeout);
    log(
      `[ResolutionScout] Assessment failed for market=${market.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function writeAssessment(
  marketId: string,
  assessment: ScoutAssessment,
): Promise<void> {
  try {
    const payload = { scoutAssessment: assessment };
    await db
      .update(predictionMarkets)
      .set({
        metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, marketId));
  } catch (err) {
    log(
      `[ResolutionScout] Failed to persist assessment for ${marketId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---- Orchestration --------------------------------------------------------

function emptyResult(): ResolutionScoutResult {
  return {
    enabled: scoutEnabled(),
    scanned: 0,
    llmCalls: 0,
    budgetBlocked: 0,
    errors: 0,
    autoLocked: 0,
    findings: [],
  };
}

/**
 * Run the scout across all open World Markets. Returns actionable findings
 * (the digest surfaces them); writes every assessment to market metadata.
 * No-op (empty findings) when the kill switch is off. Advisory-locked so the
 * standalone cron endpoint can't race the digest's inline scout and double
 * the LLM spend.
 */
export async function runResolutionScout(): Promise<ResolutionScoutResult> {
  if (!scoutEnabled()) {
    log("[ResolutionScout] Disabled (RESOLUTION_SCOUT_LLM_ENABLED is off) — skipping.");
    return emptyResult();
  }

  const locked = await withDbAdvisoryLock(
    RESOLUTION_SCOUT_LOCK_KEY,
    "ResolutionScout",
    runResolutionScoutOnce,
  );
  if (!locked.acquired || !locked.result) {
    if (!locked.acquired) {
      log("[ResolutionScout] Skipping run; another instance holds the lock");
    }
    return emptyResult();
  }
  return locked.result;
}

async function runResolutionScoutOnce(): Promise<ResolutionScoutResult> {
  const result: ResolutionScoutResult = {
    enabled: true,
    scanned: 0,
    llmCalls: 0,
    budgetBlocked: 0,
    errors: 0,
    autoLocked: 0,
    findings: [],
  };

  const markets = (await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      slug: predictionMarkets.slug,
      category: predictionMarkets.category,
      teaser: predictionMarkets.teaser,
      endAt: predictionMarkets.endAt,
      closeAt: predictionMarkets.closeAt,
      status: predictionMarkets.status,
      resolutionCriteria: predictionMarkets.resolutionCriteria,
      metadata: predictionMarkets.metadata,
      personId: predictionMarkets.personId,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
      ),
    )
    .orderBy(asc(predictionMarkets.endAt))) as ScoutMarket[];

  if (markets.length === 0) {
    log("[ResolutionScout] No open or pending World Markets to scan.");
    return result;
  }

  const callBudget = maxCallsPerRun();

  // --- Prioritise which markets get an LLM call this run --------------------
  // When open markets exceed the budget rail, rank them so the calls land where
  // they matter most:
  //   1. Closing soon — resolving within the next week, soonest first. Most
  //      time-sensitive, so always covered.
  //   2. News spike  — linked to a MAIN-LEADERBOARD person who is currently
  //      "heated" (news + wiki both surging). Shock-event safety net (CEO
  //      fired, athlete injured) for far-future markets, using the per-person
  //      signal the ingest job already computes — no extra API spend. Only
  //      main-leaderboard people are tracked daily, so induction-queue links
  //      correctly fall through to round-robin.
  //   3. Round-robin — everything else, least-recently-scanned first, so no
  //      market is ever permanently starved.
  const now = Date.now();

  const linkedPersonIds = Array.from(
    new Set(
      markets.map((m) => m.personId).filter((id): id is string => !!id),
    ),
  );

  // Restrict the news signal to main-leaderboard people (the only ones with
  // fresh daily data) and flag those currently spiking. Best-effort: a failure
  // here just means we fall back to deadline + round-robin ordering.
  const heatedPersonIds = new Set<string>();
  if (linkedPersonIds.length > 0) {
    try {
      const leaderboardRows = await db
        .select({ id: trackedPeople.id })
        .from(trackedPeople)
        .where(
          and(
            inArray(trackedPeople.id, linkedPersonIds),
            eq(trackedPeople.status, MAIN_LEADERBOARD_STATUS),
          ),
        );
      const leaderboardIds = leaderboardRows.map((r) => r.id);
      if (leaderboardIds.length > 0) {
        const ctx = await getTrendContextBatch(leaderboardIds);
        for (const [pid, c] of ctx) {
          if (c.isHeated) heatedPersonIds.add(pid);
        }
      }
    } catch (err) {
      log(
        `[ResolutionScout] News-signal lookup failed (continuing with deadline + round-robin): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const ranked = markets
    .map((market) => {
      const endAtMs = new Date(market.endAt).getTime();
      return {
        market,
        endAtMs,
        closingSoon: endAtMs - now <= CLOSING_SOON_HORIZON_MS,
        newsSpike: !!market.personId && heatedPersonIds.has(market.personId),
        lastScannedMs: readLastAssessedAtMs(market.metadata),
      };
    })
    .sort((a, b) => {
      // 1. Closing-soon bucket first, soonest deadline leading.
      if (a.closingSoon !== b.closingSoon) return a.closingSoon ? -1 : 1;
      if (a.closingSoon && b.closingSoon) return a.endAtMs - b.endAtMs;
      // 2. News-spiking linked markets next.
      if (a.newsSpike !== b.newsSpike) return a.newsSpike ? -1 : 1;
      // 3. Round-robin: least-recently-scanned first (never-scanned = 0 leads).
      if (a.lastScannedMs !== b.lastScannedMs) return a.lastScannedMs - b.lastScannedMs;
      // 4. Tiebreak: soonest deadline.
      return a.endAtMs - b.endAtMs;
    });

  let closingSoonScanned = 0;
  let newsSpikeScanned = 0;

  for (const cand of ranked) {
    const { market } = cand;
    result.scanned += 1;
    if (result.llmCalls >= callBudget) {
      result.budgetBlocked += 1;
      continue;
    }

    const entries = (await db
      .select({
        id: marketEntries.id,
        label: marketEntries.label,
        displayOrder: marketEntries.displayOrder,
      })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, market.id))
      .orderBy(asc(marketEntries.displayOrder))) as ScoutEntry[];

    if (entries.length === 0) continue;

    result.llmCalls += 1;
    if (cand.closingSoon) closingSoonScanned += 1;
    if (cand.newsSpike) newsSpikeScanned += 1;

    const assessment = await assessMarket(market, entries);
    if (!assessment) {
      result.errors += 1;
      continue;
    }

    const prevSignature = readStoredSignature(market.metadata);
    const changed = prevSignature !== assessment.signature;

    await writeAssessment(market.id, assessment);

    // Auto-lock trading when the outcome is definitively public. near_certain
    // stays advisory (digest only) — locking there would freeze legitimate
    // pre-event trading. Idempotent via metadata.autoLockedAt.
    if (
      autoLockOnResolutionEnabled() &&
      assessment.stage === "met" &&
      market.status === "OPEN"
    ) {
      const prevLocked =
        market.metadata &&
        typeof market.metadata === "object" &&
        typeof (market.metadata as Record<string, unknown>).autoLockedAt === "string";
      if (!prevLocked) {
        const lockAt = computeLockCloseAt(market.closeAt);
        if (lockAt) {
          try {
            const lockedAt = new Date().toISOString();
            const payload = {
              autoLockedAt: lockedAt,
              autoLockReason: "resolution_scout_met",
            };
            await db
              .update(predictionMarkets)
              .set({
                closeAt: lockAt,
                metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
                updatedAt: new Date(),
              })
              .where(eq(predictionMarkets.id, market.id));
            result.autoLocked += 1;
            log(
              `[ResolutionScout] Auto-locked trading for "${market.title}" (stage=met) ` +
                `(market=${market.id.slice(0, 8)})`,
            );
          } catch (err) {
            result.errors += 1;
            log(
              `[ResolutionScout] Auto-lock failed for ${market.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    if (isActionable(assessment)) {
      result.findings.push({
        marketId: market.id,
        title: market.title,
        slug: market.slug,
        assessment,
        changed,
      });
    }
  }

  // Surface changed + most-urgent findings first.
  result.findings.sort((a, b) => {
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    const actionDelta =
      ACTION_RANK[b.assessment.recommendedAction] -
      ACTION_RANK[a.assessment.recommendedAction];
    if (actionDelta !== 0) return actionDelta;
    return STAGE_RANK[b.assessment.stage] - STAGE_RANK[a.assessment.stage];
  });

  log(
    `[ResolutionScout] scanned=${result.scanned} llmCalls=${result.llmCalls} ` +
      `(closingSoon=${closingSoonScanned} newsSpike=${newsSpikeScanned}) ` +
      `budgetBlocked=${result.budgetBlocked} errors=${result.errors} ` +
      `autoLocked=${result.autoLocked} actionable=${result.findings.length}`,
  );

  return result;
}
