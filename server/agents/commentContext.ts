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

import { and, eq } from "drizzle-orm";
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
} from "@shared/schema";
import { db } from "../db";

export type CommentSurface = "matchup" | "trending_poll" | "opinion_poll" | "open_market";

/** Common shape across all surfaces. */
interface BaseContext {
  surface: CommentSurface;
  title: string;
  category: string | null;
  /** What the agent voted/bet on this parent, if anything. Used to keep the
   *  comment consistent with their position. */
  agentChoice?: string | null;
}

export interface MatchupContext extends BaseContext {
  surface: "matchup";
  prompt: string | null;
  description: string | null;
  optionA: { label: string; bio: string | null };
  optionB: { label: string; bio: string | null };
  /** "Person A label" | "Person B label" | "neutral" */
  agentChoice?: string | null;
}

export interface TrendingPollContext extends BaseContext {
  surface: "trending_poll";
  headline: string;
  subjectText: string;
  description: string | null;
  timeline: string | null;
  /** "support" | "neutral" | "oppose" */
  agentChoice?: string | null;
}

export interface OpinionPollContext extends BaseContext {
  surface: "opinion_poll";
  description: string | null;
  summary: string | null;
  options: Array<{ name: string }>;
  /** the option label they voted for */
  agentChoice?: string | null;
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
  const [bioA, bioB] = await Promise.all([
    fetchBio(row.personAId),
    fetchBio(row.personBId),
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

  const [agentVote] = await db
    .select({ choice: trendingPollVotes.choice })
    .from(trendingPollVotes)
    .where(
      and(
        eq(trendingPollVotes.pollId, pollId),
        eq(trendingPollVotes.userId, agentUserId),
      ),
    )
    .limit(1);

  return {
    surface: "trending_poll",
    title: row.headline,
    category: row.category,
    headline: row.headline,
    subjectText: row.subjectText,
    description: clip(row.description, 800),
    timeline: clip(row.timeline, 240),
    agentChoice: agentVote?.choice ?? null,
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

  const optionRows = await db
    .select({
      id: opinionPollOptions.id,
      name: opinionPollOptions.name,
    })
    .from(opinionPollOptions)
    .where(eq(opinionPollOptions.pollId, pollId))
    .orderBy(opinionPollOptions.orderIndex);

  const [agentVote] = await db
    .select({ optionId: opinionPollVotes.optionId })
    .from(opinionPollVotes)
    .where(
      and(
        eq(opinionPollVotes.pollId, pollId),
        eq(opinionPollVotes.userId, agentUserId),
      ),
    )
    .limit(1);

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

  const entryRows = await db
    .select({
      id: marketEntries.id,
      label: marketEntries.label,
      description: marketEntries.description,
    })
    .from(marketEntries)
    .where(eq(marketEntries.marketId, marketId))
    .orderBy(marketEntries.displayOrder);

  // Most-recent active bet for this agent on this market — gives us the
  // entry + direction so the comment can read like an opinion they hold.
  const [agentBet] = await db
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
    .limit(1);

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
