/**
 * Default-AI-model powered decision engine for World Markets (community markets).
 * Uses the OpenAI Responses API with web search to assess real-world
 * prediction markets where internal trend signals are not relevant.
 */

import OpenAI from "openai";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { predictionMarkets } from "@shared/schema";
import type {
  AgentConfigData,
  MarketWithEntries,
  MarketEntryData,
  PredictionDecision,
} from "./types";
import { productionRNG, type RNG } from "./prng";
import { log } from "../log";
import {
  WORLD_MARKET_BOOST_ENABLED,
  WORLD_MARKET_ACTIVITY_MULTIPLIER,
  WORLD_MARKETS_LLM_ENABLED,
  WORLD_MARKET_ASSESSMENT_TTL_FINAL_MS,
  WORLD_MARKET_ASSESSMENT_TTL_NEAR_MS,
  WORLD_MARKET_ASSESSMENT_TTL_MEDIUM_MS,
  WORLD_MARKET_ASSESSMENT_TTL_LONG_MS,
  isWorldMarketsLlmAssessmentsEnabled,
} from "./constants";
import { getAiModel } from "../config/ai-models";
import { tryReserveLlmCall } from "./worldMarketBudget";
import { readSourceFairByEntryId } from "./sourceFair";

// Lazy-init the OpenAI client so importing this module from a context
// without `OPENAI_API_KEY` set (CI test workers, scripts that exercise
// pure helpers from this file) doesn't crash at module-load time. Same
// reasoning as `sharpRanker.getOpenAIClient` — preserves prod behaviour
// (still throws iff the key is missing AND the engine is actually called)
// while keeping the import side-effect-free.
let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  _openaiClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });
  return _openaiClient;
}

// ---------------------------------------------------------------------------
// Budget-cap log throttle. Once the daily cap is hit, EVERY subsequent
// agent×market evaluation lands here — with ~56 agents × 16 markets per
// 30-min sweep that used to print hundreds of identical lines per sweep
// (Jul 2026 production logs). One summary line per window carries the
// same information.
// ---------------------------------------------------------------------------
const CAP_LOG_THROTTLE_MS = 10 * 60 * 1000;
let capLogLastAtMs = 0;
let capLogSuppressed = 0;

function logBudgetCapThrottled(spendUsd: number, capUsd: number): void {
  const now = Date.now();
  if (now - capLogLastAtMs < CAP_LOG_THROTTLE_MS) {
    capLogSuppressed += 1;
    return;
  }
  const suppressedNote =
    capLogSuppressed > 0 ? ` (${capLogSuppressed} more abstains since last log)` : "";
  log(
    `[WorldEngine] Budget cap reached — agents abstaining on world markets ` +
      `(spend=$${spendUsd.toFixed(2)} of $${capUsd.toFixed(2)})${suppressedNote}.`,
  );
  capLogLastAtMs = now;
  capLogSuppressed = 0;
}

const API_TIMEOUT_MS = 45_000;
/**
 * Generous on purpose: on reasoning models `max_output_tokens` also covers
 * invisible reasoning tokens, and with web_search a tight cap truncates the
 * JSON mid-string (the resolution scout hit ~60% failures at 500 in Jul
 * 2026 production). Cost delta is negligible under the daily budget rail.
 */
const MAX_OUTPUT_TOKENS = 2_000;

/**
 * Sentinel returned instead of an assessment when the daily budget cap
 * refused the LLM call before it fired. Distinct from `null` (real API
 * failure: network error, empty/unparseable response) so the caller can
 * abstain with `budget_exhausted` — which the agent runner does NOT
 * persist as a 7-day `world_abstained` lockout. Before this distinction
 * existed, a temporarily exhausted budget permanently starved any market
 * that resolved within the re-eval window (Jul 2026: every agent got
 * locked out of short-dated scouted sports markets and they closed with
 * zero bets).
 */
export const BUDGET_EXHAUSTED = "budget_exhausted" as const;
type AssessmentResult = PredictionAssessment | typeof BUDGET_EXHAUSTED | null;

// In-process dedupe: when 56 agents simultaneously evaluate the same market in
// a single sweep, only one of them should fire the LLM call. The rest await
// the same promise. Survives only the lifetime of the Node process; the DB
// cache below covers cross-process / restart scenarios.
const inFlightAssessments = new Map<string, Promise<AssessmentResult>>();

