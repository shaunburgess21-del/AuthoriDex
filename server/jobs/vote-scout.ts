/**
 * Vote Scout — admin Idea Scout orchestrator.
 *
 * Manual-only (no scheduler). Generates draft Matchup / Sentiment / Opinion
 * ideas for founder review. Never writes to real content tables.
 */

import OpenAI from "openai";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  matchups,
  opinionPolls,
  trendingPolls,
  voteScoutIdeas,
} from "@shared/schema";
import { getAiModel } from "../config/ai-models";
import { log } from "../log";
import {
  type CatalogSnapshot,
  type ParsedVoteScoutIdea,
  type VoteScoutMode,
  type VoteScoutContentType,
  buildDenyKeySet,
  buildSystemPrompt,
  buildUserPrompt,
  contentTypeTabLabel,
  contentTypeToSuggestionType,
  filterAgainstDenyList,
  isVoteScoutMode,
  ensureBreakingEndAt,
  parseVoteScoutResponse,
  titleFromScoutPayload,
  type ReviewLearning,
} from "./vote-scout-core";
import {
  loadVoteScoutPeople,
  resolvePersonIdByName,
  resolveRelatedPersonIds,
} from "./vote-scout-people";
import {
  APPROVED_AS_TYPE,
  dispatchApproval,
} from "../services/suggestionApproval";
import type { Suggestion } from "@shared/schema";

const API_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 5_000;
const STYLE_SAMPLE_LIMIT = 10;

let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    });
  }
  return _openaiClient;
}

let runLock = false;

function bumpCategory(
  map: Record<string, number>,
  category: string | null | undefined,
) {
  const key = (category || "misc").trim().toLowerCase() || "misc";
  map[key] = (map[key] || 0) + 1;
}

function sampleTitles(titles: string[], limit: number): string[] {
  if (titles.length <= limit) return [...titles];
  // Prefer a spread across the list (recent + older) without randomness for tests.
  const step = Math.max(1, Math.floor(titles.length / limit));
  const out: string[] = [];
  for (let i = 0; i < titles.length && out.length < limit; i += step) {
    out.push(titles[i]);
  }
  return out;
}

/** Prefer style diversity across categories, not only the newest rows. */
function sampleStyleByCategory(
  rows: Array<{ category: string | null; line: string }>,
  limit: number,
): string[] {
  if (rows.length === 0) return [];
  const byCat = new Map<string, string[]>();
  for (const row of rows) {
    const cat = (row.category || "misc").toLowerCase();
    const list = byCat.get(cat) ?? [];
    if (list.length < 3) list.push(row.line);
    byCat.set(cat, list);
  }

  const out: string[] = [];
  const queues = Array.from(byCat.values());
  let idx = 0;
  while (out.length < limit && queues.some((q) => q.length > 0)) {
    const q = queues[idx % queues.length];
    if (q.length > 0) out.push(q.shift()!);
    idx += 1;
  }
  if (out.length < limit) {
    for (const line of sampleTitles(
      rows.map((r) => r.line).filter((l) => !out.includes(l)),
      limit - out.length,
    )) {
      out.push(line);
    }
  }
  return out.slice(0, limit);
}

