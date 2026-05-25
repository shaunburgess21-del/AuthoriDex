import OpenAI from "openai";
import { createHash } from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  type CelebrityProfile,
  type InsertCelebrityProfile,
  type TrendingPerson,
  apiCache,
} from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { fetchNetWorthContext, fetchWebSearchContext, type NetWorthContext, type WebSearchContext } from "../providers/serper";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import { classifyNetWorthVolatility } from "./net-worth-refresher";

export const PROFILE_PROMPT_VERSION = 3;
export const PROFILE_BIO_TTL_DAYS = 30;
/** Cron only force-regenerates bios older than this (daily job). */
export const PROFILE_BIO_CRON_REFRESH_DAYS = 25;

const PROFILE_LOCK_TTL_SECONDS = 120;
const inFlightRegenerations = new Map<string, Promise<void>>();

const HIGH_RISK_CATEGORY_RE = /politic|business|tech|technology|finance|world leader|government/i;
const ROLE_CHANGE_RE = /\b(defeated|lost election|no longer|former|replaced by|succeeded by|ousted|resigned|stepped down|appointed|elected|inaugurated|became|named|will become|set to become)\b/i;
const CURRENT_ROLE_RE = /\b(currently|serves as|is the|is an|is a|became|current)\b/i;
const MONEY_RE = /\$[\d,.]+(?:\s*(?:-|to)\s*\$?[\d,.]+)?\s*(?:billion|million|trillion|thousand|[KMBT])\b/i;
const NET_WORTH_CONTEXT_RE = /\b(net worth|fortune|wealth|worth an estimated|estimated worth)\b/i;

const monthIndex: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

// Country-code coercion: tolerate the common model output drift (lowercase,
// padding, 3-letter ISO, punctuation like "?", empty string) so a malformed
// code doesn't synchronously throw out of the Zod parse and skip the retry
// loop. The strict 2-letter requirement is enforced as a soft validation
// note instead (see validateGeneratedProfile), which gives the model a
// second chance with explicit feedback before we fall back in
// applyValidationFallbacks.
const countryCodeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[^A-Za-z]/g, "").toUpperCase();
  // "USA"/"GBR" → "US"/"GB" handles the most common alpha-3 drift; truly
  // ambiguous results land as "" or 1 char and are caught downstream.
  return cleaned.slice(0, 2);
}, z.string().max(2));

const generatedProfileSchema = z.object({
  longBio: z.string().min(120).max(1600),
  knownFor: z.string().min(3).max(500),
  fromCountry: z.string().min(2).max(80),
  fromCountryCode: countryCodeSchema,
  basedIn: z.string().min(2).max(80),
  basedInCountryCode: countryCodeSchema,
  estimatedNetWorth: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? "Not available" : value,
    z.string().min(2).max(80),
  ),
  confidence: z.number().min(0).max(1).optional(),
});

type GeneratedProfile = z.infer<typeof generatedProfileSchema>;

export type ProfileCacheStatus =
  | "HIT"
  | "STALE"
  | "MISSING_HASH"
  | "MISS"
  | "REGENERATED"
  | "SOURCE_UNCHANGED";

export interface ProfileGenerationResult {
  profile: CelebrityProfile;
  cacheStatus: ProfileCacheStatus;
  validationNotes: string[];
}

interface ProfileGenerationOptions {
  forceRefresh?: boolean;
  model?: string;
}

interface ProfileContext {
  webContext: WebSearchContext | null;
  netWorthContext: NetWorthContext | null;
  openAiWebContext: OpenAiWebContext | null;
  sourceHash: string;
  sourceUrls: string[];
  snippetsText: string;
  extractedNetWorth: string | null;
}

interface OpenAiWebContext {
  text: string;
  sources: Array<{ title: string; url: string }>;
}

/** @deprecated Use PROFILE_BIO_TTL_DAYS — uniform TTL for all celebrities. */
export function getProfileCacheTtlDays(_person?: TrendingPerson): number {
  return PROFILE_BIO_TTL_DAYS;
}

export function isCelebrityProfileFresh(profile: CelebrityProfile): boolean {
  const generatedAt = new Date(profile.generatedAt).getTime();
  const ttlMs = PROFILE_BIO_TTL_DAYS * 24 * 60 * 60 * 1000;
  const promptVersion = profile.promptVersion ?? 0;
  return Date.now() - generatedAt < ttlMs && promptVersion >= PROFILE_PROMPT_VERSION;
}

