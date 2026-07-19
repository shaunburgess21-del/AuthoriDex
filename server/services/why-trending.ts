import OpenAI from "openai";
import { createHash } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { apiCache, type TrendingPerson } from "@shared/schema";
import { db } from "../db";
import {
  fetchTrendingNewsContext,
  getSerperDegradedState,
  consumeSerperDegradedProbe,
} from "../providers/serper";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import { isWithinWhyTrendingStaleGrace } from "./why-trending-stale";

export {
  WHY_TRENDING_MAX_STALE_HOURS,
  isWithinWhyTrendingStaleGrace,
} from "./why-trending-stale";

function providerUnavailablePayload(
  person: TrendingPerson,
  degraded: NonNullable<ReturnType<typeof getSerperDegradedState>>,
): WhyTrendingPayload {
  return {
    personId: person.id,
    personName: person.name,
    hasContext: false,
    cacheStatus: "PROVIDER_UNAVAILABLE",
    providerReason: degraded.reason,
    providerSince: degraded.since,
    staleAgeMinutes: null,
    message: "Trending insights are temporarily unavailable. Please try again shortly.",
    fetchedAt: new Date(),
  };
}

export const WHY_TRENDING_PROMPT_VERSION = 5;
export const WHY_TRENDING_CACHE_TTL_HOURS = 4;
export const WHY_TRENDING_RATE_LIMIT_MINUTES = 30;
export const WHY_TRENDING_RANK_CUTOFF = 20;
export const WHY_TRENDING_RANK_EXIT = 22;
export const WHY_TRENDING_LOCK_TTL_SECONDS = 180;

const inFlightRegenerations = new Map<string, Promise<void>>();

export type WhyTrendingCacheStatus =
  | "HIT"
  | "STALE_SERVING"
  | "STALE_EXTENDED"
  | "REGENERATED"
  | "LOCKED_STALE"
  | "LOCKED_COLD"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "NO_NEWS"
  | "NOT_ELIGIBLE";

export interface WhyTrendingPayload {
  personId: string;
  personName: string;
  hasContext: boolean;
  summary?: string;
  category?: string;
  topHeadline?: string;
  sources?: Array<{ title: string; link: string; date?: string }>;
  fetchedAt: Date | string;
  message?: string;
  cacheStatus?: WhyTrendingCacheStatus;
  staleAgeMinutes?: number | null;
  inputHash?: string;
  providerReason?: string;
  providerSince?: string;
  provenance?: {
    model: string;
    promptVersion: number;
    serperQuery: string;
    serperTbs: string;
    headlinesUsed: Array<{ title: string; link: string }>;
    generatedAt: string;
  };
}

