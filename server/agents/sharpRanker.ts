/**
 * LLM market-ranker for sharp-band agents.
 *
 * Once per agent-runner sweep, this module asks GPT-5.4 to scan the native
 * markets being evaluated and return the top N where it sees the strongest
 * combination of (a) clear directional signal and (b) live pool that hasn't
 * caught up yet. Sharp agents prefer-sample from the resulting list, so as
 * a cohort they end the week consistently focused on the highest-edge
 * markets — exactly what you'd see from a real "sharps row" on a
 * leaderboard.
 *
 * Cost profile: ONE chat-completion per sweep (no web search, ~600 input
 * tokens, ~250 output tokens). At 48 sweeps/day × ~$0.005/call ≈ $7/month.
 *
 * Cache: result is held in-memory for SHARP_RANKER_TTL_MS so we don't
 * re-call when consecutive sweeps see the same market set, and we hit the
 * LLM at most once per process tick. The kill switch
 * `SHARP_RANKER_LLM_ENABLED` lets ops disable the call entirely without a
 * deploy when troubleshooting cost.
 */

import OpenAI from "openai";
import { log } from "../log";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import type { MarketWithEntries, TrendSignals } from "./types";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
});

const SHARP_RANKER_LLM_ENABLED = process.env.SHARP_RANKER_LLM_ENABLED !== "false";
const SHARP_RANKER_TTL_MS = 25 * 60 * 1000;
const SHARP_RANKER_TIMEOUT_MS = 25_000;
const SHARP_RANKER_MAX_TOKENS = 700;
const SHARP_RANKER_TOP_N = 6;

export interface SharpRankerPick {
  marketId: string;
  side: string;
  reasoning: string;
}

export interface SharpRankerSnapshot {
  picks: SharpRankerPick[];
  generatedAt: number;
  marketsConsidered: number;
  source: "llm" | "fallback" | "disabled" | "cache";
  costEstimateUsd: number | null;
}

interface RankableMarket {
  market: MarketWithEntries;
  signals: TrendSignals | null;
  entrySignals?: Map<string, TrendSignals>;
}

let lastSnapshot: SharpRankerSnapshot | null = null;
let inflight: Promise<SharpRankerSnapshot> | null = null;

/**
 * Returns the latest sharp-ranking snapshot, regenerating if it's stale.
 * Safe to call from many call sites in the same sweep — the in-flight
 * dedupe guarantees only ONE LLM call per regeneration window.
 */
