/**
 * Vote Scout — pure helpers (no DB / OpenAI imports).
 *
 * Kept import-clean so unit tests can run without DATABASE_URL.
 */

export type VoteScoutMode = "evergreen" | "topical";
export type VoteScoutContentType = "matchup" | "sentiment_poll" | "opinion_poll";

export type MatchupIdeaPayload = {
  title: string;
  promptText: string;
  optionAText: string;
  optionBText: string;
  category: string;
  description: string;
};

export type SentimentIdeaPayload = {
  headline: string;
  subjectText: string;
  category: string;
  description: string;
};

export type OpinionIdeaPayload = {
  title: string;
  category: string;
  summary: string;
  options: string[];
};

export type VoteScoutIdeaPayload =
  | MatchupIdeaPayload
  | SentimentIdeaPayload
  | OpinionIdeaPayload;

export type ParsedVoteScoutIdea = {
  contentType: VoteScoutContentType;
  payload: VoteScoutIdeaPayload;
  rationale: string;
  fitScore: number;
  suggestedEndAt: string | null;
  /** Exact tracked-person names for linking (from GPT relatedNames). */
  relatedNames: string[];
  /** Canonical display title used for denylist / dedupe. */
  displayTitle: string;
};

export type CatalogSnapshot = {
  matchupTitles: string[];
  sentimentHeadlines: string[];
  opinionTitles: string[];
  /** Prior scout ideas (any status) — never re-suggest. */
  priorIdeaTitles: string[];
  /** Light category frequency maps for gap targeting. */
  categoryCounts: {
    matchup: Record<string, number>;
    sentiment_poll: Record<string, number>;
    opinion_poll: Record<string, number>;
  };
  /** Short house-style samples for few-shot anchoring. */
  styleSamples: {
    matchups: string[];
    sentiments: string[];
    opinions: string[];
  };
  /** Recent founder keep/dismiss verdicts (notes steer future scans). */
  reviewLearnings: {
    kept: ReviewLearning[];
    dismissed: ReviewLearning[];
  };
  /** Main leaderboard display names for prompt context / linking. */
  leaderboardNames: string[];
  /** Active induction queue display names. */
  inductionNames: string[];
};

/** Map scout contentType → suggestions.type / dispatchApproval type. */
export function contentTypeToSuggestionType(
  contentType: VoteScoutContentType,
): "matchup" | "sentiment_poll" | "opinion_poll" {
  return contentType;
}

/** Human tab label after approve-to-draft. */
export function contentTypeTabLabel(contentType: VoteScoutContentType): string {
  if (contentType === "matchup") return "Matchups";
  if (contentType === "sentiment_poll") return "Sentiment Polls";
  return "Opinion Polls";
}

export type ReviewLearning = {
  status: "kept" | "dismissed";
  title: string;
  contentType: VoteScoutContentType;
  note: string | null;
};

export const MAX_IDEAS_PER_RUN = 5;
/** Quality-over-quantity floor — weak "okay" ideas should not pass. */
export const MIN_FIT_SCORE = 72;
export const MAX_OPINION_OPTIONS = 12;
export const MIN_OPINION_OPTIONS = 4;
/** Full catalog must reach the model; ~300+ titles is still cheap in tokens. */
export const DENY_LIST_LIMIT = 600;

const VS_SPLIT = /\s+vs\.?\s+/i;

/** Lowercase, strip punctuation/extra spaces for equality checks. */
export function normalizeTitleKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matchup titles are order-insensitive: "Dogs vs Cats" ≡ "Cats vs Dogs".
 * Non-matchup titles use plain normalized equality.
 */
export function matchupCanonicalKey(raw: string): string {
  const key = normalizeTitleKey(raw);
  const parts = key.split(VS_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    return [...parts].sort().join(" vs ");
  }
  return key;
}