export interface WhyTrendingGenerationOptions {
  hotMover?: boolean;
  /** Skip SWR and always run the full generation path (admin/cron blocking). */
  force?: boolean;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

function normalizeTitle(title: string): string {
  let t = title;
  t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
  t = t.replace(/\s*[-–—|]\s*(CNN|Reuters|AP|BBC|NBC|CBS|ABC|Fox News|CNBC|Bloomberg|Forbes|WSJ|The Guardian|The New York Times|Associated Press|NPR|USA Today|The Washington Post|Sky News|Al Jazeera|MSNBC|The Hill|Politico|TechCrunch|The Verge|Variety|TMZ|E! News|People|Entertainment Weekly|ESPN|Daily Mail|NY Post|New York Post|Axios|Business Insider|The Independent)\.?$/i, "");
  t = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return t;
}

/** Hash top-3 headlines only — more stable than the full Serper list. */
export function computeHeadlineHash(sources: Array<{ title: string; link?: string }>): string {
  const top = sources.slice(0, 3);
  const stableIds = top.map((s) => {
    const domain = s.link ? extractDomain(s.link) : "unknown";
    return `${domain}|${normalizeTitle(s.title)}`;
  });
  return createHash("sha256").update(stableIds.sort().join("||")).digest("hex").slice(0, 16);
}

function cacheKeys(personId: string) {
  return {
    cacheKey: `why_trending:${personId}`,
    lockKey: `why_trending_lock:${personId}`,
    rateLimitKey: `why_trending_ratelimit:${personId}`,
  };
}

async function loadWhyTrendingCacheRows(personId: string) {
  const keys = cacheKeys(personId);
  const rows = await db
    .select()
    .from(apiCache)
    .where(inArray(apiCache.cacheKey, [keys.cacheKey, keys.lockKey, keys.rateLimitKey]));
  const byKey = new Map(rows.map((r) => [r.cacheKey, r]));
  return {
    ...keys,
    cached: byKey.get(keys.cacheKey),
    lock: byKey.get(keys.lockKey),
    rateLimit: byKey.get(keys.rateLimitKey),
  };
}

function attachStaleAge(result: WhyTrendingPayload): WhyTrendingPayload {
  if (result.provenance?.generatedAt) {
    result.staleAgeMinutes = Math.round(
      (Date.now() - new Date(result.provenance.generatedAt).getTime()) / 60000,
    );
  }
  return result;
}

function parseCachedPayload(cached: { responseData: string }): WhyTrendingPayload | null {
  try {
    return JSON.parse(cached.responseData) as WhyTrendingPayload;
  } catch {
    return null;
  }
}

export async function getCachedWhyTrending(personId: string) {
  const { cached, cacheKey } = await loadWhyTrendingCacheRows(personId);
  return { cacheKey, row: cached, payload: cached ? parseCachedPayload(cached) : null };
}

async function getTopNEligibility(personId: string): Promise<{
  eligible: boolean;
  lastRankSeen: number;
  consecutiveOutside: number;
}> {
  const eligibilityCacheKey = `top10_eligible:${personId}`;
  const [row] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, eligibilityCacheKey)).limit(1);
  if (row) {
    try {
      return JSON.parse(row.responseData);
    } catch {
      /* fall through */
    }
  }
  return { eligible: false, lastRankSeen: 999, consecutiveOutside: 0 };
}

export async function updateTopNEligibility(personId: string, rank: number | null): Promise<boolean> {
  const currentRank = rank ?? 999;
  const state = await getTopNEligibility(personId);

  // Fast path: deeply non-eligible (rank well past exit and not currently sticky).
  // Skips the DB write entirely for the long tail of profile visits.
  if (currentRank > WHY_TRENDING_RANK_EXIT && !state.eligible) {
    return false;
  }

  const eligibilityCacheKey = `top10_eligible:${personId}`;

  if (currentRank <= WHY_TRENDING_RANK_CUTOFF) {
    state.eligible = true;
    state.consecutiveOutside = 0;
  } else if (currentRank >= WHY_TRENDING_RANK_EXIT) {
    state.eligible = false;
    state.consecutiveOutside = 0;
  } else {
    state.consecutiveOutside += 1;
    if (state.consecutiveOutside >= 2) {
      state.eligible = false;
    }
  }
  state.lastRankSeen = currentRank;

  const now = new Date();
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  await db
    .insert(apiCache)
    .values({
      cacheKey: eligibilityCacheKey,
      provider: "system",
      responseData: JSON.stringify(state),
      fetchedAt: now,
      expiresAt: farFuture,
    })
    .onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: {
        responseData: JSON.stringify(state),
        fetchedAt: now,
      },
    });

  return state.eligible;
}

async function acquireLock(lockKey: string, personId: string): Promise<void> {
  const lockNow = new Date();
  const lockExpires = new Date(lockNow.getTime() + WHY_TRENDING_LOCK_TTL_SECONDS * 1000);
  await db
    .insert(apiCache)
    .values({
      cacheKey: lockKey,
      provider: "system",
      responseData: JSON.stringify({ personId, lockedAt: lockNow.toISOString() }),
      fetchedAt: lockNow,
      expiresAt: lockExpires,
    })
    .onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: {
        fetchedAt: lockNow,
        expiresAt: lockExpires,
        responseData: JSON.stringify({ personId, lockedAt: lockNow.toISOString() }),
      },
    });
}