export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  const [matchupRows, sentimentRows, opinionRows, priorRows, reviewedRows, people] =
    await Promise.all([
    db
      .select({
        title: matchups.title,
        category: matchups.category,
        promptText: matchups.promptText,
        optionAText: matchups.optionAText,
        optionBText: matchups.optionBText,
      })
      .from(matchups)
      .orderBy(desc(matchups.createdAt)),
    db
      .select({
        headline: trendingPolls.headline,
        category: trendingPolls.category,
        subjectText: trendingPolls.subjectText,
      })
      .from(trendingPolls)
      .orderBy(desc(trendingPolls.createdAt)),
    db
      .select({
        title: opinionPolls.title,
        category: opinionPolls.category,
        summary: opinionPolls.summary,
      })
      .from(opinionPolls)
      .orderBy(desc(opinionPolls.createdAt)),
    db
      .select({
        contentType: voteScoutIdeas.contentType,
        payload: voteScoutIdeas.payload,
      })
      .from(voteScoutIdeas),
    db
      .select({
        status: voteScoutIdeas.status,
        contentType: voteScoutIdeas.contentType,
        payload: voteScoutIdeas.payload,
        reviewNote: voteScoutIdeas.reviewNote,
      })
      .from(voteScoutIdeas)
      .where(inArray(voteScoutIdeas.status, ["kept", "dismissed"]))
      .orderBy(desc(voteScoutIdeas.reviewedAt))
      .limit(50),
    loadVoteScoutPeople(),
  ]);

  const categoryCounts = {
    matchup: {} as Record<string, number>,
    sentiment_poll: {} as Record<string, number>,
    opinion_poll: {} as Record<string, number>,
  };

  const matchupTitles: string[] = [];
  const matchupStyleRows: Array<{ category: string | null; line: string }> = [];
  for (const row of matchupRows) {
    matchupTitles.push(row.title);
    bumpCategory(categoryCounts.matchup, row.category);
    matchupStyleRows.push({
      category: row.category,
      line: `${row.title} | prompt: ${row.promptText || ""} | ${row.optionAText} vs ${row.optionBText}`,
    });
  }

  const sentimentHeadlines: string[] = [];
  const sentimentStyleRows: Array<{ category: string | null; line: string }> = [];
  for (const row of sentimentRows) {
    sentimentHeadlines.push(row.headline);
    bumpCategory(categoryCounts.sentiment_poll, row.category);
    sentimentStyleRows.push({
      category: row.category,
      line: `${row.headline} | ${(row.subjectText || "").slice(0, 140)}`,
    });
  }

  const opinionTitles: string[] = [];
  const opinionStyleRows: Array<{ category: string | null; line: string }> = [];
  for (const row of opinionRows) {
    opinionTitles.push(row.title);
    bumpCategory(categoryCounts.opinion_poll, row.category);
    opinionStyleRows.push({
      category: row.category,
      line: `${row.title} | ${(row.summary || "").slice(0, 140)}`,
    });
  }

  const priorIdeaTitles: string[] = [];
  for (const row of priorRows) {
    const title = titleFromScoutPayload(row.payload);
    if (title !== "Untitled") priorIdeaTitles.push(title);
  }

  const reviewLearnings: { kept: ReviewLearning[]; dismissed: ReviewLearning[] } = {
    kept: [],
    dismissed: [],
  };
  for (const row of reviewedRows) {
    const title = titleFromScoutPayload(row.payload);
    const note =
      typeof row.reviewNote === "string" && row.reviewNote.trim()
        ? row.reviewNote.trim().slice(0, 500)
        : null;
    const entry: ReviewLearning = {
      status: row.status === "kept" ? "kept" : "dismissed",
      title,
      contentType: row.contentType as ReviewLearning["contentType"],
      note,
    };
    if (row.status === "kept") reviewLearnings.kept.push(entry);
    else if (row.status === "dismissed") reviewLearnings.dismissed.push(entry);
  }

  return {
    matchupTitles,
    sentimentHeadlines,
    opinionTitles,
    priorIdeaTitles,
    categoryCounts,
    styleSamples: {
      matchups: sampleStyleByCategory(matchupStyleRows, STYLE_SAMPLE_LIMIT),
      sentiments: sampleStyleByCategory(sentimentStyleRows, STYLE_SAMPLE_LIMIT),
      opinions: sampleStyleByCategory(opinionStyleRows, STYLE_SAMPLE_LIMIT),
    },
    reviewLearnings,
    leaderboardNames: people.leaderboardNames,
    inductionNames: people.inductionNames,
  };
}

function extractOutputText(response: unknown): string | null {
  const r = response as any;
  if (typeof r?.output_text === "string" && r.output_text.trim()) {
    return r.output_text;
  }
  const output = Array.isArray(r?.output) ? r.output : [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      if ((part.type === "output_text" || part.type === "text") && part.text) {
        return part.text;
      }
    }
  }
  return null;
}

