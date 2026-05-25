/**
 * LLM market-read for native markets (updown / h2h / gainer).
 * One assessment per market per TTL — cached in metadata.nativeAssessment.
 */

import OpenAI from "openai";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { predictionMarkets, trendSnapshots } from "@shared/schema";
import type { MarketWithEntries, TrendSignals } from "./types";
import type { NativeAssessment, NativeExpectedDirection } from "./nativeMarketTypes";
import { log } from "../log";
import {
  NATIVE_MARKETS_LLM_ENABLED,
  NATIVE_ASSESSMENT_TTL_MS,
} from "./constants";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import { tryReserveNativeLlmCall } from "./nativeMarketBudget";

let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  _openaiClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });
  return _openaiClient;
}

const API_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 400;

const inFlight = new Map<string, Promise<NativeAssessment | null>>();

interface CachedNativeAssessment {
  assessment: NativeAssessment;
  cachedAt: string;
}

function readCached(market: { metadata?: unknown }): NativeAssessment | null {
  const meta = market.metadata;
  if (!meta || typeof meta !== "object") return null;
  const cached = (meta as Record<string, unknown>).nativeAssessment as
    | CachedNativeAssessment
    | undefined;
  if (!cached?.cachedAt || !cached.assessment) return null;
  const age = Date.now() - new Date(cached.cachedAt).getTime();
  if (!Number.isFinite(age) || age < 0 || age > NATIVE_ASSESSMENT_TTL_MS) return null;
  return cached.assessment;
}