function profileNeedsBackgroundRefresh(profile: CelebrityProfile): boolean {
  if (!isCelebrityProfileFresh(profile)) return true;
  if (!profile.sourceHash) return true;
  if ((profile.promptVersion ?? 0) < PROFILE_PROMPT_VERSION) return true;
  return false;
}

function staleCacheStatus(profile: CelebrityProfile): ProfileCacheStatus {
  if (!profile.sourceHash) return "MISSING_HASH";
  return "STALE";
}

async function acquireProfileLock(personId: string): Promise<boolean> {
  const lockKey = `profile_lock:${personId}`;
  const [lockRow] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, lockKey)).limit(1);
  if (lockRow?.expiresAt && lockRow.expiresAt > new Date()) {
    return false;
  }
  const lockNow = new Date();
  const lockExpires = new Date(lockNow.getTime() + PROFILE_LOCK_TTL_SECONDS * 1000);
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
  return true;
}

async function releaseProfileLock(personId: string): Promise<void> {
  const lockKey = `profile_lock:${personId}`;
  try {
    await db
      .insert(apiCache)
      .values({
        cacheKey: lockKey,
        provider: "system",
        responseData: JSON.stringify({ personId, releasedAt: new Date().toISOString() }),
        fetchedAt: new Date(),
        expiresAt: new Date(0),
      })
      .onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: { expiresAt: new Date(0), fetchedAt: new Date() },
      });
  } catch {
    /* best-effort */
  }
}

async function regenerateCelebrityProfileBlocking(
  person: TrendingPerson,
  options: ProfileGenerationOptions = {},
): Promise<ProfileGenerationResult> {
  const cached = await storage.getCelebrityProfile(person.id);
  const context = await buildProfileContext(person);

  if (cached && !options.forceRefresh) {
    const cachedSourceHash = cached.sourceHash ?? null;
    const cachedPromptVersion = cached.promptVersion ?? 0;
    if (
      cachedSourceHash
      && cachedSourceHash === context.sourceHash
      && cachedPromptVersion >= PROFILE_PROMPT_VERSION
    ) {
      const extended = await storage.updateCelebrityProfile(person.id, {
        generatedAt: new Date(),
      } as Partial<InsertCelebrityProfile>);
      return {
        profile: extended ?? cached,
        cacheStatus: "SOURCE_UNCHANGED",
        validationNotes: ["Source hash unchanged; extended cache without regenerating profile."],
      };
    }
  }

  const { parsed, validationNotes } = await generateValidatedProfile(person, context, options.model);
  const profileData = toProfileData(person, parsed, context, validationNotes);
  const profile = cached
    ? await storage.updateCelebrityProfile(person.id, profileData)
    : await storage.setCelebrityProfile(profileData);

  if (!profile) {
    throw new Error(`Failed to persist generated profile for ${person.name}`);
  }

  return { profile, cacheStatus: "REGENERATED", validationNotes };
}

function scheduleBackgroundProfileRefresh(
  person: TrendingPerson,
  options: ProfileGenerationOptions = {},
): void {
  if (inFlightRegenerations.has(person.id)) return;

  const work = (async () => {
    const acquired = await acquireProfileLock(person.id);
    if (!acquired) {
      console.log(`[Profile] Background refresh skipped (locked) for ${person.name}`);
      return;
    }
    try {
      await regenerateCelebrityProfileBlocking(person, options);
      console.log(`[Profile] Background refresh completed for ${person.name}`);
    } catch (err: any) {
      console.error(`[Profile] Background refresh failed for ${person.name}:`, err?.message ?? err);
    } finally {
      await releaseProfileLock(person.id);
      inFlightRegenerations.delete(person.id);
    }
  })();

  inFlightRegenerations.set(person.id, work);
  void work;
}

export async function getOrGenerateCelebrityProfile(
  person: TrendingPerson,
  options: ProfileGenerationOptions = {},
): Promise<ProfileGenerationResult> {
  if (options.forceRefresh) {
    return regenerateCelebrityProfileBlocking(person, options);
  }

  const cached = await storage.getCelebrityProfile(person.id);

  if (cached) {
    if (!profileNeedsBackgroundRefresh(cached)) {
      return { profile: cached, cacheStatus: "HIT", validationNotes: [] };
    }
    scheduleBackgroundProfileRefresh(person, options);
    return {
      profile: cached,
      cacheStatus: staleCacheStatus(cached),
      validationNotes: [],
    };
  }

  return regenerateCelebrityProfileBlocking(person, options);
}