export function ideaDedupeKey(
  contentType: VoteScoutContentType,
  displayTitle: string,
): string {
  if (contentType === "matchup") {
    return `matchup:${matchupCanonicalKey(displayTitle)}`;
  }
  return `${contentType}:${normalizeTitleKey(displayTitle)}`;
}

export function buildDenyKeySet(catalog: CatalogSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const t of catalog.matchupTitles) {
    keys.add(ideaDedupeKey("matchup", t));
  }
  for (const t of catalog.sentimentHeadlines) {
    keys.add(ideaDedupeKey("sentiment_poll", t));
  }
  for (const t of catalog.opinionTitles) {
    keys.add(ideaDedupeKey("opinion_poll", t));
  }
  for (const t of catalog.priorIdeaTitles) {
    // Prior ideas may be any type; store under all three prefixes so a prior
    // matchup title cannot resurface as a sentiment headline, etc.
    keys.add(ideaDedupeKey("matchup", t));
    keys.add(ideaDedupeKey("sentiment_poll", t));
    keys.add(ideaDedupeKey("opinion_poll", t));
  }
  return keys;
}

function formatCategoryCounts(counts: Record<string, number>): string {
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([cat, n]) => `${cat}: ${n}`);
  return rows.length > 0 ? rows.join(", ") : "(none yet)";
}

function formatDenyList(titles: string[], limit = DENY_LIST_LIMIT): string {
  const unique = Array.from(
    new Set(titles.map((t) => t.trim()).filter(Boolean)),
  ).slice(0, limit);
  if (unique.length === 0) return "(none)";
  return unique.map((t) => `- ${t}`).join("\n");
}

/** Extract display title from a stored scout payload. */
export function titleFromScoutPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Untitled";
  const p = payload as Record<string, unknown>;
  if (typeof p.title === "string" && p.title.trim()) return p.title.trim();
  if (typeof p.headline === "string" && p.headline.trim()) return p.headline.trim();
  return "Untitled";
}

/** Format recent founder keep/dismiss verdicts for the user prompt. */
export function formatReviewLearningsBlock(learnings: {
  kept: ReviewLearning[];
  dismissed: ReviewLearning[];
}): string {
  const keptWithNotes = learnings.kept.filter((l) => l.note);
  const dismissedWithNotes = learnings.dismissed.filter((l) => l.note);
  const keptTitlesOnly = learnings.kept.filter((l) => !l.note).slice(0, 8);
  const dismissedTitlesOnly = learnings.dismissed.filter((l) => !l.note).slice(0, 5);

  if (
    keptWithNotes.length === 0 &&
    dismissedWithNotes.length === 0 &&
    keptTitlesOnly.length === 0 &&
    dismissedTitlesOnly.length === 0
  ) {
    return "(No founder reviews yet — rely on the rubric and style anchors.)";
  }

  const lines: string[] = [
    "Apply these founder verdicts from prior Idea Scout runs. Notes explain taste; titles without notes still signal approval/rejection.",
  ];

  if (keptWithNotes.length > 0 || keptTitlesOnly.length > 0) {
    lines.push("", "FOUNDER APPROVED — more like these:");
    for (const row of keptWithNotes.slice(0, 10)) {
      lines.push(`- [${row.contentType}] "${row.title}" — why kept: ${row.note}`);
    }
    for (const row of keptTitlesOnly) {
      lines.push(`- [${row.contentType}] "${row.title}"`);
    }
  }

  if (dismissedWithNotes.length > 0 || dismissedTitlesOnly.length > 0) {
    lines.push("", "FOUNDER REJECTED — avoid these patterns (do not paraphrase):");
    for (const row of dismissedWithNotes.slice(0, 15)) {
      lines.push(`- [${row.contentType}] "${row.title}" — why rejected: ${row.note}`);
    }
    for (const row of dismissedTitlesOnly) {
      lines.push(`- [${row.contentType}] "${row.title}"`);
    }
  }

  return lines.join("\n");
}

