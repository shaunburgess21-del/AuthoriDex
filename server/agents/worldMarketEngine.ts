/**
 * Default-AI-model powered decision engine for World Markets (community markets).
 * Uses the OpenAI Responses API with web search to assess real-world
 * prediction markets where internal trend signals are not relevant.
 */

import OpenAI from "openai";
import type {
  AgentConfigData,
  MarketWithEntries,
  MarketEntryData,
  PredictionDecision,
} from "./types";
import { productionRNG, type RNG } from "./prng";
import { log } from "../log";
import { WORLD_MARKET_BOOST_ENABLED, WORLD_MARKET_ACTIVITY_MULTIPLIER } from "./constants";
import { getAiModel } from "../config/ai-models";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
});

const API_TIMEOUT_MS = 45_000;

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

  // Step 3: Call GPT-5.4 with web search
  const systemPrompt = buildSystemPrompt(agent);
  const userPrompt = buildUserPrompt(market, entries);

  let assessment: PredictionAssessment;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await openai.responses.create(
      {
        model: getAiModel("worldMarkets"),
        tools: [{ type: "web_search" as any }],
        max_output_tokens: 1000,
        instructions: systemPrompt,
        input: userPrompt,
      } as any,
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const outputText = extractOutputText(response);
    if (!outputText) {
      const outputTypes = Array.isArray((response as any).output)
        ? (response as any).output.map((item: any) => item.type).join(", ")
        : "no output array";
      log(`[WorldEngine] Empty response for agent=${agent.displayName} market=${market.id.slice(0, 8)} — output items: [${outputTypes}]`);
      return abstain("api_error");
    }

    // Strip markdown code fences the model may wrap around the JSON
    let jsonText = outputText.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      log(`[WorldEngine] JSON parse failed for agent=${agent.displayName} market=${market.id.slice(0, 8)} — raw: ${jsonText.slice(0, 200)}`);
      return abstain("api_error");
    }

    if (
      !parsed ||
      typeof parsed.decision !== "string" ||
      !["bet", "abstain"].includes(parsed.decision) ||
      typeof parsed.confidence !== "number" ||
      typeof parsed.briefReasoning !== "string"
    ) {
      log(`[WorldEngine] Invalid schema for agent=${agent.displayName} market=${market.id.slice(0, 8)} — keys: ${Object.keys(parsed).join(", ")}`);
      return abstain("api_error");
    }

    assessment = parsed as PredictionAssessment;
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[WorldEngine] API error for agent=${agent.displayName} market=${market.id.slice(0, 8)}: ${msg}`);
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
    source: "gpt-5.4-world",
    reasoning: assessment.briefReasoning,
  };
}
