/**
 * Per-surface comment context fetchers.
 *
 * The LLM comment generator needs to read the same context a human would see
 * before posting (title, prompt, options, AI summaries, etc.) AND to know
 * whether the agent has already voted/bet on this thing — so the comment can
 * stay consistent with their position.
 *
 * Each fetcher returns a typed bundle that the generator turns into a prompt.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import {
  matchups,
  trackedPeople,
  trendingPolls,
  trendingPollVotes,
  opinionPolls,
  opinionPollOptions,
  opinionPollVotes,
  predictionMarkets,
  marketEntries,
  marketBets,
  votes,
  comments as unifiedComments,
} from "@shared/schema";
import { db } from "../db";

export type CommentSurface = "matchup" | "trending_poll" | "opinion_poll" | "open_market";

/** Up to N most-recent comments shown to the LLM so it doesn't paraphrase
 *  what a previous user / agent already said. */
const EXISTING_COMMENT_LIMIT = 5;

/** Common shape across all surfaces. */
interface BaseContext {
  surface: CommentSurface;
  title: string;
  category: string | null;
  /** What the agent voted/bet on this parent, if anything. Used to keep the
   *  comment consistent with their position. */
  agentChoice?: string | null;
  /** Most-recent comment bodies on this parent, for de-duplication. The
   *  agent reads these and is told not to echo them. */
  existingComments?: Array<{ body: string }>;
}

export interface MatchupContext extends BaseContext {
  surface: "matchup";
  prompt: string | null;
  description: string | null;
  optionA: { label: string; bio: string | null };
  optionB: { label: string; bio: string | null };
  /** "Person A label" | "Person B label" | "neutral" */
  agentChoice?: string | null;
  existingComments?: Array<{ body: string }>;
}

export interface TrendingPollContext extends BaseContext {
  surface: "trending_poll";
  headline: string;
  subjectText: string;
  description: string | null;
  timeline: string | null;
  /** "support" | "neutral" | "oppose" */
  agentChoice?: string | null;
  existingComments?: Array<{ body: string }>;
}

export interface OpinionPollContext extends BaseContext {
  surface: "opinion_poll";
  description: string | null;
  summary: string | null;
  options: Array<{ name: string }>;
  /** the option label they voted for */
  agentChoice?: string | null;
  existingComments?: Array<{ body: string }>;
}

export interface OpenMarketContext extends BaseContext {
  surface: "open_market";
  summary: string | null;
  teaser: string | null;
  description: string | null;
  endAt: Date | null;
  entries: Array<{ label: string; description: string | null }>;
  /** "<entry label> (yes|no)" */
  agentChoice?: string | null;
  existingComments?: Array<{ body: string }>;
}

export type CommentContext =
  | MatchupContext
  | TrendingPollContext
  | OpinionPollContext
  | OpenMarketContext;

/**
 * Truncate long context strings so we don't blow the prompt budget on a single
 * agent's call. We pass full prompts but trim verbose fields (description,
 * summary) to a conservative ceiling.
 */