interface CachedAssessment {
  assessment: PredictionAssessment;
  cachedAt: string; // ISO timestamp
}

/**
 * Adaptive TTL: how long the cached assessment is valid for THIS market.
 * Markets nearing resolution refresh more often (news matters); long-horizon
 * markets refresh rarely (noise dominates). See `constants.ts` for tier
 * thresholds and the cost rationale.
 */
export function getAssessmentTtlMs(market: { endAt?: Date | null }): number {
  if (!market.endAt) return WORLD_MARKET_ASSESSMENT_TTL_LONG_MS;
  const daysToResolution =
    (market.endAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysToResolution < 3) return WORLD_MARKET_ASSESSMENT_TTL_FINAL_MS;
  if (daysToResolution < 14) return WORLD_MARKET_ASSESSMENT_TTL_NEAR_MS;
  if (daysToResolution < 60) return WORLD_MARKET_ASSESSMENT_TTL_MEDIUM_MS;
  return WORLD_MARKET_ASSESSMENT_TTL_LONG_MS;
}

function readCachedAssessment(
  market: { metadata?: unknown; endAt?: Date | null },
): PredictionAssessment | null {
  const marketMetadata = market.metadata;
  if (!marketMetadata || typeof marketMetadata !== "object") return null;
  const cached = (marketMetadata as Record<string, unknown>).worldAssessment as
    | CachedAssessment
    | undefined;
  if (!cached || typeof cached !== "object") return null;
  if (!cached.cachedAt || !cached.assessment) return null;
  const age = Date.now() - new Date(cached.cachedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return null;
  const ttl = getAssessmentTtlMs(market);
  if (age > ttl) return null;
  return cached.assessment;
}

async function writeCachedAssessment(
  marketId: string,
  assessment: PredictionAssessment,
): Promise<void> {
  try {
    const payload = {
      worldAssessment: {
        assessment,
        cachedAt: new Date().toISOString(),
      },
    };
    // jsonb || merges keys, preserving any other metadata fields.
    await db
      .update(predictionMarkets)
      .set({
        metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, marketId));
  } catch (err) {
    log(
      `[WorldEngine] Failed to cache assessment for market=${marketId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Max age of the source anchor before the anchor-based path refuses to
 * trust it and falls back to the LLM. The source watcher refreshes
 * livePrices daily, so a healthy scouted market is never near this;
 * 72h means a watcher outage degrades gracefully to LLM assessments
 * rather than agents betting on week-old odds.
 */
const ANCHOR_MAX_AGE_MS = 72 * 60 * 60 * 1000;

interface PredictionAssessment {
  decision: "bet" | "abstain";
  selectedOutcomeIndex: number;
  confidence: number;
  probabilities: Array<{ outcomeIndex: number; probability: number }>;
  // Optional: outcome the model is most confident WILL NOT happen. Used for
  // No-side bets when the long-shot read has more edge than the favourite.
  // Backwards-compatible — older responses without this field default to Yes.
  unlikelyOutcomeIndex?: number;
  unlikelyConfidence?: number;
  briefReasoning: string;
}

function getOutcomeLabel(entry: MarketEntryData, index: number): string {
  return entry.label?.trim() || `Outcome ${index + 1}`;
}

function buildSystemPrompt(agent: AgentConfigData): string {
  return `You are ${agent.displayName}, a prediction market analyst on VoxDex.

Your personality: ${agent.archetype}
Your bio: "${agent.bio}"
Your specialties: ${agent.specialties.join(", ")}
Your traits: boldness=${agent.boldness}, contrarianism=${agent.contrarianism}, recencyWeight=${agent.recencyWeight}, prestigeBias=${agent.prestigeBias}, confidenceCal=${agent.confidenceCal}, consensusSensitivity=${agent.consensusSensitivity}, riskAppetite=${agent.riskAppetite}, activityRate=${agent.activityRate}

TASK: Evaluate a prediction market and decide whether to place a bet.

INSTRUCTIONS:
1. Search the web for current betting odds, recent news, and expert analysis relevant to this market.
2. Assess the probability of each outcome based on your research.
3. Apply your personality to your pick:
   - If you are a contrarian (contrarianism > 0.7): Look for outcomes the public is undervaluing. You prefer to go against consensus when you see value.
   - If you are a prestige maximiser (prestigeBias > 0.7): Favour established, historically dominant options (legacy teams, incumbent favourites).
   - If you are a momentum chaser (recencyWeight > 0.7): Weight recent form and trends more heavily than historical reputation.
   - If you are news-reactive: Weight very recent developments (last 1-2 weeks) more heavily.
4. Decide whether to bet or abstain. Abstain if you have low confidence (below 0.4) or if the market is too uncertain for your risk appetite.
5. If betting, select the single outcome you want to back ("selectedOutcomeIndex") and your confidence level (0.4 to 0.95).
6. Each outcome can also be bet AGAINST (No-side bet), winning if that outcome does NOT happen. If you are highly confident a specific outcome WILL NOT win — typically because its probability is below 0.10 — also fill in "unlikelyOutcomeIndex" with that outcome's number and "unlikelyConfidence" with your confidence (0.6 to 0.95) that it won't happen. Leave these null if no outcome stands out as a clear short.

IMPORTANT:
- Your probabilities should roughly align with real-world consensus odds but can deviate based on your persona.
- Contrarian agents SHOULD deviate from consensus — that is the whole point. Back underdogs, or short overhyped favourites with No bets.
- Conservative agents should stick closer to consensus favourites.
- Be honest about uncertainty. If you genuinely cannot assess this market, abstain.
- The "briefReasoning" field is for internal logging only, keep it to 1 sentence.

You MUST respond with a single JSON object and nothing else. No markdown, no explanation, no code fences. The JSON must match this exact schema:
{
  "decision": "bet" or "abstain",
  "selectedOutcomeIndex": <1-based integer matching the outcome number>,
  "confidence": <number between 0.4 and 0.95>,
  "probabilities": [{"outcomeIndex": 1, "probability": 0.35}, ...],
  "unlikelyOutcomeIndex": <1-based integer or null>,
  "unlikelyConfidence": <number between 0.6 and 0.95, or null>,
  "briefReasoning": "<one sentence>"
}
Include every outcome in the probabilities array. Probabilities should sum to approximately 1.0.`;
}

function buildUserPrompt(
  market: MarketWithEntries,
  entries: MarketEntryData[]
): string {
  const totalPool = entries.reduce((s, e) => s + e.totalStake, 0);
  const outcomesBlock = entries
    .map((e, index) => `${index + 1}. ${getOutcomeLabel(e, index)}`)
    .join("\n");
  const poolBlock = entries
    .map((e, index) => {
      const pct = totalPool > 0 ? ((e.totalStake / totalPool) * 100).toFixed(1) : "0.0";
      return `${index + 1}. ${getOutcomeLabel(e, index)}: ${e.totalStake} credits staked (${pct}%)`;
    })
    .join("\n");

  const resolutionDate = market.endAt
    ? market.endAt.toISOString().split("T")[0]
    : "Not specified";
  const criteria = market.resolutionCriteria?.length
    ? market.resolutionCriteria.join("; ")
    : "Not specified";

  return `MARKET: ${market.title}
CATEGORY: ${market.category ?? "General"}
TEASER: ${market.teaser ?? "N/A"}
RESOLUTION DATE: ${resolutionDate}
RESOLUTION CRITERIA: ${criteria}

OUTCOMES:
${outcomesBlock}

CURRENT POOL:
${poolBlock}
Total pool: ${totalPool} credits

Evaluate this market and provide your prediction. Use the numbered outcomes exactly as listed.`;
}

function extractOutputText(response: any): string | null {
  // 1. Convenience property (populated on some SDK/model combos)
  if (response.output_text) return response.output_text;

  if (!Array.isArray(response.output)) return null;

  // 2. Standard message item with nested content parts
  for (const item of response.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if ((part.type === "output_text" || part.type === "text") && part.text) {
          return part.text;
        }
      }
    }
  }

  // 3. Top-level text item (some response shapes put text directly in output)
  for (const item of response.output) {
    if (item.type === "text" && item.text) return item.text;
  }

  // 4. Last resort: any item with a .text string that looks like JSON
  for (const item of response.output) {
    if (typeof item.text === "string" && item.text.trim().startsWith("{")) {
      return item.text;
    }
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (typeof part.text === "string" && part.text.trim().startsWith("{")) {
          return part.text;
        }
      }
    }
  }

  return null;
}

/**
 * Fire the actual LLM call. Used as the seed for the cached assessment that
 * all agents will share within a 24h window.
 *
 * SAFETY: This is the only path that hits OpenAI. Everything upstream
 * (cache check, kill switch, in-flight dedupe) gates whether we get here.
 */
async function callWorldMarketLlm(
  agent: AgentConfigData,
  market: MarketWithEntries,
  entries: MarketEntryData[],
): Promise<AssessmentResult> {
  // Daily LLM budget gate — see server/agents/worldMarketBudget.ts.
  // Pessimistically reserves the call's estimated cost BEFORE we touch
  // OpenAI. If the cap would be breached, return the BUDGET_EXHAUSTED
  // sentinel — the agent abstains WITHOUT the 7-day world_abstained
  // lockout, so it retries once the budget resets at UTC midnight.
  // Successful responses commit the reservation; failures release it
  // so failed calls don't burn budget.
  const reservation = tryReserveLlmCall();
  if (!reservation.allowed) {
    logBudgetCapThrottled(
      reservation.snapshot.spendUsd,
      reservation.snapshot.capUsd,
    );
    return BUDGET_EXHAUSTED;
  }

  const systemPrompt = buildSystemPrompt(agent);
  const userPrompt = buildUserPrompt(market, entries);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await getOpenAIClient().responses.create(
      {
        model: getAiModel("worldMarkets"),
        tools: [{ type: "web_search" as any }],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: systemPrompt,
        input: userPrompt,
      } as any,
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const outputText = extractOutputText(response);
    if (!outputText) {
      const outputTypes = Array.isArray((response as any).output)
        ? (response as any).output.map((item: any) => item.type).join(", ")
        : "no output array";
      log(
        `[WorldEngine] Empty response for market=${market.id.slice(0, 8)} (seed agent=${agent.displayName}) — output items: [${outputTypes}]`,
      );
      // Empty response — OpenAI may or may not bill, but from our side
      // we got no usable output. Release to be conservative; we'd rather
      // slightly understate spend than refuse a future borderline call
      // because we burned budget on a 0-output response.
      reservation.release();
      return null;
    }

    let jsonText = outputText.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    // Resilience: parse the outermost {...} span in case the model wrapped
    // the object in prose or citation markup despite the instructions.
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace > 0 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      log(
        `[WorldEngine] JSON parse failed for market=${market.id.slice(0, 8)} (seed agent=${agent.displayName}) — raw: ${jsonText.slice(0, 200)}`,
      );
      // OpenAI billed for the call but we couldn't parse the JSON.
      // Commit anyway — the spend really happened — and let ops chase
      // the parse failure separately.
      reservation.commit();
      return null;
    }

    if (
      !parsed ||
      typeof parsed.decision !== "string" ||
      !["bet", "abstain"].includes(parsed.decision) ||
      typeof parsed.confidence !== "number" ||
      typeof parsed.briefReasoning !== "string"
    ) {
      log(
        `[WorldEngine] Invalid schema for market=${market.id.slice(0, 8)} — keys: ${Object.keys(parsed).join(", ")}`,
      );
      // Same as parse failure: API call was billable, schema was wrong.
      reservation.commit();
      return null;
    }

    reservation.commit();
    return parsed as PredictionAssessment;
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `[WorldEngine] API error for market=${market.id.slice(0, 8)} (seed agent=${agent.displayName}): ${msg}`,
    );
    // Network / timeout / abort — no LLM response, refund the
    // reservation so transient errors don't deplete the daily budget.
    reservation.release();
    return null;
  }
}

/**
 * Zero-cost assessment for SCOUTED markets: the source market's consensus
 * prices (Polymarket, refreshed daily by the source watcher) already ARE a
 * crowd's probability estimate, so agents can bet off them directly without
 * a web search. This is what generates baseline activity on freshly
 * published scouted markets — the LLM budget is reserved for markets with
 * no anchor (manually created World Markets).
 *
 * Unlike the LLM path there is no shared cache: each agent samples its own
 * pick from the anchor distribution (favourites proportionally more often),
 * so a 60/40 market naturally splits the cohort ~60/40 instead of everyone
 * piling on the favourite. Persona layers downstream (contrarian flip,
 * no-side shorts, confidence calibration, per-band edge gates) add the
 * rest of the variety, exactly as they do for LLM assessments.
 *
 * Returns null when the market has no usable anchor (not scouted, labels
 * edited beyond recognition, upstream already resolved, anchor stale) —
 * the caller then falls back to the LLM path.
 */
function buildAnchorAssessment(
  market: MarketWithEntries,
  entries: MarketEntryData[],
  rng: RNG,
): PredictionAssessment | null {
  const fair = readSourceFairByEntryId(market.metadata, entries);
  if (!fair) return null;

  // Staleness guard — see ANCHOR_MAX_AGE_MS doc.
  if (!fair.anchorAt) return null;
  const anchorAge = Date.now() - new Date(fair.anchorAt).getTime();
  if (!Number.isFinite(anchorAge) || anchorAge < 0 || anchorAge > ANCHOR_MAX_AGE_MS) {
    return null;
  }

  const probabilities = entries.map((entry, index) => ({
    outcomeIndex: index + 1,
    probability: fair.fairByEntryId[entry.id] ?? 0,
  }));

  // Sample the pick proportionally to the anchor distribution.
  let roll = rng.nextFloat();
  let selectedIdx = entries.length - 1;
  for (let i = 0; i < probabilities.length; i++) {
    roll -= probabilities[i].probability;
    if (roll <= 0) {
      selectedIdx = i;
      break;
    }
  }
  const selectedProbability = probabilities[selectedIdx].probability;

  // Flag a clear long-shot for the downstream No-side logic, mirroring
  // what the LLM prompt asks for (outcome below ~10% in a 3+ way market).
  let unlikelyOutcomeIndex: number | undefined;
  let unlikelyConfidence: number | undefined;
  if (entries.length >= 3) {
    const longShot = probabilities.reduce((min, p) =>
      p.probability < min.probability ? p : min,
    );
    if (longShot.probability < 0.10 && longShot.outcomeIndex !== selectedIdx + 1) {
      unlikelyOutcomeIndex = longShot.outcomeIndex;
      unlikelyConfidence = Math.max(0.6, Math.min(0.95, 1 - longShot.probability));
    }
  }

  const selectedLabel = getOutcomeLabel(entries[selectedIdx], selectedIdx);
  return {
    decision: "bet",
    selectedOutcomeIndex: selectedIdx + 1,
    confidence: Math.max(0.4, Math.min(0.95, selectedProbability)),
    probabilities,
    unlikelyOutcomeIndex,
    unlikelyConfidence,
    briefReasoning: `Consensus odds put ${selectedLabel} at ${(selectedProbability * 100).toFixed(0)}% — following the market.`,
  };
}

/**
 * Get an assessment for the market — preferring cache (DB) and in-flight
 * dedupe (in-process) over a fresh LLM call. Writes through to the DB cache
 * on success so subsequent agents (this batch and future batches within the
 * TTL) reuse the same web-search-backed analysis.
 */
async function getOrCreateAssessment(
  agent: AgentConfigData,
  market: MarketWithEntries,
  entries: MarketEntryData[],
): Promise<AssessmentResult> {
  const cached = readCachedAssessment(market);
  if (cached) return cached;

  const inFlight = inFlightAssessments.get(market.id);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const fresh = await callWorldMarketLlm(agent, market, entries);
    // Only real assessments are cached — BUDGET_EXHAUSTED must not
    // poison the cache for the rest of the TTL window.
    if (fresh && fresh !== BUDGET_EXHAUSTED) {
      await writeCachedAssessment(market.id, fresh);
    }
    return fresh;
  })();

  inFlightAssessments.set(market.id, promise);
  try {
    return await promise;
  } finally {
    inFlightAssessments.delete(market.id);
  }
}

export async function computeWorldMarketPrediction(
  agent: AgentConfigData,
  market: MarketWithEntries,
  entries: MarketEntryData[],
  rng: RNG = productionRNG
): Promise<PredictionDecision> {
  const abstain = (
    reason: PredictionDecision["abstainReason"]
  ): PredictionDecision => ({
    abstain: true,
    abstainReason: reason,
    source: "gpt-5.4-world",
  });

  if (!entries.length) return abstain("low_edge");

  // Once Polymarket (or any source) has resolved upstream, settlement owns
  // the market. Anchor/convergence already stop via sourceFair, but the
  // LLM path would otherwise keep betting from a cached assessment —
  // soft counterparty for informed traders. Abstain regardless of the
  // auto-lock flag so this holds even when AUTO_LOCK_ON_RESOLUTION is off.
  const sourceMeta =
    market.metadata && typeof market.metadata === "object"
      ? (market.metadata as { source?: { upstreamResolvedAt?: unknown } }).source
      : undefined;
  if (typeof sourceMeta?.upstreamResolvedAt === "string") {
    // Pre-LLM gate — use `domain` (silent skip), not `world_abstain`, so
    // agentRunner does not persist a 7-day world_abstained lockout.
    return abstain("domain");
  }

  // SAFETY GATE: kill switch. When the env var is off (the safe default after
  // the 2026-05-01 cost incident), no agent ever touches OpenAI for World
  // Markets. They simply abstain with a domain reason so the per-agent
  // re-eval gate fires on the next sweep once the env var is flipped on.
  if (!WORLD_MARKETS_LLM_ENABLED) {
    return abstain("domain");
  }

  // Step 1: Domain filter (relaxed for world markets to increase coverage)
  const marketCategory = market.category?.toLowerCase() ?? "";
  const domainMatch =
    marketCategory !== "" &&
    agent.specialties.some(
      (s) => marketCategory.includes(s) || s.includes(marketCategory)
    );
  const skipProbability = WORLD_MARKET_BOOST_ENABLED
    ? (domainMatch ? 0.05 : 0.40)
    : (domainMatch ? 0.15 : 0.70);
  if (rng.nextFloat() < skipProbability) return abstain("domain");

  // Step 2: Activity gate (boosted for world markets to ensure GPT calls aren't wasted)
  const effectiveActivityRate = WORLD_MARKET_BOOST_ENABLED
    ? Math.min(1.0, agent.activityRate * WORLD_MARKET_ACTIVITY_MULTIPLIER)
    : agent.activityRate;
  if (rng.nextFloat() > effectiveActivityRate) return abstain("activity_gate");

  // Step 3a: Source-anchored assessment for scouted markets — zero LLM
  // cost, per-agent sampled. When present, the LLM is never consulted for
  // this market; budget is reserved for markets with no anchor.
  const anchorAssessment = buildAnchorAssessment(market, entries, rng);
  const viaAnchor = anchorAssessment !== null;

  // Step 3b: LLM assessment (unanchored markets only) — preferring cache.
  // This is the cost hot-spot. Pre-cache: every agent fires its own
  // web_search call (~$0.25 each, 56 agents per market = ~$14/market).
  // Post-cache: ONE call per market per 24h, shared by all 56 agents
  // (~$0.25/market). 56x savings.
  //
  // When WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED=false, skip the LLM path
  // entirely — including reuse of metadata.worldAssessment caches — so
  // manual / unanchored markets stop on the next sweep (not after TTL).
  // Anchored markets keep using `anchorAssessment` below (zero OpenAI).
  let assessment: AssessmentResult;
  if (anchorAssessment) {
    assessment = anchorAssessment;
  } else if (!isWorldMarketsLlmAssessmentsEnabled()) {
    // Silent skip (domain): do not persist world_abstained lockout.
    return abstain("domain");
  } else {
    assessment = await getOrCreateAssessment(agent, market, entries);
  }
  if (assessment === BUDGET_EXHAUSTED) {
    // Not persisted by the runner — the agent silently retries on a
    // later sweep once the daily budget resets.
    return abstain("budget_exhausted");
  }
  if (!assessment) {
    return abstain("api_error");
  }

  // Step 4: Parse and validate
  if (assessment.decision === "abstain") {
    return {
      ...abstain("world_abstain"),
      reasoning: assessment.briefReasoning,
    };
  }

  // Map selected outcome index to entry ID
  const selectedEntry = entries[assessment.selectedOutcomeIndex - 1];
  if (!selectedEntry) {
    log(
      `[WorldEngine] Could not match outcome index "${assessment.selectedOutcomeIndex}" to entries for market=${market.id.slice(0, 8)}`
    );
    return abstain("api_error");
  }

  // Step 4b: Contrarianism flip — if agent is highly contrarian and GPT picked
  // the crowd favourite, flip to the second-highest probability outcome
  let chosenEntryId = selectedEntry.id;
  let rawConfidence = Math.max(0.4, Math.min(0.95, assessment.confidence));
  let direction: "yes" | "no" = "yes";

  if (agent.contrarianism > 0.7) {
    const totalPool = entries.reduce((s, e) => s + e.totalStake, 0);
    if (totalPool > 0) {
      const crowdFavourite = entries.reduce((a, b) =>
        b.totalStake > a.totalStake ? b : a
      );
      if (chosenEntryId === crowdFavourite.id && rng.nextFloat() < 0.6) {
        // Flip to GPT's second-highest probability pick
        const sorted = [...assessment.probabilities].sort(
          (a, b) => b.probability - a.probability
        );
        const secondPick = sorted.length > 1 ? sorted[1] : null;
        if (secondPick) {
          const altEntry = entries[secondPick.outcomeIndex - 1];
          if (altEntry) {
            chosenEntryId = altEntry.id;
            rawConfidence = Math.max(0.4, Math.min(0.95, secondPick.probability));
          }
        }
      }
    }
  }

  // Step 4c: No-side bet on a clear long-shot.
  //
  // When GPT flags an outcome it considers very unlikely, decide whether to
  // back the favourite (Yes on selectedEntry) or short the long-shot (No on
  // unlikelyEntry). Persona-weighted: contrarians and bold agents lean
  // toward shorts because that's their whole pitch. Conservative/cautious
  // agents stay on Yes because shorts are higher-variance.
  //
  // Only fires when:
  //   - the market has 3+ entries (multi-option),
  //   - GPT specified an unlikely outcome that's distinct from the chosen
  //     entry,
  //   - the unlikely confidence is meaningful (>= 0.6).
  //
  // The "no" side of an entry pays out from the Yes pool of OTHER entries,
  // so we don't need to recompute confidence — we keep GPT's stated short
  // confidence directly.
  if (
    entries.length >= 3 &&
    typeof assessment.unlikelyOutcomeIndex === "number" &&
    typeof assessment.unlikelyConfidence === "number" &&
    assessment.unlikelyConfidence >= 0.6
  ) {
    const unlikelyEntry = entries[assessment.unlikelyOutcomeIndex - 1];
    if (unlikelyEntry && unlikelyEntry.id !== chosenEntryId) {
      // Persona weight: 0.0 (never short) → 1.0 (always short when offered).
      // Contrarianism dominates; boldness adds a smaller secondary push.
      const shortPropensity = Math.min(
        1,
        agent.contrarianism * 0.7 + agent.boldness * 0.3,
      );
      // Edge bonus: when GPT's stated short confidence exceeds its long
      // confidence, the No side is the higher-edge play even for moderate
      // personas. Adds up to +0.25 to the propensity.
      const edgeBonus = Math.max(
        0,
        Math.min(0.25, (assessment.unlikelyConfidence - rawConfidence) * 0.5),
      );
      if (rng.nextFloat() < shortPropensity + edgeBonus) {
        chosenEntryId = unlikelyEntry.id;
        rawConfidence = Math.max(0.4, Math.min(0.95, assessment.unlikelyConfidence));
        direction = "no";
      }
    }
  }

  // Step 5: Confidence calibration (same formula as deterministic engine)
  const n = entries.length;
  const chanceLevel = 1 / n;
  const calibrated =
    chanceLevel + (rawConfidence - chanceLevel) * agent.confidenceCal;
  const clampedConfidence = Math.max(
    chanceLevel + 0.01,
    Math.min(0.97, calibrated)
  );

  return {
    abstain: false,
    entryId: chosenEntryId,
    direction,
    rawProbability: parseFloat(rawConfidence.toFixed(4)),
    confidence: parseFloat(clampedConfidence.toFixed(3)),
    source: viaAnchor ? "source_anchor" : "gpt-5.4-world",
    reasoning: assessment.briefReasoning,
  };
}
