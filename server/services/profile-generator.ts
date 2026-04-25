import OpenAI from "openai";
import { createHash } from "crypto";
import { z } from "zod";
import { type CelebrityProfile, type InsertCelebrityProfile, type TrendingPerson } from "@shared/schema";
import { storage } from "../storage";
import { fetchNetWorthContext, fetchWebSearchContext, type NetWorthContext, type WebSearchContext } from "../providers/serper";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";

export const PROFILE_PROMPT_VERSION = 2;

const HIGH_RISK_CATEGORY_RE = /politic|business|tech|technology|finance|world leader|government/i;
const ROLE_CHANGE_RE = /\b(defeated|lost election|no longer|former|replaced by|succeeded by|ousted|resigned|stepped down|appointed|elected|inaugurated|became|named|will become|set to become)\b/i;
const CURRENT_ROLE_RE = /\b(currently|serves as|is the|is an|is a|became|current)\b/i;
const MONEY_RE = /\$[\d,.]+(?:\s*(?:-|to)\s*\$?[\d,.]+)?\s*(?:billion|million|trillion)\b/i;
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

const generatedProfileSchema = z.object({
  shortBio: z.string().min(40).max(700),
  longBio: z.string().min(120).max(1600),
  knownFor: z.string().min(3).max(500),
  fromCountry: z.string().min(2).max(80),
  fromCountryCode: z.string().length(2),
  basedIn: z.string().min(2).max(80),
  basedInCountryCode: z.string().length(2),
  estimatedNetWorth: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? "Not available" : value,
    z.string().min(2).max(80),
  ),
  confidence: z.number().min(0).max(1).optional(),
});

type GeneratedProfile = z.infer<typeof generatedProfileSchema>;

