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
 *   - Change detection: each market stores a `signature` (stage|action|winner);
 *     a finding is "changed" when the new signature differs from the stored
 *     one, so the digest can lead with what's new instead of repeating the
 *     same standing every day.
 *   - Watch criteria: `metadata.scoutWatch` (admin-authored, AI-suggested)
 *     tells the model exactly which leading indicators to look for.
 */

import OpenAI from "openai";
import { and, asc, eq, sql } from "drizzle-orm";

import { db, withDbAdvisoryLock } from "../db";
import { marketEntries, predictionMarkets } from "@shared/schema";
import { log } from "../log";
import { getAiModel } from "../config/ai-models";

const RESOLUTION_SCOUT_LOCK_KEY = 5_211;

// ---- Config ---------------------------------------------------------------

function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

const API_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 500;

function scoutEnabled(): boolean {
  return envFlag(process.env.RESOLUTION_SCOUT_LLM_ENABLED);
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
  findings: ScoutFinding[];
}

interface ScoutMarket {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  teaser: string | null;
  endAt: Date;
  resolutionCriteria: string[] | null;
  metadata: unknown;
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
      resolutionCriteria: predictionMarkets.resolutionCriteria,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.status, "OPEN"),
      ),
    )
    .orderBy(asc(predictionMarkets.endAt))) as ScoutMarket[];

  if (markets.length === 0) {
    log("[ResolutionScout] No open World Markets to scan.");
    return result;
  }

  const callBudget = maxCallsPerRun();

  for (const market of markets) {
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
    const assessment = await assessMarket(market, entries);
    if (!assessment) {
      result.errors += 1;
      continue;
    }

    const prevSignature = readStoredSignature(market.metadata);
    const changed = prevSignature !== assessment.signature;

    await writeAssessment(market.id, assessment);

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
      `budgetBlocked=${result.budgetBlocked} errors=${result.errors} ` +
      `actionable=${result.findings.length}`,
  );

  return result;
}