export async function generateProfilePreview(
  person: TrendingPerson,
  model: string,
): Promise<{ profileData: InsertCelebrityProfile; validationNotes: string[]; sourceUrls: string[]; sourceHash: string }> {
  const context = await buildProfileContext(person);
  const { parsed, validationNotes } = await generateValidatedProfile(person, context, model);
  return {
    profileData: toProfileData(person, parsed, context, validationNotes),
    validationNotes,
    sourceUrls: context.sourceUrls,
    sourceHash: context.sourceHash,
  };
}

async function buildProfileContext(person: TrendingPerson): Promise<ProfileContext> {
  const name = person.name;
  const [webContext, netWorthContext] = await Promise.all([
    fetchWebSearchContext(name).catch(() => null),
    fetchNetWorthContext(name).catch(() => null),
  ]);

  const preliminaryContext = {
    webContext,
    netWorthContext,
    openAiWebContext: null,
    sourceHash: "",
    sourceUrls: [],
    snippetsText: [
      ...(webContext?.headlines ?? []),
      ...(webContext?.snippets ?? []),
      ...(netWorthContext?.sources ?? []).flatMap((s) => [s.title, s.snippet]),
    ].join("\n"),
    extractedNetWorth: extractNetWorthFromContext(netWorthContext),
  } satisfies ProfileContext;

  const openAiWebContext = shouldUseOpenAiWebSearch(person, preliminaryContext)
    ? await fetchOpenAiProfileWebContext(person, preliminaryContext).catch((error) => {
        console.warn(`[Profile] OpenAI web search augmentation failed for ${person.name}:`, error?.message ?? error);
        return null;
      })
    : null;

  const sourceUrls = Array.from(new Set([
    ...(webContext?.sources ?? []).map((s) => s.link).filter(Boolean),
    ...(netWorthContext?.sources ?? []).map((s) => s.link).filter(Boolean),
    ...(openAiWebContext?.sources ?? []).map((s) => s.url).filter(Boolean),
  ])).slice(0, 12);

  const snippetsText = [
    ...(webContext?.headlines ?? []),
    ...(webContext?.snippets ?? []),
    ...(netWorthContext?.sources ?? []).flatMap((s) => [s.title, s.snippet]),
    openAiWebContext?.text ?? "",
  ].join("\n");

  const sourceHash = createHash("sha256")
    .update(JSON.stringify({
      web: webContext?.sources?.map((s) => [s.title, s.link, s.date]) ?? [],
      netWorth: netWorthContext?.sources?.map((s) => [s.title, s.snippet, s.link]) ?? [],
      openAiWeb: openAiWebContext ? [openAiWebContext.text, openAiWebContext.sources] : [],
    }))
    .digest("hex");

  return {
    webContext,
    netWorthContext,
    openAiWebContext,
    sourceHash,
    sourceUrls,
    snippetsText,
    extractedNetWorth: extractNetWorthFromContext(netWorthContext) || extractNetWorthFromOpenAiWeb(openAiWebContext),
  };
}