async function writeCached(marketId: string, assessment: NativeAssessment): Promise<void> {
  try {
    const payload = {
      nativeAssessment: {
        assessment,
        cachedAt: new Date().toISOString(),
      },
    };
    await db
      .update(predictionMarkets)
      .set({
        metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, marketId));
  } catch (err) {
    log(
      `[NativeEngine] cache write failed market=${marketId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function loadRecentHeadlines(personId: string, limit = 5): Promise<string[]> {
  const [snap] = await db
    .select({ diagnostics: trendSnapshots.diagnostics })
    .from(trendSnapshots)
    .where(eq(trendSnapshots.personId, personId))
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);
  const diag = snap?.diagnostics as Record<string, unknown> | null;
  const evidence = diag?.evidence as Record<string, unknown> | undefined;
  const headlines = evidence?.newsHeadlines;
  if (!Array.isArray(headlines)) return [];
  return headlines
    .slice(0, limit)
    .map((h) => (typeof h === "string" ? h : String((h as { title?: string })?.title ?? h)))
    .filter((s) => s.length > 0);
}

function buildPrompt(
  market: MarketWithEntries,
  signals: TrendSignals | null,
  headlines: string[],
): { system: string; user: string } {
  const entries = market.entries.map((e) => e.label ?? e.id).join(" vs ");
  const pct =
    signals?.pctChangeVsOpen != null
      ? `${(signals.pctChangeVsOpen * 100).toFixed(1)}%`
      : "unknown";
  const d7 = signals?.scoreDelta7d ?? 0;
  const direction = signals?.trendDirection ?? "FLAT";

  const system = [
    "You estimate short-term influence trajectory for a weekly prediction market.",
    "The market resolves based on whether a person's trend score closes above or below their opening baseline.",
    "Output STRICT JSON only:",
    '{"expectedDirection":"UP"|"DOWN"|"FLAT","probability":0.0-1.0,"rationale":"max 200 chars"}',
    "probability = chance the UP side (or leading entry in a multi-way market) wins at resolution.",
    "Use the composite trend signals; headlines are context only.",
  ].join("\n");

  let user = `Market type: ${market.marketType}\nTitle: ${market.title}\nOptions: ${entries}\n`;
  const d14 = signals?.scoreDelta14d;
  user += `pctChangeVsOpen: ${pct}\n7d score delta: ${d7.toFixed(1)}\n`;
  if (d14 != null && Number.isFinite(d14)) {
    user += `14d score delta: ${d14.toFixed(1)}\n`;
  }
  user += `trendDirection: ${direction}\n`;
  if (headlines.length > 0) {
    user += `Recent headlines:\n${headlines.map((h) => `- ${h}`).join("\n")}\n`;
  }

  if (market.marketType === "h2h" && market.entries.length === 2) {
    user += `For H2H: probability is P(${market.entries[0].label} wins over ${market.entries[1].label}).\n`;
  }
  if (market.marketType === "gainer") {
    user += `For category race: probability is P(${market.entries[0]?.label ?? "leader"} finishes strongest vs open).\n`;
  }

  return { system, user };
}

function parseAssessment(
  raw: string,
  market: MarketWithEntries,
  model: string,
  inputs: NativeAssessment["inputs"],
): NativeAssessment | null {
  let jsonText = raw.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const dir = String(parsed.expectedDirection ?? "").toUpperCase();
  if (dir !== "UP" && dir !== "DOWN" && dir !== "FLAT") return null;
  const prob = Number(parsed.probability);
  if (!Number.isFinite(prob) || prob < 0 || prob > 1) return null;
  const rationale = String(parsed.rationale ?? "").slice(0, 200);

  return {
    expectedDirection: dir as NativeExpectedDirection,
    probability: prob,
    rationale,
    fetchedAt: new Date().toISOString(),
    model,
    marketType: market.marketType,
    inputs,
  };
}

async function callLlm(
  market: MarketWithEntries,
  signals: TrendSignals | null,
  forceRefresh = false,
): Promise<NativeAssessment | null> {
  if (!NATIVE_MARKETS_LLM_ENABLED) return null;

  if (!forceRefresh) {
    const cached = readCached(market);
    if (cached) return cached;
  }

  const reservation = tryReserveNativeLlmCall();
  if (!reservation.allowed) return null;

  const personId = market.personId ?? market.entries[0]?.personId ?? null;
  const headlines = personId ? await loadRecentHeadlines(personId) : [];
  const inputs: NativeAssessment["inputs"] = {
    pctChangeVsOpen: signals?.pctChangeVsOpen,
    scoreDelta7d: signals?.scoreDelta7d,
    scoreDelta14d: signals?.scoreDelta14d,
    topNewsHeadlines: headlines,
    entryLabels: market.entries.map((e) => e.label ?? ""),
  };

  const { system, user } = buildPrompt(market, signals, headlines);
  const model = getAiModel("nativeMarkets");
  const tokenLimit = getChatCompletionTokenLimit(model, MAX_OUTPUT_TOKENS);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const completion = await getOpenAIClient().chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        ...tokenLimit,
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const assessment = parseAssessment(raw, market, model, inputs);
    if (!assessment) {
      reservation.release();
      return null;
    }
    reservation.commit();
    await writeCached(market.id, assessment);
    return assessment;
  } catch (err) {
    reservation.release();
    log(
      `[NativeEngine] LLM failed market=${market.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Returns cached assessment when fresh; otherwise one LLM call per market.
 */
export async function getOrFetchNativeAssessment(
  market: MarketWithEntries,
  signals: TrendSignals | null,
  options: { forceRefresh?: boolean } = {},
): Promise<NativeAssessment | null> {
  if (!NATIVE_MARKETS_LLM_ENABLED) return null;

  if (!options.forceRefresh) {
    const cached = readCached(market);
    if (cached) return cached;
  }

  const existing = inFlight.get(market.id);
  if (existing && !options.forceRefresh) return existing;

  const promise = callLlm(market, signals, options.forceRefresh).finally(() => {
    inFlight.delete(market.id);
  });
  inFlight.set(market.id, promise);
  return promise;
}

export async function prefetchNativeAssessmentsForSweep(
  markets: Array<{ market: MarketWithEntries; signals: TrendSignals | null }>,
): Promise<Map<string, NativeAssessment | null>> {
  const map = new Map<string, NativeAssessment | null>();
  if (!NATIVE_MARKETS_LLM_ENABLED) return map;

  const nativeTypes = new Set(["updown", "h2h", "gainer"]);
  const targets = markets.filter((m) => nativeTypes.has(m.market.marketType));

  await Promise.all(
    targets.map(async ({ market, signals }) => {
      const a = await getOrFetchNativeAssessment(market, signals);
      map.set(market.id, a);
    }),
  );
  return map;
}