async function releaseLock(lockKey: string): Promise<void> {
  try {
    await db.delete(apiCache).where(eq(apiCache.cacheKey, lockKey));
  } catch {
    /* best-effort */
  }
}

async function persistSummaryCache(cacheKey: string, result: WhyTrendingPayload): Promise<void> {
  const cacheNow = new Date();
  const cacheExpiresAt = new Date(cacheNow.getTime() + WHY_TRENDING_CACHE_TTL_HOURS * 60 * 60 * 1000);
  const responseData = JSON.stringify(result);
  await db
    .insert(apiCache)
    .values({
      cacheKey,
      provider: "ai_trending",
      responseData,
      fetchedAt: cacheNow,
      expiresAt: cacheExpiresAt,
    })
    .onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: { responseData, fetchedAt: cacheNow, expiresAt: cacheExpiresAt },
    });
}

async function setRateLimitMarker(rateLimitKey: string, personId: string): Promise<void> {
  const rlNow = new Date();
  const rlExpires = new Date(rlNow.getTime() + WHY_TRENDING_RATE_LIMIT_MINUTES * 60 * 1000);
  await db
    .insert(apiCache)
    .values({
      cacheKey: rateLimitKey,
      provider: "system",
      responseData: JSON.stringify({ personId, generatedAt: rlNow.toISOString() }),
      fetchedAt: rlNow,
      expiresAt: rlExpires,
    })
    .onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: {
        fetchedAt: rlNow,
        expiresAt: rlExpires,
        responseData: JSON.stringify({ personId, generatedAt: rlNow.toISOString() }),
      },
    });
}

/**
 * Full generation path (Serper + optional OpenAI). Used by cron and cold requests.
 */