async function generateValidatedProfile(
  person: TrendingPerson,
  context: ProfileContext,
  model = getAiModel("profileAbout"),
): Promise<{ parsed: GeneratedProfile; validationNotes: string[] }> {
  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });

  let lastNotes: string[] = [];
  let lastParsed: GeneratedProfile | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const tokenLimit = getChatCompletionTokenLimit(model, 1000);
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(person, context, lastNotes) },
      ],
      response_format: { type: "json_object" },
      ...tokenLimit,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from AI");

    // safeParse so structural failures (longBio too short, knownFor missing,
    // etc.) feed back into the retry loop as explicit notes rather than
    // throwing and skipping the whole profile.
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(content);
    } catch (err) {
      lastNotes = ["Previous response was not valid JSON. Return a JSON object with the exact shape requested."];
      continue;
    }
    const parseResult = generatedProfileSchema.safeParse(rawJson);
    if (!parseResult.success) {
      lastNotes = parseResult.error.issues.map((iss) => {
        const path = iss.path.join(".") || "(root)";
        return `Field "${path}" failed: ${iss.message}. Fix this field in your next response.`;
      });
      continue;
    }

    const parsed = parseResult.data;
    lastParsed = parsed;
    const validationNotes = validateGeneratedProfile(person, parsed, context);
    if (validationNotes.length === 0 || attempt === 1) {
      return { parsed: applyValidationFallbacks(person, parsed, context, validationNotes), validationNotes };
    }

    lastNotes = validationNotes;
  }

  // After two attempts, the model still produced something we couldn't fully
  // accept. Prefer salvaging the last parsed result (with fallbacks applied)
  // over failing the whole profile — a profile with a "XX" country code is
  // better than no refresh at all, and applyValidationFallbacks will pick
  // sensible substitutes where possible.
  if (lastParsed) {
    const finalNotes = validateGeneratedProfile(person, lastParsed, context);
    return { parsed: applyValidationFallbacks(person, lastParsed, context, finalNotes), validationNotes: finalNotes };
  }
  throw new Error(`Profile generation failed validation after 2 attempts: ${lastNotes.join("; ")}`);
}

function buildSystemPrompt(): string {
  return `You write natural, encyclopedia-style profile copy for a public-figure trends and entertainment app.

Voice and style:
- Write in third-person, present-tense, neutral biographical prose, like a Wikipedia lead paragraph.
- Use direct factual statements. Phrases like "He is the current president of the United States.", "She is the CEO of...", "He plays for..." are good.
- NEVER reference where the information came from. Do not write "sources say", "according to sources", "recent sources identify", "source material describes", "reports indicate", "news outlets identify", or any similar meta-attribution. The reader must never see your sources mentioned in the text.
- Do not hedge needlessly. If the supplied snippets agree on a current role, state it confidently and directly.
- Aim for a smooth, readable flow. Vary sentence structure, avoid choppy fragments, and avoid over-cautious qualifiers.

Grounding rules:
- Treat the supplied snippets and web-search notes as the authority for current roles, offices, titles, residence, and net worth. They override prior memory when they conflict.
- Do not describe a future-dated appointment as already true unless a snippet says it has already taken effect.
- If snippets indicate someone lost, resigned, was replaced, or is former, reflect that accurately.
- Do not include net worth or wealth figures in longBio. Net worth belongs only in estimatedNetWorth.
- Return only valid JSON.`;
}

function buildUserPrompt(person: TrendingPerson, context: ProfileContext, priorValidationNotes: string[]): string {
  const currentDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const currentYear = new Date().getFullYear();
  const webSources = context.webContext?.sources?.map((s, index) => `${index + 1}. ${s.title}${s.date ? ` (${s.date})` : ""} - ${s.link}`).join("\n") || "No web sources returned.";
  const webSnippets = [
    ...(context.webContext?.headlines ?? []).map((h) => `Headline: ${h}`),
    ...(context.webContext?.snippets ?? []).map((s) => `Snippet: ${s}`),
  ].join("\n") || "No role snippets returned.";
  const netWorthSources = context.netWorthContext?.sources?.map((s, index) => `${index + 1}. ${s.title} - ${s.snippet} - ${s.link}`).join("\n") || "No net-worth sources returned.";
  const openAiWebSection = context.openAiWebContext?.text
    ? `\nOPENAI WEB SEARCH AUGMENTATION:\n${context.openAiWebContext.text}\nSources:\n${context.openAiWebContext.sources.map((s, index) => `${index + 1}. ${s.title} - ${s.url}`).join("\n")}\n`
    : "";
  const validationSection = priorValidationNotes.length
    ? `\nThe previous draft failed validation. Fix these issues:\n${priorValidationNotes.map((n) => `- ${n}`).join("\n")}\n`
    : "";

  return `Generate an About profile for ${person.name}.

Today is ${currentDate}. The current year is ${currentYear}.
Category: ${person.category ?? "Unknown"}
Leaderboard rank: ${person.rank ?? "Unknown"}

ROLE / BIO SOURCES:
${webSources}

ROLE / BIO SNIPPETS:
${webSnippets}

NET WORTH SOURCES:
${netWorthSources}
${context.extractedNetWorth ? `\nExtracted net-worth candidate from sources: ${context.extractedNetWorth}` : ""}
${openAiWebSection}
${validationSection}
Output exactly this JSON shape:
{
  "longBio": "4-6 factual sentences covering current status, career highlights, and achievements; no net worth; target under 900 characters",
  "knownFor": "Comma-separated areas of fame; target under 250 characters",
  "fromCountry": "Country of origin",
  "fromCountryCode": "ISO 3166-1 alpha-2",
  "basedIn": "Current country where they live or primarily work",
  "basedInCountryCode": "ISO 3166-1 alpha-2",
  "estimatedNetWorth": "Approximate ballpark in the form '$X billion', '$X million', or '$X thousand' (e.g. '$2.6 billion', '$250 million', '$500 thousand'). Match the magnitude to the actual figure - never round a sub-million amount up to '$1 million'. If sources show a range, you may write the range (e.g. '$800-$840 billion'). Use the most recent figure you can find in NET WORTH SOURCES or the OPENAI WEB SEARCH AUGMENTATION notes - prefer Forbes/Bloomberg, otherwise any reputable outlet (Reuters, CNBC, Fortune, Business Insider, Investopedia, Celebrity Net Worth, Wikipedia, etc.). Use \"Not available\" only when no source provides any estimate at all.",
  "confidence": 0.0
}`;
}

