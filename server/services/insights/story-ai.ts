import OpenAI from "openai";
import type { InsightsStoryPayload } from "@shared/insights/types";
import { buildDeterministicStory } from "./story";
import { loadDriversSummary } from "./drivers";
import { getCachedTrendingPeople } from "./insights-people-cache";
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
  const n = raw ? parseInt(raw, 10) : 4;
  return Number.isFinite(n) && n > 0 ? n : 4;
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

function nextRefreshIso(): string {
  const now = new Date();
  const refreshesAt = new Date(now);
  refreshesAt.setUTCHours(6, 0, 0, 0);
  if (refreshesAt <= now) refreshesAt.setUTCDate(refreshesAt.getUTCDate() + 1);
  return refreshesAt.toISOString();
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

  const people = await getCachedTrendingPeople();
  const driverMix = await loadDriversSummary(20);

  const withChange = people.filter((p) => (p.change7d ?? 0) !== 0);
  const biggestClimber = [...withChange]
    .filter((p) => (p.change7d ?? 0) > 0)
    .sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0))[0];
  const biggestDropper = [...withChange]
    .filter((p) => (p.change7d ?? 0) < 0)
    .sort((a, b) => (a.change7d ?? 0) - (b.change7d ?? 0))[0];

  const fallback = await buildDeterministicStory();

  await logStoryEvent("generate_attempt", { model, day });
  await incrementAttemptCount(day);

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model,
      ...getChatCompletionTokenLimit(model, 280),
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You write VoxDex Today's Story — a short daily influence digest for a prediction and trends app.
Return JSON only: { "headline": string, "body": string }.
Rules:
- headline: max 100 characters, punchy, no clickbait
- body: max 2 sentences, max 400 characters total
- Use ONLY facts from the input JSON
- No speculation or predictions about the future
- Neutral, energetic tone`,
        },
        {
          role: "user",
          content: JSON.stringify({
            biggestClimber: biggestClimber
              ? {
                  name: biggestClimber.name,
                  change7d: biggestClimber.change7d,
                  rank: biggestClimber.rank,
                }
              : null,
            biggestDropper: biggestDropper
              ? {
                  name: biggestDropper.name,
                  change7d: biggestDropper.change7d,
                  rank: biggestDropper.rank,
                }
              : null,
            driverMix: driverMix.segments,
            fallbackHeadline: fallback.headline,
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

    let parsed: { headline?: string; body?: string };
    try {
      parsed = JSON.parse(text) as { headline?: string; body?: string };
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

    const headline = String(parsed.headline ?? fallback.headline).slice(0, 100);
    const body = String(parsed.body ?? fallback.body).slice(0, 400);
    const now = new Date();

    const story: InsightsStoryPayload = {
      headline,
      body,
      generatedAt: now.toISOString(),
      refreshesAt: nextRefreshIso(),
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