export function buildSystemPrompt(mode: VoteScoutMode): string {
  const modeBlock =
    mode === "topical"
      ? `MODE: TOPICAL (web search enabled).
- Search for debates people are actively arguing about RIGHT NOW on Reddit, X, forums, sports/entertainment discourse, dating etiquette, food culture, etc.
- PRIORITY: look for current online debates involving people on the TRACKED PEOPLE lists (main leaderboard + induction queue) provided in the user message. When you find a genuinely divisive, on-genre debate about one or more of them, include it and put their EXACT names from the list into relatedNames.
- Do NOT flood the batch with reality-TV casting trivia or shallow fandom polls. At most one reality/entertainment-format idea per run, and only if it clears the dinner-party bar.
- Fair game: viral etiquette fights, timely culture wars, sports/music rivalries in the news, tracked-person debates.
- For time-sensitive ideas, set suggestedEndAt to an ISO date when the debate naturally expires (end of a season, tournament, awards cycle). Use null when it will stay relevant for months+.
- Topical ≠ shallow. Skip niche fandom trivia, one-day outrage cycles, and anything that needs a news briefing to understand.
- Do NOT invent "breaking" celebrity drama, resignation speculation, or invasive gossip.`
      : `MODE: EVERGREEN (no web search — world knowledge only).
- Prefer classic, durable debates that still spark strong opinions years from now — serious OR casual.
- You MAY use TRACKED PEOPLE names for evergreen GOAT / rivalry matchups when they fit, and put exact list names in relatedNames.
- Leave suggestedEndAt as null.
- Do not invent fake breaking-news hooks or "right now" framing.`;

  return `You are the Idea Scout for VoxDex's Vote page.
Founders curate Matchups, Sentiment Polls, and Opinion Polls by hand. They want QUALITY over quantity: questions people genuinely argue about — strong opinions, real disagreement, serious or casual.

Use these lenses interchangeably to judge whether a topic "has legs" (they are illustrative, not a narrow whitelist):
- The dinner-party / barbecue test: two people could passionately disagree in person.
- The online-debate test: it's the kind of thing that sparks long comment-section threads, quote-tweet wars, or Reddit/group-chat arguments (e.g. tipping culture, reclining plane seats, AI art, pineapple on pizza).
A great idea usually passes BOTH — a timeless human disagreement that also reliably flares up online. Do not narrow yourself to polite small talk; edgy, opinionated, and culturally divisive is welcome, as long as it stays within the exclusions below.

Your job is ideation only — titles, options, short context. Do NOT generate image prompts. Returning fewer than ${MAX_IDEAS_PER_RUN} ideas — or an empty array — is the correct outcome when nothing clears the bar. Never pad.

${modeBlock}

WHAT "GOOD" LOOKS LIKE (house genre):
- Matchups are usually CONCEPT vs CONCEPT preference fights (Coffee vs Tea, Mountains vs Ocean, Texting vs Calling, Paper Straws vs Plastic Straws) OR evergreen rivalries / GOAT debates people already know (classic sports/music rivalries). Punchy promptText. Balanced description that explains the tradeoff without picking a winner.
- Sentiment polls are assertive claims people can Support / Neutral / Oppose (e.g. "The guy should pay on the first date", "Tipping culture has gone too far", "Superhero fatigue is real"). subjectText = 2-4 sentences of stakes/nuance.
- Opinion polls are multi-option preference / GOAT / "best X" questions with 4-12 distinct, recognizable options (Greatest band, Best decade for music, How do you like your steak).

WHAT TO AVOID (this is how you produce slop — do not):
- News-pegged or this-week celebrity content that is gossip, not a durable debate ("Should X resign?", "Is Y cancelled?").
- Reality-show casting minutiae and "best age range for a dating show" style filler — keep those rare.
- Invasive gossip (pregnancy, divorce, custody, breakups, "sexiest" lists).
- Deaths, tragedies, graphic violence, war-as-entertainment.
- Near-unanimous moral bait where ~95% would pick the same side.
- Insider trivia that needs googling.
- Technically divisive but niche mechanics when a broad audience would shrug (e.g. pizza utensils when food-drink is already deep).
- Meme / one-off humour tweets that only work as a joke (tongue-in-cheek celebrity stunts).
- Paraphrases of deny-list items ("Cats or Dogs" when "Dogs vs Cats" exists; "Pineapple pizza okay?" when "Pineapple on Pizza" exists).
- Filling a quota with weak ideas. Empty is better than filler.
- Ambiguous titles/headlines that can mean two opposite things — write clearly.

CRITICAL CONTEXT — THE CATALOG IS ALREADY DEEP (~300 live items):
- The obvious canon is largely harvested (Dogs vs Cats, Coffee vs Tea, Messi vs Ronaldo, Greatest boxer, etc.).
- Dig for the NEXT TIER: still universal and divisive, but not already on the deny list.
- Prefer thin categories from the coverage summary only when quality is equal — never force a weak idea into a gap.

QUALITY RUBRIC (ALL must pass; fitScore is 0-100 against this rubric):
1. Divisiveness — passes the dinner-party AND/OR online-debate test: real, sustained disagreement among a broad audience, not a one-day outrage cycle or niche etiquette fight. Understandable without looking anything up.
2. Shelf life — still makes sense in ~12 months (unless topical + suggestedEndAt).
3. Instantly votable — clear in one read; titles/headlines must not be ambiguous.
4. Split potential — expected split nearer 60/40 than 95/5.
5. Fresh vs deny list — not a duplicate or thin paraphrase.
6. On-genre — matches VoxDex Vote style above, not a prediction-market / news quiz.

Score honestly. fitScore < ${MIN_FIT_SCORE} must be omitted from the output.

HARD EXCLUSIONS:
- Deaths, tragedies, graphic violence, war atrocities framed as entertainment.
- Invasive celebrity gossip (pregnancy, divorce, custody, breakups, sexiest lists).
- Pure financial microstructure or incomprehensible jargon.
- Exact or near-exact duplicates of the deny list (including reversed matchup sides).

HOUSE STYLE DETAILS:
- Categories: lowercase kebab-case when possible (food-drink, film-tv, lifestyle, sports, dating, music, tech, politics, gaming, travel, health, business, beauty, fashion, creator, crypto, misc).
- Matchup description: 2-4 short sentences on the tradeoff; balanced; no winner.
- Sentiment subjectText: stakes + both sides; not a rant.
- Opinion options: concrete, mutually distinct, recognizable to a general audience.
- relatedNames: ONLY exact names from the TRACKED PEOPLE lists when that person is genuinely central to the idea. [] when none apply. Max 4.

PROCESS:
1. Internally brainstorm ~30 candidates across matchup / sentiment_poll / opinion_poll.
2. Score each on the rubric.
3. Return ONLY survivors with fitScore >= ${MIN_FIT_SCORE}, max ${MAX_IDEAS_PER_RUN} total.
4. Prefer a mix of types when quality allows (e.g. 2 matchups + 2 sentiment + 1 opinion) — but NEVER invent weak ideas to force a mix.
5. Prefer thinner categories when quality is equal.

OUTPUT: strict JSON only, no markdown fences:
{
  "ideas": [
    {
      "contentType": "matchup" | "sentiment_poll" | "opinion_poll",
      "fitScore": 0,
      "rationale": "1 short sentence: why this clears the dinner-party bar AND is not deny-list fluff",
      "relatedNames": [],
      "suggestedEndAt": null,
      "payload": { ... type-specific fields ... }
    }
  ]
}

Payload by contentType:
- matchup: { "title", "promptText", "optionAText", "optionBText", "category", "description" }
- sentiment_poll: { "headline", "subjectText", "category", "description" }
- opinion_poll: { "title", "category", "summary", "options": ["...", "..."] }`;
}

