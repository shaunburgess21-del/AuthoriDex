/**
 * GPT-5.4 powered decision engine for World Markets (community markets).
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

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
});

const API_TIMEOUT_MS = 30_000;

interface PredictionAssessment {
  decision: "bet" | "abstain";
  selectedOutcomeIndex: number;
  confidence: number;
  probabilities: Array<{ outcomeIndex: number; probability: number }>;
  briefReasoning: string;
}

function getOutcomeLabel(entry: MarketEntryData, index: number): string {
  return entry.label?.trim() || `Outcome ${index + 1}`;
}

function buildPredictionSchema(outcomeCount: number) {
  return {
    type: "object" as const,
    properties: {
      decision: { type: "string" as const, enum: ["bet", "abstain"] },
      selectedOutcomeIndex: {
        type: "integer" as const,
        minimum: 1,
        maximum: outcomeCount,
      },
      confidence: { type: "number" as const },
      probabilities: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            outcomeIndex: {
              type: "integer" as const,
              minimum: 1,
              maximum: outcomeCount,
            },
            probability: { type: "number" as const },
          },
          required: ["outcomeIndex", "probability"] as const,
          additionalProperties: false,
        },
      },
      briefReasoning: { type: "string" as const },
    },
    required: [
      "decision",
      "selectedOutcomeIndex",
      "confidence",
      "probabilities",
      "briefReasoning",
    ] as const,
    additionalProperties: false,
  };
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
5. If betting, select the single outcome you want to back and your confidence level (0.4 to 0.95).

IMPORTANT:
- Your probabilities should roughly align with real-world consensus odds but can deviate based on your persona.
- Contrarian agents SHOULD deviate from consensus — that is the whole point. Back underdogs.
- Conservative agents should stick closer to consensus favourites.
- Be honest about uncertainty. If you genuinely cannot assess this market, abstain.
- The "briefReasoning" field is for internal logging only, keep it to 1 sentence.

Respond ONLY with the JSON object, no other text.`;
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
  if (response.output_text) return response.output_text;

  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" && part.text) {
            return part.text;
          }
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

  // Step 1: Domain filter (same logic as deterministic engine)
  const marketCategory = market.category?.toLowerCase() ?? "";
  const domainMatch =
    marketCategory !== "" &&
    agent.specialties.some(
      (s) => marketCategory.includes(s) || s.includes(marketCategory)
    );
  const skipProbability = domainMatch ? 0.15 : marketCategory === "trending" ? 0.4 : 0.70;
  if (rng.nextFloat() < skipProbability) return abstain("domain");

  // Step 2: Activity gate
  if (rng.nextFloat() > agent.activityRate) return abstain("activity_gate");

  // Step 3: Call GPT-5.4 with web search
  const systemPrompt = buildSystemPrompt(agent);
  const userPrompt = buildUserPrompt(market, entries);

  let assessment: PredictionAssessment;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await openai.responses.create(
      {
        model: "gpt-5.4",
        tools: [{ type: "web_search" as any }],
        reasoning: { effort: "medium" } as any,
        max_output_tokens: 500,
        instructions: systemPrompt,
        input: userPrompt,
        text: {
          format: {
            type: "json_schema",
            name: "prediction_assessment",
            strict: true,
            schema: buildPredictionSchema(entries.length),
          },
        },
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

    assessment = JSON.parse(outputText) as PredictionAssessment;
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
    rawProbability: parseFloat(rawConfidence.toFixed(4)),
    confidence: parseFloat(clampedConfidence.toFixed(3)),
    source: "gpt-5.4-world",
    reasoning: assessment.briefReasoning,
  };
}