function shouldUseOpenAiWebSearch(person: TrendingPerson, context: ProfileContext): boolean {
  if (process.env.PROFILE_ABOUT_WEB_SEARCH === "off") return false;
  if (process.env.PROFILE_ABOUT_WEB_SEARCH === "always") return true;
  if ((person.rank ?? Number.MAX_SAFE_INTEGER) <= 20) return true;
  if (person.category && HIGH_RISK_CATEGORY_RE.test(person.category)) return true;
  if (!context.webContext || context.webContext.sources.length < 3) return true;
  if (!context.extractedNetWorth && /business|tech|technology|politic|government/i.test(person.category ?? "")) return true;
  if (ROLE_CHANGE_RE.test(context.snippetsText)) return true;
  return false;
}

async function fetchOpenAiProfileWebContext(person: TrendingPerson, context: ProfileContext): Promise<OpenAiWebContext | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const openai = new OpenAI({ apiKey });
  const model = getAiModel("profileAbout");
  const currentDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const response = await openai.responses.create({
    model,
    tools: [{ type: "web_search" as any }],
    instructions: `You are a research assistant gathering current facts about a public figure for an encyclopedia-style profile. Today is ${currentDate}. Return clean, declarative facts, not commentary about sources. Do not write the final bio.`,
    input: `Find current facts for ${person.name}.

Return concise bullet notes covering:
1. Current role, title, or status, and any recent change.
2. Whether any role is future-dated, with effective date if applicable.
3. Country of residence or where they primarily work.
4. A current net-worth estimate or range from a reputable outlet (Forbes, Bloomberg, Celebrity Net Worth, Reuters, CNBC, Fortune, Business Insider, Investopedia, Wikipedia, etc.). A ballpark is fine.

Existing snippets to cross-check:
${context.snippetsText.slice(0, 4000)}

If sources disagree, briefly note it. Cite source names or URLs in these notes only - they will not appear in the final bio.`,
    max_output_tokens: 700,
  } as any);

  const text = extractResponseText(response).trim();
  if (!text) return null;

  return {
    text,
    sources: extractResponseSources(response),
  };
}

function extractResponseText(response: any): string {
  return (response as any).output_text
    || ((response as any).output || [])
      .filter((item: any) => item.type === "message")
      .flatMap((item: any) => item.content || [])
      .filter((part: any) => part.type === "output_text" || part.type === "text")
      .map((part: any) => part.text)
      .join("\n")
    || "";
}

function extractResponseSources(response: any): Array<{ title: string; url: string }> {
  const annotations = ((response as any).output || [])
    .filter((item: any) => item.type === "message")
    .flatMap((item: any) => item.content || [])
    .flatMap((part: any) => part.annotations || []);

  const sources: Array<{ title: string; url: string }> = annotations
    .map((annotation: any) => annotation.url_citation || annotation)
    .map((citation: any) => ({
      title: citation.title || citation.url || "OpenAI web source",
      url: citation.url,
    }))
    .filter((source: { title: string; url?: string }): source is { title: string; url: string } => !!source.url);

  return Array.from(new Map<string, { title: string; url: string }>(sources.map((source) => [source.url, source])).values()).slice(0, 8);
}