export async function generateWhyTrendingSummary(
  person: TrendingPerson,
  options: WhyTrendingGenerationOptions = {},
): Promise<WhyTrendingPayload> {
  const personId = person.id;
  const { cacheKey, lockKey, rateLimitKey, cached, lock, rateLimit } =
    await loadWhyTrendingCacheRows(personId);

  if (!options.force && cached?.expiresAt && cached.expiresAt > new Date()) {
    const hit = parseCachedPayload(cached);
    if (hit) {
      hit.cacheStatus = "HIT";
      return attachStaleAge(hit);
    }
  }

  if (lock?.expiresAt && lock.expiresAt > new Date()) {
    if (cached) {
      const stale = parseCachedPayload(cached);
      if (stale) {
        stale.cacheStatus = "LOCKED_STALE";
        return attachStaleAge(stale);
      }
    }
    return {
      personId,
      personName: person.name,
      hasContext: false,
      cacheStatus: "LOCKED_COLD",
      message: "Summary is being generated, please try again shortly",
      fetchedAt: new Date(),
    };
  }

  // While Serper is degraded, avoid live calls except for a rare recovery probe
  // (or force). Prefer serving grace-window stale content over blanking the UI.
  const degradedBeforeFetch = getSerperDegradedState();
  if (degradedBeforeFetch && !options.force && !consumeSerperDegradedProbe()) {
    if (cached && isWithinWhyTrendingStaleGrace(cached.fetchedAt)) {
      const stale = parseCachedPayload(cached);
      if (stale) {
        stale.cacheStatus = "STALE_SERVING";
        return attachStaleAge(stale);
      }
    }
    return providerUnavailablePayload(person, degradedBeforeFetch);
  }

  await acquireLock(lockKey, personId);

  try {
    const newsContext = await fetchTrendingNewsContext(person.name);

    if (!newsContext || newsContext.sources.length === 0) {
      const degraded = getSerperDegradedState();
      if (cached && isWithinWhyTrendingStaleGrace(cached.fetchedAt)) {
        const stale = parseCachedPayload(cached);
        if (stale) {
          stale.cacheStatus = "STALE_SERVING";
          return attachStaleAge(stale);
        }
      }
      if (degraded) {
        return providerUnavailablePayload(person, degraded);
      }
      return {
        personId,
        personName: person.name,
        hasContext: false,
        cacheStatus: "NO_NEWS",
        staleAgeMinutes: null,
        message: "No recent trending context available",
        fetchedAt: new Date(),
      };
    }

    const currentInputHash = computeHeadlineHash(newsContext.sources);

    if (cached) {
      const previousResult = parseCachedPayload(cached);
      const cachedPromptVersion = previousResult?.provenance?.promptVersion ?? 0;
      if (
        previousResult
        && previousResult.inputHash === currentInputHash
        && previousResult.hasContext
        && cachedPromptVersion >= WHY_TRENDING_PROMPT_VERSION
      ) {
        console.log(`[WhyTrending] Input hash unchanged for ${person.name}, extending TTL (skipping OpenAI)`);
        const extendNow = new Date();
        previousResult.fetchedAt = extendNow;
        previousResult.cacheStatus = "STALE_EXTENDED";
        attachStaleAge(previousResult);
        await persistSummaryCache(cacheKey, previousResult);
        return previousResult;
      }
    }

    if (rateLimit?.expiresAt && rateLimit.expiresAt > new Date()) {
      console.log(`[WhyTrending] Rate limited for ${person.name}, returning stale cache or empty`);
      if (cached) {
        const rlResult = parseCachedPayload(cached);
        if (rlResult) {
          rlResult.cacheStatus = "RATE_LIMITED";
          return attachStaleAge(rlResult);
        }
      }
      return {
        personId,
        personName: person.name,
        hasContext: false,
        cacheStatus: "RATE_LIMITED",
        staleAgeMinutes: null,
        message: "Rate limited - please try again later",
        fetchedAt: new Date(),
      };
    }

    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    });

    const headlinesText = newsContext.sources
      .map((s) => {
        const dateLabel = s.date ? ` (${s.date})` : "";
        return `${s.title}${dateLabel}`;
      })
      .join("\n");
    const todayStr = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = `You are a neutral wire-service news reporter (like AP or Reuters). Today's date is ${todayStr}. Use the headlines provided to determine what is currently happening. Treat all information in the headlines as current events happening right now.

CRITICAL RULES:
- Do NOT add titles like "former", "ex-", or "President" to anyone's name unless that exact title appears in the headlines.
- If the headlines simply say a person's name without a title, use just their name — do NOT infer or add titles from your training data.
- Never call someone "former President" or "former CEO" unless the headline explicitly uses that phrase.
- When in doubt, just use the person's name without any title prefix.
- You must NEVER express or imply public opinion, approval, or disapproval of any figure.
- Never use phrases like "facing backlash", "widely criticized", "growing dissatisfaction", "public outcry", or "mounting pressure" unless those exact phrases appear in a headline.
- Never characterize how the public feels about a person. Only describe what the person DID or what HAPPENED.
- For politically polarizing figures, describe actions and events only. Do not editorialize.`;

    const userPrompt = `Based on these recent news headlines about ${person.name}, write a brief 1-2 sentence summary explaining why they are currently in the news.

RECENCY RULES:
- Each headline may have a date in parentheses. Prioritize the most recent headlines.
- If older headlines (3+ days before today) appear alongside newer ones, focus your summary on what happened most recently.
- The summary should reflect what is happening NOW, not days ago.

STRICT NEUTRALITY RULES:
- Describe ONLY actions taken and events that occurred — never describe reactions, opinions, or public sentiment
- Do NOT use any of these words or phrases: controversial, criticized, backlash, scandal, slammed, blasted, under fire, embattled, divisive, polarizing, widely, overwhelmingly, growing concern, mounting, outcry, fury, outrage
- Do NOT characterize public opinion (e.g. never say "Americans are frustrated" or "facing widespread criticism")
- Write as a wire-service reporter: facts only, zero commentary
- If headlines are mostly negative about a person, still summarize neutrally by focusing on what happened, not how people reacted
- Treat every public figure with the same neutral tone regardless of political affiliation

Headlines:
${headlinesText}

Return a JSON object with:
{
  "summary": "1-2 sentence strictly factual summary describing what happened or what actions were taken",
  "category": "One of: Politics, Business, Music, Sports, Technology, Legal, Personal Life, Controversy, or General News"
}

Only return the JSON object.`;

    const whyTrendingModel = getAiModel("whyTrending");
    const response = await openai.chat.completions.create({
      model: whyTrendingModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      ...getChatCompletionTokenLimit(whyTrendingModel, 200),
    });

    const content = response.choices[0]?.message?.content;
    const parsed = content
      ? JSON.parse(content)
      : { summary: newsContext.headline, category: newsContext.category };

    const generatedAt = new Date().toISOString();
    const result: WhyTrendingPayload = {
      personId,
      personName: person.name,
      hasContext: true,
      summary: parsed.summary || newsContext.headline,
      category: parsed.category || newsContext.category,
      topHeadline: newsContext.headline,
      sources: newsContext.sources.slice(0, 3),
      fetchedAt: new Date(),
      inputHash: currentInputHash,
      cacheStatus: "REGENERATED",
      staleAgeMinutes: 0,
      provenance: {
        model: whyTrendingModel,
        promptVersion: WHY_TRENDING_PROMPT_VERSION,
        serperQuery: person.name,
        serperTbs: "qdr:3d",
        headlinesUsed: newsContext.sources.slice(0, 5).map((s) => ({
          title: s.title,
          link: s.link,
        })),
        generatedAt,
      },
    };

    await persistSummaryCache(cacheKey, result);
    await setRateLimitMarker(rateLimitKey, personId);
    console.log(`[WhyTrending] Generated new summary for ${person.name} (hash: ${currentInputHash})`);
    return result;
  } finally {
    await releaseLock(lockKey);
  }
}