export interface ProfileGenerationResult {
  profile: CelebrityProfile;
  cacheStatus: "HIT" | "REGENERATED" | "SOURCE_UNCHANGED";
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

export function getProfileCacheTtlDays(person: TrendingPerson): number {
  if ((person.rank ?? Number.MAX_SAFE_INTEGER) <= 20) return 1;
  if (person.category && HIGH_RISK_CATEGORY_RE.test(person.category)) return 1;
  return 7;
}

export function isCelebrityProfileFresh(profile: CelebrityProfile, person: TrendingPerson): boolean {
  const generatedAt = new Date(profile.generatedAt).getTime();
  const ttlMs = getProfileCacheTtlDays(person) * 24 * 60 * 60 * 1000;
  const promptVersion = (profile as any).promptVersion ?? 0;
  return Date.now() - generatedAt < ttlMs && promptVersion >= PROFILE_PROMPT_VERSION;
}

export async function getOrGenerateCelebrityProfile(
  person: TrendingPerson,
  options: ProfileGenerationOptions = {},
): Promise<ProfileGenerationResult> {
  const cached = await storage.getCelebrityProfile(person.id);
  if (cached && !options.forceRefresh && isCelebrityProfileFresh(cached, person)) {
    return { profile: cached, cacheStatus: "HIT", validationNotes: [] };
  }

  const context = await buildProfileContext(person);

  if (cached && !options.forceRefresh) {
    const cachedSourceHash = (cached as any).sourceHash ?? null;
    const cachedPromptVersion = (cached as any).promptVersion ?? 0;
    if (cachedSourceHash && cachedSourceHash === context.sourceHash && cachedPromptVersion >= PROFILE_PROMPT_VERSION) {
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

    const parsed = generatedProfileSchema.parse(JSON.parse(content));
    const validationNotes = validateGeneratedProfile(person, parsed, context);
    if (validationNotes.length === 0 || attempt === 1) {
      return { parsed: applyValidationFallbacks(person, parsed, context, validationNotes), validationNotes };
    }

    lastNotes = validationNotes;
  }

  throw new Error("Profile generation failed validation");
}

function buildSystemPrompt(): string {
  return `You generate source-grounded public-figure profile data for a consumer app.

Rules:
- Use the supplied source snippets as the authority for current roles, offices, CEO titles, and net worth.
- Do not rely on memory when sources conflict with memory.
- Do not describe a future-dated appointment or role as already true unless a source says it has already happened.
- If sources say a person lost, resigned, was replaced, or is former, reflect that accurately.
- Do not include net worth or wealth figures in bios. Net worth belongs only in estimatedNetWorth.
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
  "shortBio": "2-3 concise sentences focused on current status; no net worth; target under 350 characters",
  "longBio": "4-6 factual sentences covering current status, career highlights, and achievements; no net worth; target under 900 characters",
  "knownFor": "Comma-separated areas of fame; target under 250 characters",
  "fromCountry": "Country of origin",
  "fromCountryCode": "ISO 3166-1 alpha-2",
  "basedIn": "Current country where they live or primarily work",
  "basedInCountryCode": "ISO 3166-1 alpha-2",
  "estimatedNetWorth": "Use a value directly supported by NET WORTH SOURCES. If no reliable net-worth source appears, use \"Not available\". If sources provide a range, preserve the range.",
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
    instructions: `You are gathering source notes for a public-figure profile. Today is ${currentDate}. Be factual and source-oriented. Do not write the final profile.`,
    input: `Find current, source-backed facts for ${person.name}.

Return concise notes covering:
1. Current role/status and any recent role changes.
2. Whether any role is future-dated, with effective date if applicable.
3. Current residence/work country if a reliable source is available.
4. Net worth only if a reliable source such as Forbes, Bloomberg, or Celebrity Net Worth supports it.

Existing source snippets to check against:
${context.snippetsText.slice(0, 4000)}

If sources conflict, say so. Include source names or URLs in the notes.`,
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
  const bioText = `${profile.shortBio}\n${profile.longBio}`;

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

  return notes;
}

function applyValidationFallbacks(person: TrendingPerson, profile: GeneratedProfile, context: ProfileContext, validationNotes: string[]): GeneratedProfile {
  const next = { ...profile };
  if (validationNotes.some((note) => note.includes("Bio text includes net-worth"))) {
    next.shortBio = stripMoney(next.shortBio);
    next.longBio = stripMoney(next.longBio);
  }
  if (validationNotes.some((note) => note.includes("Secretary of War"))) {
    next.shortBio = applySecretaryOfWarCorrection(next.shortBio);
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
  return next;
}

function toProfileData(
  person: TrendingPerson,
  parsed: GeneratedProfile,
  context: ProfileContext,
  validationNotes: string[],
): InsertCelebrityProfile {
  return {
    personId: person.id,
    personName: person.name,
    shortBio: parsed.shortBio,
    longBio: parsed.longBio,
    knownFor: parsed.knownFor,
    fromCountry: parsed.fromCountry,
    fromCountryCode: parsed.fromCountryCode.toUpperCase(),
    basedIn: parsed.basedIn,
    basedInCountryCode: parsed.basedInCountryCode.toUpperCase(),
    estimatedNetWorth: parsed.estimatedNetWorth,
    generatedAt: new Date(),
    promptVersion: PROFILE_PROMPT_VERSION,
    sourceHash: context.sourceHash,
    sourceUrls: context.sourceUrls,
    confidence: parsed.confidence ?? null,
    asOfDate: new Date().toISOString().slice(0, 10),
    validationNotes,
  } as InsertCelebrityProfile;
}

function extractNetWorthFromContext(context: NetWorthContext | null): string | null {
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
  const normalizedValue = normalizeMoney(value);
  if (!normalizedValue) return false;
  if (context.extractedNetWorth && normalizeMoney(context.extractedNetWorth) === normalizedValue) return true;
  if (context.openAiWebContext?.text && isLikelyNetWorthSource(context.openAiWebContext.text) && context.openAiWebContext.text.toLowerCase().includes(normalizedValue.toLowerCase())) {
    return true;
  }
  const compactValue = normalizedValue.replace(/\s+/g, " ").toLowerCase();
  return (context.netWorthContext?.sources ?? []).some((source) => {
    const text = `${source.title} ${source.snippet}`.replace(/\s+/g, " ").toLowerCase();
    return isTrustedNetWorthSource(source.link) && isLikelyNetWorthSource(text) && text.includes(compactValue);
  });
}

function isNotAvailable(value: string): boolean {
  return /\b(not available|unknown|unavailable)\b/i.test(value.trim());
}

function isLikelyNetWorthSource(text: string): boolean {
  return NET_WORTH_CONTEXT_RE.test(text);
}

function isTrustedNetWorthSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "forbes.com" || host.endsWith(".forbes.com")
      || host === "bloomberg.com" || host.endsWith(".bloomberg.com")
      || host === "celebritynetworth.com" || host.endsWith(".celebritynetworth.com");
  } catch {
    return false;
  }
}

function isUnsupportedBillionDollarNetWorth(person: TrendingPerson, value: string, context: ProfileContext): boolean {
  if (!/\bbillion\b/i.test(value)) return false;
  if (isNotAvailable(value)) return false;

  const personName = person.name.toLowerCase();
  return !(context.netWorthContext?.sources ?? []).some((source) => {
    const text = `${source.title} ${source.snippet}`.toLowerCase();
    return isTrustedNetWorthSource(source.link)
      && text.includes(personName)
      && /\bbillionaire|billionaires|real-time billionaires|richest\b/i.test(text)
      && text.includes(normalizeMoney(value).toLowerCase());
  });
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