function validateGeneratedProfile(person: TrendingPerson, profile: GeneratedProfile, context: ProfileContext): string[] {
  const notes: string[] = [];
  const bioText = profile.longBio;

  if (MONEY_RE.test(bioText)) {
    notes.push("Bio text includes net-worth or wealth figures; remove financial figures from bios.");
  }

  const futureDate = findFutureMonthYear(bioText);
  if (futureDate && CURRENT_ROLE_RE.test(bioText)) {
    notes.push(`Bio appears to describe future date ${futureDate} as present/current.`);
  }

  const futureSourceDate = findFutureMonthYear(context.snippetsText);
  if (futureSourceDate && /\b(will become|to become|set to become|effective|starting|beginning)\b/i.test(context.snippetsText) && /\b(current|currently|serves as|is the|is CEO|chief executive officer)\b/i.test(bioText)) {
    notes.push(`Sources describe a future role change around ${futureSourceDate}; do not present the role as current before that date.`);
  }

  if (ROLE_CHANGE_RE.test(context.snippetsText) && /\bcurrently serves as\b|\bserves as\b|\bis the\b/i.test(bioText)) {
    notes.push("Source snippets include possible role-change language; ensure current titles are source-backed, not assumed.");
  }

  if (/\bsecretary of war\b/i.test(context.snippetsText) && /\bsecretary of defense\b/i.test(bioText)) {
    notes.push("Sources use the current title Secretary of War; do not revert to the older Secretary of Defense title.");
  }

  const sourceBackedNetWorth = isNetWorthSourceBacked(profile.estimatedNetWorth, context);
  if (!sourceBackedNetWorth && context.extractedNetWorth) {
    notes.push(`Net worth is not directly backed by source snippets; use extracted source value ${context.extractedNetWorth}.`);
  } else if (!sourceBackedNetWorth && !isNotAvailable(profile.estimatedNetWorth)) {
    notes.push("Net worth is not directly backed by a reliable net-worth source; use Not available.");
  }

  if (isUnsupportedBillionDollarNetWorth(person, profile.estimatedNetWorth, context)) {
    notes.push("Billion-dollar net worth is not backed by a strong billionaire source for this person; use Not available.");
  }

  // Soft 2-letter check. The Zod schema coerces "USA"→"US" and "us"→"US", so
  // we only land here when the model returned something genuinely unusable
  // (empty, "?", "X"). Surfacing as a validation note triggers the retry
  // path with explicit feedback; the final fallback in
  // applyValidationFallbacks handles the case where the retry also fails.
  if (profile.fromCountryCode.length !== 2) {
    notes.push(
      `fromCountryCode must be exactly 2 letters (ISO 3166-1 alpha-2). You returned "${profile.fromCountryCode}". Pick a valid two-letter code based on fromCountry "${profile.fromCountry}".`,
    );
  }
  if (profile.basedInCountryCode.length !== 2) {
    notes.push(
      `basedInCountryCode must be exactly 2 letters (ISO 3166-1 alpha-2). You returned "${profile.basedInCountryCode}". Pick a valid two-letter code based on basedIn "${profile.basedIn}".`,
    );
  }

  return notes;
}