export function buildUserPrompt(catalog: CatalogSnapshot, mode: VoteScoutMode): string {
  const denyTitles = [
    ...catalog.matchupTitles,
    ...catalog.sentimentHeadlines,
    ...catalog.opinionTitles,
    ...catalog.priorIdeaTitles,
  ];

  const catalogSize =
    catalog.matchupTitles.length +
    catalog.sentimentHeadlines.length +
    catalog.opinionTitles.length;

  const leaderboard = (catalog.leaderboardNames || []).slice(0, 120);
  const induction = (catalog.inductionNames || []).slice(0, 80);

  return `Today's date: ${new Date().toISOString().split("T")[0]}
Scan mode: ${mode}
Live catalog size: ${catalogSize} items (+ ${catalog.priorIdeaTitles.length} prior scout ideas on the deny list). Dig for the next tier — do not recycle the obvious canon.

CATEGORY COVERAGE (prefer thinner areas only when quality is equal — never force filler):
- Matchups: ${formatCategoryCounts(catalog.categoryCounts.matchup)}
- Sentiment polls: ${formatCategoryCounts(catalog.categoryCounts.sentiment_poll)}
- Opinion polls: ${formatCategoryCounts(catalog.categoryCounts.opinion_poll)}

TRACKED PEOPLE — MAIN LEADERBOARD (exact names only for relatedNames / person-linked ideas):
${leaderboard.length > 0 ? leaderboard.join(", ") : "(none)"}

TRACKED PEOPLE — INDUCTION QUEUE (exact names only):
${induction.length > 0 ? induction.join(", ") : "(none)"}

STYLE ANCHORS (match this voice and genre — do NOT copy these topics):
Matchups:
${catalog.styleSamples.matchups.map((s) => `- ${s}`).join("\n") || "- (none)"}
Sentiment polls:
${catalog.styleSamples.sentiments.map((s) => `- ${s}`).join("\n") || "- (none)"}
Opinion polls:
${catalog.styleSamples.opinions.map((s) => `- ${s}`).join("\n") || "- (none)"}

FOUNDER REVIEW LEARNINGS (highest-priority taste signal after the deny list):
${formatReviewLearningsBlock(catalog.reviewLearnings)}

DENY LIST (existing content + previously suggested scout ideas — never re-suggest, including reversed matchup sides or thin paraphrases):
${formatDenyList(denyTitles)}

Return up to ${MAX_IDEAS_PER_RUN} fresh ideas that clear fitScore >= ${MIN_FIT_SCORE}. Zero is allowed and preferred over slop. Do not include image prompts.`;
}