export async function getSharpRanking(
  rankable: RankableMarket[],
): Promise<SharpRankerSnapshot> {
  if (!SHARP_RANKER_LLM_ENABLED) {
    return {
      picks: [],
      generatedAt: Date.now(),
      marketsConsidered: rankable.length,
      source: "disabled",
      costEstimateUsd: 0,
    };
  }

  if (lastSnapshot && Date.now() - lastSnapshot.generatedAt < SHARP_RANKER_TTL_MS) {
    return { ...lastSnapshot, source: "cache" };
  }

  if (inflight) return inflight;

  inflight = generateRanking(rankable)
    .catch((err) => {
      log(`[SharpRanker] generation failed: ${err instanceof Error ? err.message : err}`);
      const fallback: SharpRankerSnapshot = {
        picks: [],
        generatedAt: Date.now(),
        marketsConsidered: rankable.length,
        source: "fallback",
        costEstimateUsd: 0,
      };
      lastSnapshot = fallback;
      return fallback;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function getCachedSharpRanking(): SharpRankerSnapshot | null {
  return lastSnapshot;
}

async function generateRanking(rankable: RankableMarket[]): Promise<SharpRankerSnapshot> {
  const eligible = rankable.filter(
    (r) => r.market.marketType !== "community" && r.market.entries.length > 0,
  );

  if (eligible.length === 0) {
    const empty: SharpRankerSnapshot = {
      picks: [],
      generatedAt: Date.now(),
      marketsConsidered: 0,
      source: "llm",
      costEstimateUsd: 0,
    };
    lastSnapshot = empty;
    return empty;
  }

  const summary = eligible.map(formatMarketForRanker).join("\n\n");

  const systemPrompt = [
    "You are a sharp prediction-market analyst.",
    "Given a list of open markets with their live trend signals and current betting pool,",
    `pick the ${SHARP_RANKER_TOP_N} markets where you see the strongest EDGE — i.e. cases where:`,
    "- The signals (Wiki pulse, news level, momentum, fame baseline) point clearly in one direction, AND",
    "- The live pool does NOT yet reflect that view (so there is value to be captured), OR",
    "- There is a structural pattern (trend reversal, news catalyst, fame mismatch) that the simple model would miss.",
    "",
    "DO NOT just pick the markets with the largest moves. Pick where you see UNDERPRICED conviction.",
    "Be ruthless — most markets are noise. If fewer than 6 have real edge, return fewer.",
    "",
    "Output STRICT JSON only, no prose:",
    '{"picks":[{"marketId":"<id>","side":"<entry label or up/down>","reasoning":"<one sentence>"}]}',
  ].join("\n");

  const userPrompt = `MARKETS:\n\n${summary}`;

  const model = getAiModel("sharpRanker");
  const tokenLimit = getChatCompletionTokenLimit(model, SHARP_RANKER_MAX_TOKENS);

  const completion = await Promise.race([
    openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      ...tokenLimit,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("sharp ranker timeout")), SHARP_RANKER_TIMEOUT_MS),
    ),
  ]);

  const raw = completion.choices?.[0]?.message?.content ?? "{}";
  const parsed = parseRankerResponse(raw, eligible);

  const usage = completion.usage;
  const costEstimateUsd = usage
    ? estimateCost(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
    : null;

  const snapshot: SharpRankerSnapshot = {
    picks: parsed,
    generatedAt: Date.now(),
    marketsConsidered: eligible.length,
    source: "llm",
    costEstimateUsd,
  };

  lastSnapshot = snapshot;
  log(
    `[SharpRanker] picked ${parsed.length}/${SHARP_RANKER_TOP_N} from ${eligible.length} markets, cost≈$${costEstimateUsd?.toFixed(4) ?? "?"}`,
  );
  return snapshot;
}

function formatMarketForRanker(item: RankableMarket): string {
  const { market, signals, entrySignals } = item;
  const lines: string[] = [];
  lines.push(`# ${market.id}`);
  lines.push(`type: ${market.marketType}`);
  lines.push(`title: ${market.title.slice(0, 90)}`);
  if (market.category) lines.push(`category: ${market.category}`);

  if (signals) {
    lines.push(
      `signals: trendScore=${Math.round(signals.trendScore)}, fame=${Math.round(signals.fameIndex)}, baseline=${Math.round(signals.scoreBaseline)}, 7d=${signals.scoreDelta7d.toFixed(1)}, wiki=${signals.wikiPulse}, news=${signals.newsLevel}`,
    );
  }

  const entries = market.entries
    .slice(0, 4)
    .map((e) => {
      const sig = entrySignals?.get(e.id);
      const entrySig = sig ? ` [fame=${Math.round(sig.fameIndex)}, 7d=${sig.scoreDelta7d.toFixed(1)}, wiki=${sig.wikiPulse}, news=${sig.newsLevel}]` : "";
      return `  - ${e.label ?? "(unnamed)"} → stake=${e.totalStake}${e.noStake != null ? `/no=${e.noStake}` : ""}${entrySig}`;
    })
    .join("\n");
  if (entries) lines.push("entries:");
  if (entries) lines.push(entries);

  return lines.join("\n");
}

function parseRankerResponse(
  raw: string,
  eligible: RankableMarket[],
): SharpRankerPick[] {
  try {
    const parsed = JSON.parse(raw);
    const picks = Array.isArray(parsed?.picks) ? parsed.picks : [];
    const validIds = new Set(eligible.map((e) => e.market.id));
    return picks
      .filter(
        (p: unknown): p is SharpRankerPick =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as SharpRankerPick).marketId === "string" &&
          validIds.has((p as SharpRankerPick).marketId),
      )
      .slice(0, SHARP_RANKER_TOP_N)
      .map((p: SharpRankerPick) => ({
        marketId: String(p.marketId),
        side: typeof p.side === "string" ? p.side.slice(0, 60) : "",
        reasoning: typeof p.reasoning === "string" ? p.reasoning.slice(0, 240) : "",
      }));
  } catch (err) {
    log(`[SharpRanker] failed to parse response: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function estimateCost(promptTokens: number, completionTokens: number): number {
  // GPT-5.4 chat-completion pricing (input ~$5/1M, output ~$15/1M).
  // Adjust if pricing changes — used purely for admin observability.
  return (promptTokens / 1_000_000) * 5 + (completionTokens / 1_000_000) * 15;
}

export function isSharpRankerEnabled(): boolean {
  return SHARP_RANKER_LLM_ENABLED;
}