function applyValidationFallbacks(person: TrendingPerson, profile: GeneratedProfile, context: ProfileContext, validationNotes: string[]): GeneratedProfile {
  const next = { ...profile };
  if (validationNotes.some((note) => note.includes("Bio text includes net-worth"))) {
    next.longBio = stripMoney(next.longBio);
  }
  if (validationNotes.some((note) => note.includes("Secretary of War"))) {
    next.longBio = applySecretaryOfWarCorrection(next.longBio);
    next.knownFor = applySecretaryOfWarCorrection(next.knownFor);
  }
  if (!isNetWorthSourceBacked(next.estimatedNetWorth, context) && context.extractedNetWorth) {
    next.estimatedNetWorth = context.extractedNetWorth;
  } else if (!isNetWorthSourceBacked(next.estimatedNetWorth, context)) {
    next.estimatedNetWorth = "Not available";
  }
  if (isUnsupportedBillionDollarNetWorth(person, next.estimatedNetWorth, context)) {
    next.estimatedNetWorth = "Not available";
  }
  // Country-code last-resort fallbacks. Preferred order is:
  //   basedInCountryCode → fromCountryCode (e.g. for nomadic figures whose
  //     residence the model couldn't pin down, the country of origin is a
  //     reasonable proxy and is rarely ambiguous)
  //   fromCountryCode → basedInCountryCode (rare but symmetric)
  //   either → "XX" as the documented "unknown" placeholder, so the rest
  //     of the profile saves successfully instead of failing the whole
  //     refresh on one missing field.
  if (next.basedInCountryCode.length !== 2 && next.fromCountryCode.length === 2) {
    next.basedInCountryCode = next.fromCountryCode;
  }
  if (next.fromCountryCode.length !== 2 && next.basedInCountryCode.length === 2) {
    next.fromCountryCode = next.basedInCountryCode;
  }
  if (next.basedInCountryCode.length !== 2) next.basedInCountryCode = "XX";
  if (next.fromCountryCode.length !== 2) next.fromCountryCode = "XX";
  return next;
}

function toProfileData(
  person: TrendingPerson,
  parsed: GeneratedProfile,
  context: ProfileContext,
  validationNotes: string[],
): InsertCelebrityProfile {
  const now = new Date();
  return {
    personId: person.id,
    personName: person.name,
    shortBio: deriveShortBio(parsed.longBio),
    longBio: parsed.longBio,
    knownFor: parsed.knownFor,
    fromCountry: parsed.fromCountry,
    fromCountryCode: parsed.fromCountryCode.toUpperCase(),
    basedIn: parsed.basedIn,
    basedInCountryCode: parsed.basedInCountryCode.toUpperCase(),
    estimatedNetWorth: parsed.estimatedNetWorth,
    generatedAt: now,
    promptVersion: PROFILE_PROMPT_VERSION,
    sourceHash: context.sourceHash,
    sourceUrls: context.sourceUrls,
    confidence: parsed.confidence ?? null,
    asOfDate: now.toISOString().slice(0, 10),
    validationNotes,
    netWorthUpdatedAt: now,
    netWorthVolatility: classifyNetWorthVolatility(person.category),
  } as InsertCelebrityProfile;
}

// Derive a 1-2 sentence short bio from the model's longBio so the legacy
// shortBio DB column stays populated without spending tokens on a separate
// generation pass. The shortBio field is still part of the DB schema (and
// referenced by an orphaned modal component) but is no longer rendered in
// the live UI.
//
// Strategy: if the bio is already short, return it. Otherwise scan backwards
// from ~280 chars for the last sentence terminator and cut there. Scanning
// backwards naturally handles abbreviations like "Donald J." or "U.S." -
// they're internal periods, not the last sentence break in the window, so
// we don't accidentally truncate at them.
function deriveShortBio(longBio: string): string {
  const trimmed = longBio.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 250) return trimmed;

  const window = trimmed.slice(0, 280);
  let lastEnder = -1;
  for (const punct of [". ", "! ", "? "]) {
    const idx = window.lastIndexOf(punct);
    if (idx > lastEnder) lastEnder = idx;
  }

  if (lastEnder >= 60) {
    return trimmed.slice(0, lastEnder + 1).trim();
  }

  return `${trimmed.slice(0, 247).trimEnd()}...`;
}

export function extractNetWorthFromContext(context: NetWorthContext | null): string | null {
  for (const source of context?.sources ?? []) {
    const sourceText = `${source.title} ${source.snippet}`;
    if (!isTrustedNetWorthSource(source.link) || !isLikelyNetWorthSource(sourceText)) continue;
    const match = extractNetWorthMoney(sourceText);
    if (match) return normalizeMoney(match[0]);
  }
  return null;
}

function extractNetWorthFromOpenAiWeb(context: OpenAiWebContext | null): string | null {
  if (!context?.text || !isLikelyNetWorthSource(context.text)) return null;
  const match = extractNetWorthMoney(context.text);
  return match ? normalizeMoney(match[0]) : null;
}