function asNonEmptyString(value: unknown, maxLen = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function clampFitScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseSuggestedEndAt(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseMatchupPayload(raw: unknown): MatchupIdeaPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const title = asNonEmptyString(p.title, 160);
  const promptText = asNonEmptyString(p.promptText, 200);
  const optionAText = asNonEmptyString(p.optionAText, 80);
  const optionBText = asNonEmptyString(p.optionBText, 80);
  const category = asNonEmptyString(p.category, 40);
  const description = asNonEmptyString(p.description, 1200) ?? "";
  if (!title || !promptText || !optionAText || !optionBText || !category) return null;
  if (normalizeTitleKey(optionAText) === normalizeTitleKey(optionBText)) return null;

  return {
    title,
    promptText,
    optionAText,
    optionBText,
    category,
    description,
  };
}

function parseSentimentPayload(raw: unknown): SentimentIdeaPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const headline = asNonEmptyString(p.headline, 160);
  const subjectText = asNonEmptyString(p.subjectText, 800);
  const category = asNonEmptyString(p.category, 40);
  const description = asNonEmptyString(p.description, 1200) ?? "";
  if (!headline || !subjectText || !category) return null;
  return { headline, subjectText, category, description };
}

function parseOpinionPayload(raw: unknown): OpinionIdeaPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const title = asNonEmptyString(p.title, 160);
  const category = asNonEmptyString(p.category, 40);
  const summary = asNonEmptyString(p.summary, 800) ?? "";
  if (!title || !category || !Array.isArray(p.options)) return null;
  const options = p.options
    .map((o) => asNonEmptyString(o, 80))
    .filter((o): o is string => !!o);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const opt of options) {
    const key = normalizeTitleKey(opt);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(opt);
  }
  if (unique.length < MIN_OPINION_OPTIONS) return null;
  return {
    title,
    category,
    summary,
    options: unique.slice(0, MAX_OPINION_OPTIONS),
  };
}