export function scheduleBackgroundWhyTrendingRefresh(
  person: TrendingPerson,
  options: WhyTrendingGenerationOptions = {},
): void {
  if (inFlightRegenerations.has(person.id)) return;

  const work = (async () => {
    try {
      await generateWhyTrendingSummary(person, options);
    } catch (err: any) {
      console.error(
        `[WhyTrending] Background refresh failed for ${person.name}:`,
        err?.message ?? err,
      );
    } finally {
      inFlightRegenerations.delete(person.id);
    }
  })();

  inFlightRegenerations.set(person.id, work);
  void work;
}

/**
 * HTTP handler entry: eligibility, SWR, then blocking cold path.
 */
export async function fetchWhyTrendingForPerson(
  person: TrendingPerson,
  hotMover: boolean,
): Promise<WhyTrendingPayload> {
  const eligible = hotMover || (await updateTopNEligibility(person.id, person.rank ?? null));

  if (!eligible) {
    return {
      personId: person.id,
      personName: person.name,
      hasContext: false,
      cacheStatus: "NOT_ELIGIBLE",
      message: `Why Trending is only available for top ${WHY_TRENDING_RANK_CUTOFF} ranked celebrities and Hot Movers`,
      fetchedAt: new Date(),
    };
  }

  const { row: cached, payload } = await getCachedWhyTrending(person.id);

  if (cached?.expiresAt && cached.expiresAt > new Date() && payload) {
    payload.cacheStatus = "HIT";
    return attachStaleAge(payload);
  }

  // Serve expired summaries for up to WHY_TRENDING_MAX_STALE_HOURS so a Serper
  // outage (e.g. overnight quota exhaustion) does not blank the UI immediately.
  // Past the grace window, fall through to generation → PROVIDER_UNAVAILABLE
  // while Serper is still down, or a fresh summary once it recovers.
  if (cached && payload && isWithinWhyTrendingStaleGrace(cached.fetchedAt)) {
    payload.cacheStatus = "STALE_SERVING";
    attachStaleAge(payload);
    // Skip background refresh while Serper is known-degraded (401/402/429/quota)
    // so every profile view does not hammer a dead provider.
    if (!getSerperDegradedState()) {
      scheduleBackgroundWhyTrendingRefresh(person, { hotMover });
    }
    return payload;
  }

  return generateWhyTrendingSummary(person, { hotMover });
}