function clip(value: string | null | undefined, maxChars: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Pull the most-recent live comments on a parent so the LLM can read what
 * other users (or earlier agents) have already said. The agent is then told
 * not to echo, paraphrase, or duplicate any of these.
 */
async function fetchExistingComments(
  parentType: CommentSurface,
  parentId: string,
): Promise<Array<{ body: string }>> {
  const rows = await db
    .select({ body: unifiedComments.body })
    .from(unifiedComments)
    .where(
      and(
        eq(unifiedComments.parentType, parentType),
        eq(unifiedComments.parentId, parentId),
        sql`${unifiedComments.deletedAt} IS NULL`,
      ),
    )
    .orderBy(desc(unifiedComments.createdAt))
    .limit(EXISTING_COMMENT_LIMIT);
  return rows.map((row) => ({ body: row.body }));
}

export async function fetchMatchupContext(
  matchupId: string,
  agentUserId: string,
): Promise<MatchupContext | null> {
  const [row] = await db
    .select({
      title: matchups.title,
      category: matchups.category,
      promptText: matchups.promptText,
      description: matchups.description,
      optionAText: matchups.optionAText,
      optionBText: matchups.optionBText,
      personAId: matchups.personAId,
      personBId: matchups.personBId,
    })
    .from(matchups)
    .where(eq(matchups.id, matchupId))
    .limit(1);

  if (!row) return null;

  // Pull bios for any linked people so the agent can riff on context
  // (e.g. "Trump's recent state visit" rather than just "Trump"). Run the
  // two lookups in parallel — they're independent.
  const fetchBio = async (personId: string | null): Promise<string | null> => {
    if (!personId) return null;
    const [p] = await db
      .select({ bio: trackedPeople.bio })
      .from(trackedPeople)
      .where(eq(trackedPeople.id, personId))
      .limit(1);
    return clip(p?.bio ?? null, 240);
  };
  const [bioA, bioB, existingComments] = await Promise.all([
    fetchBio(row.personAId),
    fetchBio(row.personBId),
    fetchExistingComments("matchup", matchupId),
  ]);

  // Matchup votes are written by the API into the polymorphic `votes` table
  // with voteType="face_off" — see voteWorker insert path. So that's the
  // canonical lookup, not the legacy face_off_votes table.
  const [agentVote] = await db
    .select({ value: votes.value })
    .from(votes)
    .where(
      and(
        eq(votes.userId, agentUserId),
        eq(votes.voteType, "face_off"),
        eq(votes.targetId, matchupId),
      ),
    )
    .limit(1);

  let agentChoice: string | null = null;
  if (agentVote) {
    if (agentVote.value === "option_a") agentChoice = row.optionAText;
    else if (agentVote.value === "option_b") agentChoice = row.optionBText;
    else if (agentVote.value === "neutral") agentChoice = "neutral";
  }

  return {
    surface: "matchup",
    title: row.title,
    category: row.category,
    prompt: clip(row.promptText, 400),
    description: clip(row.description, 400),
    optionA: { label: row.optionAText, bio: bioA },
    optionB: { label: row.optionBText, bio: bioB },
    agentChoice,
    existingComments,
  };
}

export async function fetchTrendingPollContext(
  pollId: string,
  agentUserId: string,
): Promise<TrendingPollContext | null> {
  const [row] = await db
    .select({
      headline: trendingPolls.headline,
      subjectText: trendingPolls.subjectText,
      category: trendingPolls.category,
      description: trendingPolls.description,
      timeline: trendingPolls.timeline,
    })
    .from(trendingPolls)
    .where(eq(trendingPolls.id, pollId))
    .limit(1);

  if (!row) return null;

  const [agentVoteResult, existingComments] = await Promise.all([
    db
      .select({ choice: trendingPollVotes.choice })
      .from(trendingPollVotes)
      .where(
        and(
          eq(trendingPollVotes.pollId, pollId),
          eq(trendingPollVotes.userId, agentUserId),
        ),
      )
      .limit(1),
    fetchExistingComments("trending_poll", pollId),
  ]);
  const agentVote = agentVoteResult[0];

  return {
    surface: "trending_poll",
    title: row.headline,
    category: row.category,
    headline: row.headline,
    subjectText: row.subjectText,
    description: clip(row.description, 800),
    timeline: clip(row.timeline, 240),
    agentChoice: agentVote?.choice ?? null,
    existingComments,
  };
}

export async function fetchOpinionPollContext(
  pollId: string,
  agentUserId: string,
): Promise<OpinionPollContext | null> {
  const [row] = await db
    .select({
      title: opinionPolls.title,
      category: opinionPolls.category,
      description: opinionPolls.description,
      summary: opinionPolls.summary,
    })
    .from(opinionPolls)
    .where(eq(opinionPolls.id, pollId))
    .limit(1);

  if (!row) return null;

  const [optionRows, agentVoteResult, existingComments] = await Promise.all([
    db
      .select({
        id: opinionPollOptions.id,
        name: opinionPollOptions.name,
      })
      .from(opinionPollOptions)
      .where(eq(opinionPollOptions.pollId, pollId))
      .orderBy(opinionPollOptions.orderIndex),
    db
      .select({ optionId: opinionPollVotes.optionId })
      .from(opinionPollVotes)
      .where(
        and(
          eq(opinionPollVotes.pollId, pollId),
          eq(opinionPollVotes.userId, agentUserId),
        ),
      )
      .limit(1),
    fetchExistingComments("opinion_poll", pollId),
  ]);
  const agentVote = agentVoteResult[0];

  let agentChoice: string | null = null;
  if (agentVote) {
    const matched = optionRows.find((opt) => opt.id === agentVote.optionId);
    agentChoice = matched?.name ?? null;
  }

  return {
    surface: "opinion_poll",
    title: row.title,
    category: row.category,
    description: clip(row.description, 800),
    summary: clip(row.summary, 600),
    options: optionRows.map((o) => ({ name: o.name })),
    agentChoice,
    existingComments,
  };
}

export async function fetchOpenMarketContext(
  marketId: string,
  agentUserId: string,
): Promise<OpenMarketContext | null> {
  const [row] = await db
    .select({
      title: predictionMarkets.title,
      category: predictionMarkets.category,
      summary: predictionMarkets.summary,
      teaser: predictionMarkets.teaser,
      description: predictionMarkets.description,
      endAt: predictionMarkets.endAt,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, marketId))
    .limit(1);

  if (!row) return null;

  const [entryRows, agentBetResult, existingComments] = await Promise.all([
    db
      .select({
        id: marketEntries.id,
        label: marketEntries.label,
        description: marketEntries.description,
      })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, marketId))
      .orderBy(marketEntries.displayOrder),
    // Most-recent active bet for this agent on this market — gives us the
    // entry + direction so the comment can read like an opinion they hold.
    db
      .select({
        entryId: marketBets.entryId,
        direction: marketBets.direction,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.marketId, marketId),
          eq(marketBets.userId, agentUserId),
          eq(marketBets.status, "active"),
        ),
      )
      .limit(1),
    fetchExistingComments("open_market", marketId),
  ]);
  const agentBet = agentBetResult[0];

  let agentChoice: string | null = null;
  if (agentBet) {
    const entry = entryRows.find((e) => e.id === agentBet.entryId);
    if (entry) {
      agentChoice = `${entry.label} (${agentBet.direction})`;
    }
  }

  return {
    surface: "open_market",
    title: row.title,
    category: row.category ?? null,
    summary: clip(row.summary, 600),
    teaser: clip(row.teaser, 240),
    description: clip(row.description, 800),
    endAt: row.endAt ?? null,
    entries: entryRows.map((e) => ({ label: e.label, description: clip(e.description, 200) })),
    agentChoice,
    existingComments,
  };
}

/**
 * Single entrypoint — dispatch on parent type. Returns null if the parent
 * doesn't exist or isn't readable.
 */
export async function fetchCommentContext(
  surface: CommentSurface,
  parentId: string,
  agentUserId: string,
): Promise<CommentContext | null> {
  switch (surface) {
    case "matchup":
      return fetchMatchupContext(parentId, agentUserId);
    case "trending_poll":
      return fetchTrendingPollContext(parentId, agentUserId);
    case "opinion_poll":
      return fetchOpinionPollContext(parentId, agentUserId);
    case "open_market":
      return fetchOpenMarketContext(parentId, agentUserId);
  }
}