function isNetWorthSourceBacked(value: string, context: ProfileContext): boolean {
  if (isNotAvailable(value)) return true;
  if (!normalizeMoney(value)) return false;

  // Any reputable snippet that already yielded a money figure near net-worth language counts as backing.
  if (context.extractedNetWorth) return true;

  // OpenAI web search augmentation that mentions net worth/wealth/fortune is acceptable backing -
  // its own citation list is captured in sourceUrls.
  if (context.openAiWebContext?.text && isLikelyNetWorthSource(context.openAiWebContext.text)) {
    return true;
  }

  // Otherwise require at least one reputable net-worth source snippet.
  return (context.netWorthContext?.sources ?? []).some((source) => {
    const text = `${source.title} ${source.snippet}`;
    return isTrustedNetWorthSource(source.link) && isLikelyNetWorthSource(text);
  });
}

function isNotAvailable(value: string): boolean {
  return /\b(not available|unknown|unavailable)\b/i.test(value.trim());
}

function isLikelyNetWorthSource(text: string): boolean {
  return NET_WORTH_CONTEXT_RE.test(text);
}

// Reputable financial / news outlets that commonly publish net-worth estimates.
// Broader than the original Forbes/Bloomberg/CelebrityNetWorth list so we surface
// a ballpark figure for almost everyone instead of falling back to "Not available".
const TRUSTED_NET_WORTH_HOSTS = [
  "forbes.com",
  "bloomberg.com",
  "celebritynetworth.com",
  "reuters.com",
  "apnews.com",
  "cnbc.com",
  "wsj.com",
  "ft.com",
  "businessinsider.com",
  "fortune.com",
  "marketwatch.com",
  "investopedia.com",
  "money.com",
  "nytimes.com",
  "axios.com",
  "yahoo.com",
  "moneyweek.com",
  "wikipedia.org",
  "time.com",
  "cnn.com",
  "bbc.com",
  "theguardian.com",
];

function isTrustedNetWorthSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return TRUSTED_NET_WORTH_HOSTS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`));
  } catch {
    return false;
  }
}

function isUnsupportedBillionDollarNetWorth(person: TrendingPerson, value: string, context: ProfileContext): boolean {
  if (!/\bbillion\b/i.test(value)) return false;
  if (isNotAvailable(value)) return false;

  const personName = person.name.toLowerCase();

  // Accept the figure if any reputable Serper snippet mentions both the person and billion/billionaire/richest
  // language. We no longer require the literal dollar string in one snippet - that was dropping almost every
  // real billionaire because Serper's snippet is rarely the exact figure the model converged on.
  const reputableMention = (context.netWorthContext?.sources ?? []).some((source) => {
    const text = `${source.title} ${source.snippet}`.toLowerCase();
    return isTrustedNetWorthSource(source.link)
      && text.includes(personName)
      && /\bbillion(aire)?s?\b|\brichest\b|\breal-time billionaires\b/i.test(text);
  });

  // Or if the OpenAI web-search augmentation itself mentions the person plus billion language.
  const openAiMention = !!context.openAiWebContext?.text
    && /\bbillion(aire)?s?\b/i.test(context.openAiWebContext.text)
    && context.openAiWebContext.text.toLowerCase().includes(personName);

  return !(reputableMention || openAiMention);
}

function extractNetWorthMoney(text: string): RegExpMatchArray | null {
  const moneyMatches = [...text.matchAll(new RegExp(MONEY_RE.source, "gi"))];
  return moneyMatches.find((match) => {
    const start = Math.max(0, (match.index ?? 0) - 100);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 100);
    return NET_WORTH_CONTEXT_RE.test(text.slice(start, end));
  }) ?? null;
}

function normalizeMoney(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\$ /g, "$").trim();
}

function stripMoney(value: string): string {
  return value
    .replace(/\s*\([^)]*\$[^)]*\)/g, "")
    .replace(MONEY_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function applySecretaryOfWarCorrection(value: string): string {
  return value
    .replace(/\bU\.S\. Secretary of Defense\b/g, "U.S. Secretary of War")
    .replace(/\bSecretary of Defense\b/g, "Secretary of War")
    .replace(/\bDefense Department\b/g, "Department of War");
}

function findFutureMonthYear(text: string): string | null {
  const now = new Date();
  const re = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const month = monthIndex[match[1].toLowerCase()];
    const year = Number(match[2]);
    if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth())) {
      return `${match[1]} ${match[2]}`;
    }
  }
  return null;
}
