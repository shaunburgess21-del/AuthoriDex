import OpenAI from "openai";
import type { InsightsStoryPayload } from "@shared/insights/types";
import { buildBriefingInputs } from "./story";
import {
  buildDeterministicHeadline,
  buildDeterministicParagraphs,
  nextBriefingRefreshIso,
  type BriefingPersonInput,
} from "./story-briefing";
import { getAiModel, getChatCompletionTokenLimit } from "../../config/ai-models";
import {
  getInsightsCache,
  setInsightsCache,
  INSIGHTS_STORY_TTL_MS,
} from "./cache";
import { db } from "../../db";
import { insightsEvents } from "@shared/schema";

const COOLDOWN_KEY = "insights_story:ai_cooldown_until";
const ATTEMPTS_PREFIX = "insights_story:ai_attempts:";
const COOLDOWN_MS = 10 * 60 * 1000;

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function maxAttemptsPerDay(): number {
  const raw = process.env.INSIGHTS_AI_STORY_MAX_PER_DAY;
  const n = raw ? parseInt(raw, 10) : 6;
  return Number.isFinite(n) && n > 0 ? n : 6;
}

function storyModel(): string {
  const override = process.env.INSIGHTS_AI_STORY_MODEL?.trim();
  if (override) return override;
  return getAiModel("whyTrending");
}

async function logStoryEvent(
  action: string,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(insightsEvents).values({
      userId: null,
      surface: "ai_story",
      action,
      params,
    });
  } catch (err) {
    console.error("[insights-story-ai] audit log failed:", err);
  }
}

async function getAttemptCount(day: string): Promise<number> {
  const cached = await getInsightsCache<{ count: number }>(`${ATTEMPTS_PREFIX}${day}`);
  return cached?.count ?? 0;
}

async function incrementAttemptCount(day: string): Promise<number> {
  const next = (await getAttemptCount(day)) + 1;
  await setInsightsCache(`${ATTEMPTS_PREFIX}${day}`, "insights_story", { count: next }, INSIGHTS_STORY_TTL_MS);
  return next;
}

async function isCooldownActive(): Promise<boolean> {
  const row = await getInsightsCache<{ until: string }>(COOLDOWN_KEY);
  if (!row?.until) return false;
  return Date.now() < new Date(row.until).getTime();
}

async function setCooldown(): Promise<void> {
  const until = new Date(Date.now() + COOLDOWN_MS).toISOString();
  await setInsightsCache(COOLDOWN_KEY, "insights_story", { until }, COOLDOWN_MS);
}

function mapBriefingPersonForAi(person: BriefingPersonInput) {
  return {
    name: person.name,
    category: person.category,
    whyTrending: person.whyTrending ?? null,
    topHeadline: person.topHeadline ?? null,
  };
}

function normalizeParagraphs(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const paragraphs = raw
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0)
    .slice(0, 6);
  return paragraphs.length > 0 ? paragraphs : fallback;
}

export async function generateAiInsightsStory(): Promise<InsightsStoryPayload | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const day = utcDayKey();
  if (await isCooldownActive()) {
    return null;
  }
  if ((await getAttemptCount(day)) >= maxAttemptsPerDay()) {
    return null;
  }

  const model = storyModel();
  const start = Date.now();

  const briefingInputs = await buildBriefingInputs({ allowPrefetch: true });
  const fallbackParagraphs = buildDeterministicParagraphs(briefingInputs);
  const fallbackHeadline = buildDeterministicHeadline(briefingInputs);

  await logStoryEvent("generate_attempt", { model, day });
  await incrementAttemptCount(day);

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model,
      ...getChatCompletionTokenLimit(model, 800),
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You write VoxDex's "Today's Briefing" — a short daily editorial on who is gaining attention on the board.
Return JSON only: { "headline": string, "paragraphs": string[] }.
Rules:
- headline: max 100 characters, punchy, no clickbait. Do NOT include exact percentages or "leads with X%" — the headline must stay true for ~12 hours as the leaderboard shifts.
- paragraphs: one short beat (2-3 sentences) per person — all anchors first (in array order), then all movers (in array order); up to 6 total; max 1300 characters across all paragraphs
- Use ONLY facts from the input JSON (names, categories, whyTrending summaries, headlines)
- Do NOT quote specific percentage moves or rankings in prose — these change hourly and the page shows live figures separately. Describe WHY people are in the news, not by how much they moved.
- No speculation or predictions about the future
- Neutral, energetic tone
- Never mention internal metrics (velocity, mass, fame index, trend score, driver mix, percentages of signal types)`,
        },
        {
          role: "user",
          content: JSON.stringify({
            asOf: new Date().toISOString(),
            // Deliberately omit change24h — the prose must stay number-light
            // so it doesn't go stale; live figures render separately.
            anchors: briefingInputs.anchors.map(mapBriefingPersonForAi),
            movers: briefingInputs.movers.map(mapBriefingPersonForAi),
            fallbackHeadline,
          }),
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();
    const latencyMs = Date.now() - start;
    const tokensUsed = response.usage?.total_tokens ?? null;

    if (!text) {
      await setCooldown();
      await logStoryEvent("generate_fail", {
        model,
        day,
        latencyMs,
        error: "empty_response",
        tokensUsed,
      });
      return null;
    }

    let parsed: { headline?: string; paragraphs?: unknown; body?: string };
    try {
      parsed = JSON.parse(text) as { headline?: string; paragraphs?: unknown; body?: string };
    } catch {
      await setCooldown();
      await logStoryEvent("generate_fail", {
        model,
        day,
        latencyMs,
        error: "invalid_json",
        tokensUsed,
      });
      return null;
    }

    const headline = String(parsed.headline ?? fallbackHeadline).slice(0, 100);
    const paragraphs = normalizeParagraphs(
      parsed.paragraphs ?? parsed.body?.split(/\n\n+/),
      fallbackParagraphs,
    );
    const body = paragraphs.join(" ").slice(0, 1400);
    const now = new Date();

    const story: InsightsStoryPayload = {
      headline,
      body,
      paragraphs,
      people: briefingInputs.people,
      generatedAt: now.toISOString(),
      refreshesAt: nextBriefingRefreshIso(now),
      mode: "ai",
    };

    await logStoryEvent("generate_success", {
      model,
      day,
      latencyMs,
      tokensUsed,
      headline,
      headlineLen: headline.length,
      bodyLen: body.length,
      paragraphCount: paragraphs.length,
      anchorCount: briefingInputs.anchors.length,
      moverCount: briefingInputs.movers.length,
    });

    return story;
  } catch (err) {
    await setCooldown();
    const message = err instanceof Error ? err.message : String(err);
    await logStoryEvent("generate_fail", {
      model,
      day,
      latencyMs: Date.now() - start,
      error: message.slice(0, 200),
    });
    console.error("[insights-story-ai]", err);
    return null;
  }
}