function displayTitleFor(
  contentType: VoteScoutContentType,
  payload: VoteScoutIdeaPayload,
): string {
  if (contentType === "matchup") return (payload as MatchupIdeaPayload).title;
  if (contentType === "sentiment_poll") return (payload as SentimentIdeaPayload).headline;
  return (payload as OpinionIdeaPayload).title;
}

function parseRelatedNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = asNonEmptyString(item, 80);
    if (!name) continue;
    const key = normalizeTitleKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Parse and validate GPT JSON. Malformed / low-fit / incomplete ideas are dropped.
 * Does not apply catalog dedupe — caller does that with deny keys.
 */
export function parseVoteScoutResponse(rawText: string): ParsedVoteScoutIdea[] {
  let jsonText = rawText.trim();
  if (!jsonText) return [];
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const ideasRaw =
    parsed && typeof parsed === "object" && Array.isArray((parsed as any).ideas)
      ? (parsed as any).ideas
      : Array.isArray(parsed)
        ? parsed
        : null;
  if (!ideasRaw) return [];

  const out: ParsedVoteScoutIdea[] = [];
  for (const item of ideasRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const contentType = row.contentType;
    if (
      contentType !== "matchup" &&
      contentType !== "sentiment_poll" &&
      contentType !== "opinion_poll"
    ) {
      continue;
    }

    const fitScore = clampFitScore(row.fitScore);
    if (fitScore === null || fitScore < MIN_FIT_SCORE) continue;

    const rationale = asNonEmptyString(row.rationale, 400) ?? "";

    let payload: VoteScoutIdeaPayload | null = null;
    if (contentType === "matchup") payload = parseMatchupPayload(row.payload);
    else if (contentType === "sentiment_poll") payload = parseSentimentPayload(row.payload);
    else payload = parseOpinionPayload(row.payload);
    if (!payload) continue;

    const displayTitle = displayTitleFor(contentType, payload);
    out.push({
      contentType,
      payload,
      rationale,
      fitScore,
      suggestedEndAt: parseSuggestedEndAt(row.suggestedEndAt),
      relatedNames: parseRelatedNames(row.relatedNames),
      displayTitle,
    });
  }

  // Prefer higher fit; stable cap.
  out.sort((a, b) => b.fitScore - a.fitScore);
  return out.slice(0, MAX_IDEAS_PER_RUN * 2);
}

/**
 * Drop ideas that collide with the deny set or with each other in this batch.
 */
export function filterAgainstDenyList(
  ideas: ParsedVoteScoutIdea[],
  denyKeys: Set<string>,
): { kept: ParsedVoteScoutIdea[]; skippedDuplicates: number } {
  const kept: ParsedVoteScoutIdea[] = [];
  let skippedDuplicates = 0;
  const batchKeys = new Set<string>();

  for (const idea of ideas) {
    const key = ideaDedupeKey(idea.contentType, idea.displayTitle);
    if (denyKeys.has(key) || batchKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    batchKeys.add(key);
    kept.push(idea);
    if (kept.length >= MAX_IDEAS_PER_RUN) break;
  }

  return { kept, skippedDuplicates };
}
