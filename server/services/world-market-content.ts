/**
 * Shared LLM helper for regenerating World Market user-facing content
 * (About / What to watch / Resolution criteria / Sources).
 *
 * Used by the one-off backfill script; prompt definitions intentionally
 * mirror the Market Scout + admin "Draft with AI" wording so regenerated
 * content matches newly scouted drafts.
 */

import OpenAI from "openai";
import { getAiModel } from "../config/ai-models";
import {
  sanitizeResolutionSources,
  type ResolutionSource,
} from "@shared/lib/resolution-sources";

export type WorldMarketContentInput = {
  title: string;
  category?: string | null;
  teaser?: string | null;
  entryLabels: string[];
  /** Verbatim upstream rules text (e.g. metadata.source.resolutionRulesText). */
  rulesText?: string | null;
  existingCriteria?: string[] | null;
};

export type WorldMarketContentResult = {
  summary: string;
  scoutWatch: string;
  resolutionCriteria: string[];
  resolutionSources: ResolutionSource[] | null;
};

let _openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });
  return _openai;
}

function extractOutputText(response: unknown): string {
  const r = response as any;
  const direct = typeof r?.output_text === "string" ? r.output_text : "";
  if (direct.trim()) return direct.trim();
  const fromMessages = (r?.output || [])
    .filter((item: any) => item.type === "message")
    .flatMap((item: any) => item.content || [])
    .filter((part: any) => part.type === "output_text" || part.type === "text")
    .map((part: any) => part.text)
    .join(" ");
  return (fromMessages || "").trim();
}

function stripCitations(text: string): string {
  return text
    .replace(/【[^】]*】/g, "")
    .replace(/\[\d+\]/g, "")
    .trim();
}

/** Pull the first JSON object out of model output that may include prose/fences. */
function parseJsonObject(raw: string): Record<string, unknown> {
  let jsonText = stripCitations(raw);
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to brace extraction */
  }
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = jsonText.slice(start, end + 1);
    const parsed = JSON.parse(sliced);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  throw new Error("AI returned non-JSON content");
}

/**
 * Generate enriched content for one World Market.
 * When `useWebSearch` is true, the model can look up current context.
 */
export async function generateMarketContent(
  input: WorldMarketContentInput,
  opts?: { useWebSearch?: boolean; signal?: AbortSignal },
): Promise<WorldMarketContentResult> {
  const useWebSearch = opts?.useWebSearch === true;
  const outcomes = input.entryLabels.filter(Boolean).join(", ") || "Not specified";
  const rules =
    typeof input.rulesText === "string" && input.rulesText.trim()
      ? input.rulesText.trim().slice(0, 6000)
      : "";
  const existingCriteria = Array.isArray(input.existingCriteria)
    ? input.existingCriteria.filter((c) => typeof c === "string" && c.trim()).join("; ")
    : "";

  const systemPrompt = `You enrich user-facing copy for a VoxDex World Market (play-money prediction market). Return ONE JSON object only — no markdown, no code fences.

Fields:
- "summary": 3-5 sentences (~60-110 words) of engaging BACKGROUND CONTEXT: what's happening, key players, stakes, current state of play. Self-contained, neutral, in your own words. Do NOT restate resolution mechanics, outcome labels, or "Other" catch-alls.
- "scoutWatch": 1-2 sentences (or 2-4 semicolon-separated indicators) of leading indicators a casual reader should watch. User-facing "What to watch" tone.
- "resolutionCriteria": 1-3 short bullet strings, IN YOUR OWN WORDS, stating precisely how the market resolves (source of truth, deadline, edge cases). Do not copy upstream rules verbatim.
- "resolutionSources": 1-3 objects { "label": "...", "url"?: "..." } naming AUTHORITATIVE real-world sources of truth. Prefer a public URL when known; omit url when unsure. NEVER include Polymarket, Kalshi, PredictIt, or other prediction-market platforms.

Respond as:
{ "summary": "...", "scoutWatch": "...", "resolutionCriteria": ["..."], "resolutionSources": [{ "label": "...", "url": "..." }] }`;

  const userPrompt = `Market: "${input.title}"
Category: ${input.category || "General"}
${input.teaser ? `Teaser: "${input.teaser}"` : ""}
Outcomes: ${outcomes}
${existingCriteria ? `Existing resolution criteria (may refine, do not invent conflicting rules): ${existingCriteria}` : ""}
${rules ? `Upstream rules text (paraphrase for criteria; use for background facts only — do not copy):\n${rules}` : ""}

Generate the JSON object now.`;

  const body: Record<string, unknown> = {
    model: getAiModel("worldMarkets"),
    max_output_tokens: 1200,
    instructions: systemPrompt,
    input: userPrompt,
  };
  if (useWebSearch) {
    body.tools = [{ type: "web_search" }];
  }

  const response = await getClient().responses.create(
    body as any,
    opts?.signal ? { signal: opts.signal } : undefined,
  );

  const parsed = parseJsonObject(extractOutputText(response));
  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 2000) : "";
  const scoutWatch =
    typeof parsed.scoutWatch === "string" ? parsed.scoutWatch.trim().slice(0, 600) : "";
  const resolutionCriteria = Array.isArray(parsed.resolutionCriteria)
    ? parsed.resolutionCriteria
        .map((c: unknown) => (typeof c === "string" ? c.trim() : ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const resolutionSources = sanitizeResolutionSources(parsed.resolutionSources, {
    max: 3,
  });

  if (!summary) {
    throw new Error("AI returned empty summary");
  }

  return {
    summary,
    scoutWatch,
    resolutionCriteria,
    resolutionSources,
  };
}