async function callVoteScoutLlm(
  mode: VoteScoutMode,
  catalog: CatalogSnapshot,
): Promise<ParsedVoteScoutIdea[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model: getAiModel("voteScout"),
      max_output_tokens: MAX_OUTPUT_TOKENS,
      instructions: buildSystemPrompt(mode),
      input: buildUserPrompt(catalog, mode),
      // Evergreen: slightly cooler for disciplined next-tier picks.
      // Topical/Breaking: a bit warmer once web search has grounded the topic.
      temperature: mode === "evergreen" ? 0.7 : 0.8,
    };
    if (mode === "topical" || mode === "breaking") {
      body.tools = [{ type: "web_search" as const }];
    }

    const response = await getOpenAIClient().responses.create(
      body as any,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const outputText = extractOutputText(response);
    if (!outputText) {
      log("[VoteScout] Empty model response");
      return [];
    }
    return parseVoteScoutResponse(outputText);
  } catch (err) {
    clearTimeout(timeout);
    log(
      `[VoteScout] LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export type VoteScoutRunResult = {
  mode: VoteScoutMode;
  created: number;
  skippedDuplicates: number;
  parsed: number;
  locked: boolean;
};

export async function runVoteScout(mode: VoteScoutMode): Promise<VoteScoutRunResult> {
  if (!isVoteScoutMode(mode)) {
    throw new Error("Invalid vote scout mode");
  }

  if (runLock) {
    return { mode, created: 0, skippedDuplicates: 0, parsed: 0, locked: true };
  }

  runLock = true;
  try {
    const catalog = await loadCatalogSnapshot();
    const denyKeys = buildDenyKeySet(catalog);
    const parsedRaw = await callVoteScoutLlm(mode, catalog);
    const parsed =
      mode === "breaking" ? ensureBreakingEndAt(parsedRaw) : parsedRaw;
    const { kept, skippedDuplicates } = filterAgainstDenyList(parsed, denyKeys);

    if (kept.length === 0) {
      log(
        `[VoteScout] mode=${mode} parsed=${parsed.length} created=0 skippedDuplicates=${skippedDuplicates}`,
      );
      return {
        mode,
        created: 0,
        skippedDuplicates,
        parsed: parsed.length,
        locked: false,
      };
    }

    await db.insert(voteScoutIdeas).values(
      kept.map((idea) => ({
        contentType: idea.contentType,
        mode,
        payload: {
          ...idea.payload,
          relatedNames: idea.relatedNames,
        },
        imagePrompt: null,
        rationale: idea.rationale,
        fitScore: idea.fitScore,
        suggestedEndAt: idea.suggestedEndAt ? new Date(idea.suggestedEndAt) : null,
        status: "new",
      })),
    );

    log(
      `[VoteScout] mode=${mode} parsed=${parsed.length} created=${kept.length} skippedDuplicates=${skippedDuplicates}`,
    );

    return {
      mode,
      created: kept.length,
      skippedDuplicates,
      parsed: parsed.length,
      locked: false,
    };
  } finally {
    runLock = false;
  }
}

export async function listVoteScoutIdeas(status?: string) {
  const allowed = new Set(["new", "kept", "dismissed", "approved"]);
  const filterStatus = status && allowed.has(status) ? status : null;

  const [ideas, counts] = await Promise.all([
    filterStatus
      ? db
          .select()
          .from(voteScoutIdeas)
          .where(eq(voteScoutIdeas.status, filterStatus))
          .orderBy(desc(voteScoutIdeas.createdAt))
          .limit(100)
      : db
          .select()
          .from(voteScoutIdeas)
          .orderBy(desc(voteScoutIdeas.createdAt))
          .limit(100),
    db
      .select({
        status: voteScoutIdeas.status,
        count: sql<number>`count(*)::int`,
      })
      .from(voteScoutIdeas)
      .groupBy(voteScoutIdeas.status),
  ]);

  const statusCounts = { new: 0, kept: 0, dismissed: 0, approved: 0 };
  for (const row of counts) {
    if (
      row.status === "new" ||
      row.status === "kept" ||
      row.status === "dismissed" ||
      row.status === "approved"
    ) {
      statusCounts[row.status] = Number(row.count) || 0;
    }
  }

  const reviewed = statusCounts.kept + statusCounts.dismissed;
  const hitRate =
    reviewed > 0 ? Math.round((statusCounts.kept / reviewed) * 100) : null;

  return {
    ideas: ideas.map((row) => ({
      ...row,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      reviewedAt:
        row.reviewedAt instanceof Date
          ? row.reviewedAt.toISOString()
          : row.reviewedAt,
      suggestedEndAt:
        row.suggestedEndAt instanceof Date
          ? row.suggestedEndAt.toISOString()
          : row.suggestedEndAt,
    })),
    statusCounts,
    hitRate,
  };
}

export async function setVoteScoutIdeaStatus(opts: {
  id: string;
  status: "kept" | "dismissed";
  adminId: string;
  reviewNote?: string | null;
}) {
  const trimmedNote =
    typeof opts.reviewNote === "string" && opts.reviewNote.trim()
      ? opts.reviewNote.trim().slice(0, 500)
      : null;

  const [updated] = await db
    .update(voteScoutIdeas)
    .set({
      status: opts.status,
      reviewedBy: opts.adminId,
      reviewedAt: new Date(),
      reviewNote: trimmedNote,
    })
    .where(eq(voteScoutIdeas.id, opts.id))
    .returning();

  return updated ?? null;
}

function relatedNamesFromPayload(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.relatedNames)) return [];
  return payload.relatedNames.filter(
    (n): n is string => typeof n === "string" && n.trim().length > 0,
  );
}

/**
 * Preview person links that would be applied on approve (for the confirm dialog).
 */
export async function previewVoteScoutPersonLinks(ideaId: string) {
  const [idea] = await db
    .select()
    .from(voteScoutIdeas)
    .where(eq(voteScoutIdeas.id, ideaId))
    .limit(1);
  if (!idea) return null;

  const people = await loadVoteScoutPeople();
  const payload = (idea.payload || {}) as Record<string, unknown>;
  const related = resolveRelatedPersonIds(
    relatedNamesFromPayload(payload),
    people.byName,
  );

  const contentType = idea.contentType as VoteScoutContentType;
  const links: Array<{ role: string; name: string; id: string }> = [];

  if (contentType === "matchup") {
    const optionA = String(payload.optionAText || "");
    const optionB = String(payload.optionBText || "");
    const aId = resolvePersonIdByName(optionA, people.byName);
    const bId = resolvePersonIdByName(optionB, people.byName);
    if (aId) links.push({ role: "Option A", name: optionA, id: aId });
    if (bId) links.push({ role: "Option B", name: optionB, id: bId });
  } else if (contentType === "sentiment_poll") {
    for (const r of related.slice(0, 1)) {
      links.push({ role: "Subject", name: r.name, id: r.id });
    }
  } else if (contentType === "opinion_poll") {
    const options = Array.isArray(payload.options) ? payload.options : [];
    for (const opt of options) {
      const name = typeof opt === "string" ? opt : String((opt as any)?.name || "");
      const id = resolvePersonIdByName(name, people.byName);
      if (id) links.push({ role: "Option", name, id });
    }
  }

  // Related names that weren't already captured as option sides.
  for (const r of related) {
    if (links.some((l) => l.id === r.id)) continue;
    links.push({ role: "Related", name: r.name, id: r.id });
  }

  return {
    idea,
    links,
    tabLabel: contentTypeTabLabel(contentType),
  };
}

export type ApproveVoteScoutResult = {
  approvedAsId: string;
  approvedAsType: string;
  contentType: VoteScoutContentType;
  tabLabel: string;
};

/**
 * Approve a scout idea → create a DRAFT matchup/poll via dispatchApproval.
 */
export async function approveVoteScoutIdea(opts: {
  id: string;
  adminId: string;
  overrides?: Record<string, unknown>;
}): Promise<ApproveVoteScoutResult> {
  const [idea] = await db
    .select()
    .from(voteScoutIdeas)
    .where(eq(voteScoutIdeas.id, opts.id))
    .limit(1);

  if (!idea) {
    throw new Error("Idea not found");
  }
  if (idea.status === "approved" && idea.approvedAsId) {
    return {
      approvedAsId: idea.approvedAsId,
      approvedAsType: idea.approvedAsType || "",
      contentType: idea.contentType as VoteScoutContentType,
      tabLabel: contentTypeTabLabel(idea.contentType as VoteScoutContentType),
    };
  }
  if (idea.status === "dismissed") {
    throw new Error("Cannot approve a dismissed idea");
  }

  const contentType = idea.contentType as VoteScoutContentType;
  if (
    contentType !== "matchup" &&
    contentType !== "sentiment_poll" &&
    contentType !== "opinion_poll"
  ) {
    throw new Error("Unsupported content type");
  }

  const people = await loadVoteScoutPeople();
  const rawPayload = (idea.payload || {}) as Record<string, unknown>;
  const relatedNames = relatedNamesFromPayload(rawPayload);

  let userPayload: Record<string, unknown> = { ...rawPayload };
  delete userPayload.relatedNames;
  delete userPayload.optionAImagePrompt;
  delete userPayload.optionBImagePrompt;

  if (contentType === "matchup") {
    const optionAText = String(rawPayload.optionAText || "");
    const optionBText = String(rawPayload.optionBText || "");
    userPayload = {
      ...userPayload,
      title: String(rawPayload.title || ""),
      category: String(rawPayload.category || "misc"),
      optionAText,
      optionBText,
      promptText: rawPayload.promptText ?? null,
      description: rawPayload.description ?? null,
      personAId: resolvePersonIdByName(optionAText, people.byName),
      personBId: resolvePersonIdByName(optionBText, people.byName),
      optionAImage: null,
      optionBImage: null,
    };
  } else if (contentType === "sentiment_poll") {
    const related = resolveRelatedPersonIds(relatedNames, people.byName);
    userPayload = {
      ...userPayload,
      headline: String(rawPayload.headline || ""),
      subjectText: String(rawPayload.subjectText || ""),
      category: String(rawPayload.category || "misc"),
      description: rawPayload.description ?? null,
      personId: related[0]?.id ?? null,
      deadlineAt: idea.suggestedEndAt
        ? idea.suggestedEndAt.toISOString()
        : null,
      imageUrl: null,
    };
  } else {
    const optionsRaw = Array.isArray(rawPayload.options) ? rawPayload.options : [];
    const options = optionsRaw.map((opt) => {
      const name =
        typeof opt === "string"
          ? opt
          : String((opt as any)?.name || "");
      return {
        name,
        imageUrl: null,
        personId: resolvePersonIdByName(name, people.byName),
        seedCount: 0,
      };
    });
    userPayload = {
      ...userPayload,
      title: String(rawPayload.title || ""),
      category: String(rawPayload.category || "misc"),
      summary: rawPayload.summary ?? null,
      description: rawPayload.description ?? null,
      imageUrl: null,
      options,
    };
  }

  const suggestionType = contentTypeToSuggestionType(contentType);
  const syntheticSuggestion = {
    id: idea.id,
    type: suggestionType,
    payload: userPayload,
    submittedBy: opts.adminId,
    status: "pending",
    adminNotes: null,
    approvedAsId: null,
    approvedAsType: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: idea.createdAt,
    updatedAt: idea.createdAt,
  } as Suggestion;

  // Force draft: matchup translator defaults visibility "live" (isActive true);
  // sentiment/opinion default draft. The override keeps every approved idea a
  // draft until the founder finishes and publishes it in-tab.
  const adminOverrides: Record<string, unknown> = {
    visibility: "draft",
    ...(opts.overrides || {}),
  };

  const { approvedAsId, approvedAsType } = await dispatchApproval(
    syntheticSuggestion,
    opts.adminId,
    adminOverrides,
  );

  await db
    .update(voteScoutIdeas)
    .set({
      status: "approved",
      approvedAsId,
      approvedAsType,
      reviewedBy: opts.adminId,
      reviewedAt: new Date(),
    })
    .where(eq(voteScoutIdeas.id, opts.id));

  log(
    `[VoteScout] Approved idea ${opts.id} → ${approvedAsType} ${approvedAsId}`,
  );

  return {
    approvedAsId,
    approvedAsType,
    contentType,
    tabLabel: contentTypeTabLabel(contentType),
  };
}

// Re-export for routes / UI helpers
export { APPROVED_AS_TYPE, contentTypeTabLabel };
