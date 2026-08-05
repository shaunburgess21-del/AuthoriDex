/**
 * Vote Worker — lets AI agents cast persona-driven votes on matchups,
 * sentiment polls, and underrated/overrated polls. Max 3 votes per
 * agent per week. Runs once daily at a random hour.
 */

import { db } from "../db";
import {
  agentConfigs,
  profiles,
  votes,
  matchups,
  trendingPolls,
  trendingPollVotes,
  opinionPolls,
  opinionPollOptions,
  opinionPollVotes,
  sentimentVotes,
  trendingPeople,
  userVotes,
  celebrityMetrics,
} from "@shared/schema";
import { eq, and, sql, gte, count, desc, inArray } from "drizzle-orm";
import { log } from "../log";
import { gamificationService } from "../services/gamification";
import { awardVoteCredits, maybeFireReferralCredit } from "../services/credits-earn";
import { checkAndAwardVoteBadges } from "../services/badges";
import { getSimulationProfile, type AgentSimulationProfile } from "./simulationProfile";
import { recomputeCelebrityMetrics } from "../services/celebrity-metrics-recompute";
import { isAgentsPaused } from "./runtime-state";
import { attachVoteCounts, pickLeastVotedFirst } from "./voteSelection";

const BOOT_DELAY_MS = 180_000; // 3 minutes after boot

type VoteType =
  | "matchup"
  | "sentiment_poll"
  | "opinion_poll"
  | "underrated_overrated"
  | "approval_rating";

// When approval_rating is the next type in the shuffled rotation, only run it
// this fraction of the time. Keeps platform-wide rating volume to roughly
// 20–30 ratings per week across the whole agent cohort so we add some life
// without shifting leaderboard averages.
const APPROVAL_RATING_TRIGGER_CHANCE = 0.2;

async function fireAgentVoteRewards(
  userId: string,
  voteType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await awardVoteCredits(userId, voteType, entityId, metadata);
  } catch (e) {
    log(`[VoteWorker] vote credits failed for ${userId}: ${e}`);
  }
  try {
    await checkAndAwardVoteBadges(userId);
  } catch (e) {
    log(`[VoteWorker] vote badges failed for ${userId}: ${e}`);
  }
  try {
    await maybeFireReferralCredit(userId);
  } catch (e) {
    log(`[VoteWorker] referral credit failed for ${userId}: ${e}`);
  }
}

// Cap candidate celebrities so the rating sweep stays bounded if the
// catalogue ever grows past a few hundred. With the current ~159 curated
// people, 200 covers everyone — there's no genuine "long tail" here, every
// seeded celebrity deserves a shot at receiving agent ratings. (Was 120
// before, which structurally locked the bottom ~39 out of the rating
// rotation; same blind-spot pattern as the comment worker had at limit 30.)
const APPROVAL_RATING_CANDIDATE_LIMIT = 200;

interface AgentVoteResult {
  agentName: string;
  voteType: VoteType;
  target: string;
  choice: string;
  xpAwarded: number;
}

function getMondayOfWeek(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

async function countAgentVotesThisWeek(userId: string): Promise<number> {
  const monday = getMondayOfWeek();

  const [matchupCount] = await db
    .select({ c: count() })
    .from(votes)
    .where(
      and(
        eq(votes.userId, userId),
        eq(votes.voteType, "face_off"),
        gte(votes.votedAt, monday)
      )
    );

  const [pollCount] = await db
    .select({ c: count() })
    .from(trendingPollVotes)
    .where(
      and(
        eq(trendingPollVotes.userId, userId),
        gte(trendingPollVotes.createdAt, monday)
      )
    );

  const [sentimentCount] = await db
    .select({ c: count() })
    .from(sentimentVotes)
    .where(
      and(
        eq(sentimentVotes.userId, userId),
        gte(sentimentVotes.votedAt, monday)
      )
    );

  const [opinionCount] = await db
    .select({ c: count() })
    .from(opinionPollVotes)
    .where(
      and(
        eq(opinionPollVotes.userId, userId),
        gte(opinionPollVotes.createdAt, monday)
      )
    );

  // Approval ratings (1–5 stars) live in user_votes; the unique constraint
  // means upserts can move votedAt forward, so anything with votedAt this
  // week is "fresh activity" for cap accounting.
  const [approvalCount] = await db
    .select({ c: count() })
    .from(userVotes)
    .where(
      and(
        eq(userVotes.userId, userId),
        gte(userVotes.votedAt, monday)
      )
    );

  return (
    Number(matchupCount?.c || 0) +
    Number(pollCount?.c || 0) +
    Number(sentimentCount?.c || 0) +
    Number(opinionCount?.c || 0) +
    Number(approvalCount?.c || 0)
  );
}

// ── Matchup voting ─────────────────────────────────────────────────────

async function getEligibleMatchups(userId: string) {
  const active = await db
    .select({
      id: matchups.id,
      category: matchups.category,
      optionAText: matchups.optionAText,
      optionBText: matchups.optionBText,
      seedVotesA: matchups.seedVotesA,
      seedVotesB: matchups.seedVotesB,
    })
    .from(matchups)
    .where(
      and(
        eq(matchups.isActive, true),
        eq(matchups.visibility, "live")
      )
    );

  const alreadyVoted = await db
    .select({ targetId: votes.targetId })
    .from(votes)
    .where(
      and(eq(votes.userId, userId), eq(votes.voteType, "face_off"))
    );

  const votedSet = new Set(alreadyVoted.map((v) => v.targetId));
  const eligible = active.filter((m) => !votedSet.has(m.id));
  if (!eligible.length) return [];

  const crowdCounts = await db
    .select({ id: votes.targetId, c: count() })
    .from(votes)
    .where(
      and(
        eq(votes.voteType, "face_off"),
        inArray(
          votes.targetId,
          eligible.map((m) => m.id),
        ),
      ),
    )
    .groupBy(votes.targetId);

  return attachVoteCounts(eligible, crowdCounts);
}

async function getMatchupCrowdSplit(matchupId: string) {
  const results = await db
    .select({ value: votes.value, c: count() })
    .from(votes)
    .where(
      and(eq(votes.voteType, "face_off"), eq(votes.targetId, matchupId))
    )
    .groupBy(votes.value);

  const a = Number(results.find((r) => r.value === "option_a")?.c || 0);
  const b = Number(results.find((r) => r.value === "option_b")?.c || 0);
  return { a, b, total: a + b };
}

function decideMatchup(
  agent: { contrarianism: number; specialties: string[] },
  matchup: { category: string; optionAText: string; optionBText: string; seedVotesA: number; seedVotesB: number },
  crowd: { a: number; b: number; total: number }
): "option_a" | "option_b" {
  const totalA = crowd.a + (matchup.seedVotesA || 0);
  const totalB = crowd.b + (matchup.seedVotesB || 0);
  const total = totalA + totalB;

  if (total === 0) return Math.random() < 0.5 ? "option_a" : "option_b";

  const aRatio = totalA / total;
  const minority = aRatio < 0.5 ? "option_a" : "option_b";
  const majority = minority === "option_a" ? "option_b" : "option_a";

  if (agent.contrarianism > 0.6) {
    return Math.random() < agent.contrarianism ? minority : majority;
  }
  return Math.random() < aRatio ? "option_a" : "option_b";
}

// ── Opinion poll voting ────────────────────────────────────────────────

async function getEligibleOpinionPolls(userId: string) {
  const active = await db
    .select({
      id: opinionPolls.id,
      title: opinionPolls.title,
      category: opinionPolls.category,
    })
    .from(opinionPolls)
    .where(eq(opinionPolls.visibility, "live"));

  if (!active.length) return [];

  const alreadyVoted = await db
    .select({ pollId: opinionPollVotes.pollId })
    .from(opinionPollVotes)
    .where(eq(opinionPollVotes.userId, userId));
  const votedSet = new Set(alreadyVoted.map((v) => v.pollId));
  const pollIds = active.map((poll) => poll.id);

  const options = await db
    .select({
      id: opinionPollOptions.id,
      pollId: opinionPollOptions.pollId,
      name: opinionPollOptions.name,
      seedCount: opinionPollOptions.seedCount,
    })
    .from(opinionPollOptions)
    .where(inArray(opinionPollOptions.pollId, pollIds));

  const eligible = active
    .filter((poll) => !votedSet.has(poll.id))
    .map((poll) => ({
      ...poll,
      options: options.filter((option) => option.pollId === poll.id),
    }))
    .filter((poll) => poll.options.length > 0);
  if (!eligible.length) return [];

  const crowdCounts = await db
    .select({ id: opinionPollVotes.pollId, c: count() })
    .from(opinionPollVotes)
    .where(
      inArray(
        opinionPollVotes.pollId,
        eligible.map((poll) => poll.id),
      ),
    )
    .groupBy(opinionPollVotes.pollId);

  return attachVoteCounts(eligible, crowdCounts);
}

function decideOpinionPoll(
  agent: { contrarianism: number },
  options: Array<{ id: string; name: string; seedCount: number }>,
): { id: string; name: string } {
  if (agent.contrarianism > 0.65) {
    const sorted = [...options].sort((a, b) => a.seedCount - b.seedCount);
    return Math.random() < agent.contrarianism ? sorted[0] : sorted[Math.floor(Math.random() * sorted.length)];
  }

  const total = options.reduce((sum, option) => sum + Math.max(1, option.seedCount), 0);
  let roll = Math.random() * total;
  for (const option of options) {
    roll -= Math.max(1, option.seedCount);
    if (roll <= 0) return option;
  }
  return options[0];
}

// ── Sentiment poll (trending poll) voting ──────────────────────────────

async function getEligibleSentimentPolls(userId: string) {
  const active = await db
    .select({
      id: trendingPolls.id,
      category: trendingPolls.category,
      headline: trendingPolls.headline,
      seedAgreeCount: trendingPolls.seedAgreeCount,
      seedNeutralCount: trendingPolls.seedNeutralCount,
      seedDisagreeCount: trendingPolls.seedDisagreeCount,
    })
    .from(trendingPolls)
    .where(eq(trendingPolls.visibility, "live"));

  const alreadyVoted = await db
    .select({ pollId: trendingPollVotes.pollId })
    .from(trendingPollVotes)
    .where(eq(trendingPollVotes.userId, userId));

  const votedSet = new Set(alreadyVoted.map((v) => v.pollId));
  const eligible = active.filter((p) => !votedSet.has(p.id));
  if (!eligible.length) return [];

  const crowdCounts = await db
    .select({ id: trendingPollVotes.pollId, c: count() })
    .from(trendingPollVotes)
    .where(
      inArray(
        trendingPollVotes.pollId,
        eligible.map((p) => p.id),
      ),
    )
    .groupBy(trendingPollVotes.pollId);

  return attachVoteCounts(eligible, crowdCounts);
}

async function getPollCrowdSplit(pollId: string) {
  const results = await db
    .select({ choice: trendingPollVotes.choice, c: count() })
    .from(trendingPollVotes)
    .where(eq(trendingPollVotes.pollId, pollId))
    .groupBy(trendingPollVotes.choice);

  let agree = 0;
  let neutral = 0;
  let disagree = 0;
  for (const r of results) {
    const n = Number(r.c || 0);
    if (r.choice === "agree" || r.choice === "support") agree += n;
    else if (r.choice === "neutral") neutral += n;
    else if (r.choice === "disagree" || r.choice === "oppose") disagree += n;
  }
  return { agree, neutral, disagree };
}

function decideSentimentPoll(
  agent: { contrarianism: number },
  poll: { seedAgreeCount: number; seedNeutralCount: number; seedDisagreeCount: number },
  crowd: { agree: number; neutral: number; disagree: number }
): "agree" | "neutral" | "disagree" {
  const s = crowd.agree + (poll.seedAgreeCount || 0);
  const n = crowd.neutral + (poll.seedNeutralCount || 0);
  const o = crowd.disagree + (poll.seedDisagreeCount || 0);
  const total = s + n + o;

  if (Math.random() < 0.15) return "neutral";

  if (total === 0) {
    const r = Math.random();
    return r < 0.45 ? "agree" : r < 0.90 ? "disagree" : "neutral";
  }

  const agreeRatio = s / total;
  const disagreeRatio = o / total;

  if (agent.contrarianism > 0.6) {
    return agreeRatio > disagreeRatio ? "disagree" : "agree";
  }
  return agreeRatio >= disagreeRatio ? "agree" : "disagree";
}

// ── Underrated/Overrated voting ────────────────────────────────────────

async function getEligiblePeopleForSentiment(userId: string) {
  const today = new Date().toISOString().split("T")[0];

  // Was limit 50 — locked the bottom ~109 of the 159-person catalogue
  // out of any agent sentiment vote forever, regardless of how popular
  // those celebs were on the actual product. 200 covers the entire
  // curated catalogue with headroom; the per-agent already-voted-today
  // filter below keeps daily volume controlled.
  const people = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
      category: trendingPeople.category,
      trendScore: trendingPeople.trendScore,
    })
    .from(trendingPeople)
    .orderBy(desc(trendingPeople.trendScore))
    .limit(200);

  const alreadyVoted = await db
    .select({ personId: sentimentVotes.personId })
    .from(sentimentVotes)
    .where(
      and(eq(sentimentVotes.userId, userId), eq(sentimentVotes.votedDate, today))
    );

  const votedSet = new Set(alreadyVoted.map((v) => v.personId));
  return people.filter((p) => !votedSet.has(p.id));
}

function decideUnderratedOverrated(
  agent: { contrarianism: number; prestigeBias: number },
  person: { trendScore: number }
): "underrated" | "overrated" {
  const highScore = person.trendScore > 7000;

  if (agent.prestigeBias > 0.6 && highScore) {
    return Math.random() < agent.prestigeBias ? "underrated" : "overrated";
  }

  if (agent.contrarianism > 0.6) {
    return highScore ? "overrated" : "underrated";
  }

  return Math.random() < 0.55 ? "underrated" : "overrated";
}

// ── Approval rating (1–5) voting ───────────────────────────────────────

interface RatingCandidate {
  id: string;
  name: string;
  category: string | null;
  trendScore: number;
  currentAvg: number | null;
}

async function getEligiblePeopleForApprovalRating(userId: string): Promise<RatingCandidate[]> {
  const alreadyRated = await db
    .select({ personId: userVotes.personId })
    .from(userVotes)
    .where(eq(userVotes.userId, userId));
  const ratedSet = new Set(alreadyRated.map((row) => row.personId));

  const rows = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
      category: trendingPeople.category,
      trendScore: trendingPeople.trendScore,
      currentAvg: celebrityMetrics.approvalAvgRating,
    })
    .from(trendingPeople)
    .leftJoin(celebrityMetrics, eq(celebrityMetrics.celebrityId, trendingPeople.id))
    .orderBy(desc(trendingPeople.trendScore))
    .limit(APPROVAL_RATING_CANDIDATE_LIMIT);

  return rows
    .filter((row) => !ratedSet.has(row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category ?? null,
      trendScore: row.trendScore ?? 0,
      currentAvg: row.currentAvg != null ? Number(row.currentAvg) : null,
    }));
}

function chooseRatingTarget(
  candidates: RatingCandidate[],
  profile: AgentSimulationProfile,
): RatingCandidate {
  const preferred = candidates.filter(
    (candidate) => candidate.category && profile.favoriteCategories.includes(candidate.category),
  );
  // 70% specialty-aligned, 30% open field — matches our voting/commenting bias.
  const pool = preferred.length > 0 && Math.random() < 0.7 ? preferred : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function decideApprovalRating(
  agent: { contrarianism: number; prestigeBias: number },
  profile: AgentSimulationProfile,
  person: RatingCandidate,
): number {
  const seed = person.currentAvg ?? 3;
  let target = seed;

  // Mild contrarian pull toward the opposite end of crowd consensus.
  if (agent.contrarianism > 0.6) {
    const flip = seed >= 3 ? -1.2 : 1.2;
    target = seed + flip * (agent.contrarianism - 0.5);
  }

  // High-fame people tilt slightly higher for prestige-leaning agents.
  if (agent.prestigeBias > 0.55 && person.trendScore > 6000) {
    target += 0.3;
  }

  // Persona-band variance: how far this agent is willing to drift from the
  // crowd average. Sharp/liquidity stay close; noisy roams wide.
  const variance =
    profile.personaBand === "sharp" || profile.personaBand === "liquidity"
      ? 0.4
      : profile.personaBand === "casual"
        ? 0.8
        : profile.personaBand === "whale"
          ? 0.6
          : 1.4; // noisy
  const noise = (Math.random() - 0.5) * 2 * variance;
  let raw = target + noise;

  // Noisy band occasionally splashes an extreme rating for colour.
  if (profile.personaBand === "noisy" && Math.random() < 0.25) {
    raw = Math.random() < 0.5 ? 1 : 5;
  }

  return Math.max(1, Math.min(5, Math.round(raw)));
}

// ── Per-parent vote helpers (used inline by commentWorker) ─────────────

/**
 * Cast a vote on a SPECIFIC matchup. Used by the comment worker to honour
 * the vote-first rule without depending on the daily vote sweep happening
 * to land on this matchup. Returns true on a fresh insert, false if the
 * agent has already voted (race), the matchup wasn't found, or anything
 * threw. Mirrors the matchup branch in runVoteSweep so behaviour is
 * consistent across the two callers.
 */
export async function castMatchupVoteForUser(
  userId: string,
  matchupId: string,
  contrarianism: number,
  specialties: string[],
): Promise<boolean> {
  try {
    const [matchup] = await db
      .select({
        id: matchups.id,
        category: matchups.category,
        optionAText: matchups.optionAText,
        optionBText: matchups.optionBText,
        seedVotesA: matchups.seedVotesA,
        seedVotesB: matchups.seedVotesB,
      })
      .from(matchups)
      .where(eq(matchups.id, matchupId))
      .limit(1);
    if (!matchup) return false;

    const crowd = await getMatchupCrowdSplit(matchup.id);
    const choice = decideMatchup({ contrarianism, specialties }, matchup, crowd);

    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(votes)
        .values({
          userId,
          voteType: "face_off",
          targetType: "face_off",
          targetId: matchup.id,
          value: choice,
          weight: 1.0,
        })
        .onConflictDoNothing()
        .returning({ id: votes.id });
      if (!row) return false;
      await tx
        .update(profiles)
        .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
        .where(eq(profiles.id, userId));
      try {
        await gamificationService.awardXp(
          userId,
          "vote_face_off",
          `face_off_${matchup.id}_${userId}`,
          { matchupId: matchup.id, votedOption: choice, agent: true, source: "comment_worker" },
        );
      } catch {
        /* XP failure is non-fatal — the vote is what matters */
      }
      return true;
    });
    if (!inserted) return false;

    await fireAgentVoteRewards(userId, "matchup", matchup.id, { votedOption: choice });
    return true;
  } catch (err) {
    log(`[VoteWorker:inline] castMatchupVoteForUser failed (user=${userId}, matchup=${matchupId}): ${err}`);
    return false;
  }
}

export async function castSentimentPollVoteForUser(
  userId: string,
  pollId: string,
  contrarianism: number,
): Promise<boolean> {
  try {
    const [poll] = await db
      .select({
        id: trendingPolls.id,
        category: trendingPolls.category,
        headline: trendingPolls.headline,
        seedAgreeCount: trendingPolls.seedAgreeCount,
        seedNeutralCount: trendingPolls.seedNeutralCount,
        seedDisagreeCount: trendingPolls.seedDisagreeCount,
      })
      .from(trendingPolls)
      .where(eq(trendingPolls.id, pollId))
      .limit(1);
    if (!poll) return false;

    const crowd = await getPollCrowdSplit(poll.id);
    const choice = decideSentimentPoll({ contrarianism }, poll, crowd);

    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(trendingPollVotes)
        .values({ pollId: poll.id, userId, choice })
        .onConflictDoNothing()
        .returning({ id: trendingPollVotes.id });
      if (!row) return false;
      await tx
        .update(profiles)
        .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
        .where(eq(profiles.id, userId));
      try {
        await gamificationService.awardXp(
          userId,
          "vote_sentiment",
          `sentiment_poll_${poll.id}_${userId}`,
          { pollId: poll.id, choice, agent: true, source: "comment_worker" },
        );
      } catch {
        /* non-fatal */
      }
      return true;
    });
    if (!inserted) return false;

    await fireAgentVoteRewards(userId, "trending_poll", String(poll.id), { choice });
    return true;
  } catch (err) {
    log(`[VoteWorker:inline] castSentimentPollVoteForUser failed (user=${userId}, poll=${pollId}): ${err}`);
    return false;
  }
}

export async function castOpinionPollVoteForUser(
  userId: string,
  pollId: string,
  contrarianism: number,
): Promise<boolean> {
  try {
    const options = await db
      .select({
        id: opinionPollOptions.id,
        pollId: opinionPollOptions.pollId,
        name: opinionPollOptions.name,
        seedCount: opinionPollOptions.seedCount,
      })
      .from(opinionPollOptions)
      .where(eq(opinionPollOptions.pollId, pollId));
    if (!options.length) return false;

    const choice = decideOpinionPoll({ contrarianism }, options);

    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(opinionPollVotes)
        .values({ pollId, optionId: choice.id, userId })
        .onConflictDoNothing()
        .returning({ id: opinionPollVotes.id });
      if (!row) return false;
      await tx
        .update(profiles)
        .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
        .where(eq(profiles.id, userId));
      try {
        await gamificationService.awardXp(
          userId,
          "vote_opinion",
          `opinion_poll_${pollId}_${userId}`,
          { pollId, optionId: choice.id, agent: true, source: "comment_worker" },
        );
      } catch {
        /* non-fatal */
      }
      return true;
    });
    if (!inserted) return false;

    await fireAgentVoteRewards(userId, "opinion_poll", String(pollId), {
      optionId: choice.id,
    });
    return true;
  } catch (err) {
    log(`[VoteWorker:inline] castOpinionPollVoteForUser failed (user=${userId}, poll=${pollId}): ${err}`);
    return false;
  }
}

// Re-export the weekly vote counter so callers can respect simulation
// caps without duplicating the union query.
export { countAgentVotesThisWeek };

// ── Person approval vote (used inline by commentWorker for profile insights) ─

/**
 * Cast a 1–5 approval vote on a person, used by the comment worker before
 * posting a profile insight. Implements the HYBRID sentiment model:
 *   - If the agent already has a rating on this person, return it (the
 *     comment must align with the existing stance badge).
 *   - If the agent is at their weekly vote cap, return null — the agent
 *     still comments, just without a rating badge (treated like a noisy-skip).
 *   - Noisy band: 30% chance to skip the vote entirely and post a raw take
 *     without a rating badge (matches what noisy humans do).
 *   - Otherwise: decide a rating via `decideApprovalRating`, insert, recompute
 *     celebrity metrics, return the rating.
 *
 * The returned rating is fed into the LLM prompt as the agent's stance so the
 * comment reads consistently with the badge shown next to the agent's name.
 */
export async function castPersonApprovalVoteForUser(
  userId: string,
  personId: string,
  personName: string,
  contrarianism: number,
  prestigeBias: number,
  profile: AgentSimulationProfile,
  currentAvg: number | null,
): Promise<number | null> {
  try {
    // If the agent already has a rating, use it — the comment must align
    // with the existing stance badge shown on the insight.
    const [existing] = await db
      .select({ rating: userVotes.rating })
      .from(userVotes)
      .where(
        and(
          eq(userVotes.userId, userId),
          eq(userVotes.personId, personId),
        ),
      )
      .limit(1);
    if (existing) return Number(existing.rating);

    // Respect the weekly vote cap — but don't block the comment. The agent
    // just posts without a rating badge this time.
    const weeklyVotes = await countAgentVotesThisWeek(userId);
    if (weeklyVotes >= profile.weeklyVoteCap) {
      return null;
    }

    // Hybrid sentiment: noisy band occasionally skips the vote entirely.
    if (profile.personaBand === "noisy" && Math.random() < 0.30) {
      return null;
    }

    const rating = decideApprovalRating(
      { contrarianism, prestigeBias },
      profile,
      {
        id: personId,
        name: personName,
        category: null,
        trendScore: 0,
        currentAvg,
      },
    );

    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(userVotes)
        .values({
          userId,
          personId,
          personName,
          rating,
        })
        .onConflictDoNothing({
          target: [userVotes.userId, userVotes.personId],
        })
        .returning({ id: userVotes.id });
      if (!row) return false;
      await tx
        .update(profiles)
        .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
        .where(eq(profiles.id, userId));
      return true;
    });

    if (!inserted) {
      // Race condition: another sweep inserted between our check and our
      // insert. Re-fetch the existing rating so the comment aligns with it.
      const [raced] = await db
        .select({ rating: userVotes.rating })
        .from(userVotes)
        .where(
          and(
            eq(userVotes.userId, userId),
            eq(userVotes.personId, personId),
          ),
        )
        .limit(1);
      return raced ? Number(raced.rating) : null;
    }

    // Refresh leaderboard aggregates so the rating shows up immediately.
    // Failure doesn't roll back the rating — the next nightly recompute fixes it.
    try {
      await recomputeCelebrityMetrics(personId);
    } catch (e) {
      log(`[VoteWorker:inline] castPersonApprovalVoteForUser recompute failed for ${personId}: ${e}`);
    }

    return rating;
  } catch (err) {
    log(`[VoteWorker:inline] castPersonApprovalVoteForUser failed (user=${userId}, person=${personId}): ${err}`);
    return null;
  }
}

// ── Main sweep ─────────────────────────────────────────────────────────

export async function runVoteSweep(): Promise<AgentVoteResult[]> {
  // Global "pause all agents" kill switch (admin Agents tab toggle).
  if (await isAgentsPaused()) {
    log("[VoteWorker] Skipping sweep; agents are globally paused");
    return [];
  }

  const agents = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.isActive, true));

  if (!agents.length) {
    log("[VoteWorker] No active agents found");
    return [];
  }

  // Shuffle so the same agents don't always claim the first eligible
  // matchup/poll each sweep.
  for (let i = agents.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [agents[i], agents[j]] = [agents[j], agents[i]];
  }

  const results: AgentVoteResult[] = [];

  for (const agent of agents) {
    try {
      const weeklyCount = await countAgentVotesThisWeek(agent.userId);
      const simulation = getSimulationProfile(agent.simulationProfile);
      if (weeklyCount >= simulation.weeklyVoteCap) {
        log(`[VoteWorker] ${agent.displayName} at weekly cap (${weeklyCount}/${simulation.weeklyVoteCap}), skipping`);
        continue;
      }

      if (Math.random() > simulation.dailyVoteChance) {
        log(`[VoteWorker] ${agent.displayName} randomly skipped today`);
        continue;
      }

      const contrarianism = Number(agent.contrarianism);
      const prestigeBias = Number(agent.prestigeBias);
      const specialties = agent.specialties || [];

      const voteTypes: VoteType[] = [
        "matchup",
        "sentiment_poll",
        "opinion_poll",
        "underrated_overrated",
        "approval_rating",
      ];
      for (let i = voteTypes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [voteTypes[i], voteTypes[j]] = [voteTypes[j], voteTypes[i]];
      }
      let voted = false;

      for (const voteType of voteTypes) {
        if (voted) break;

        if (voteType === "matchup") {
          const eligible = await getEligibleMatchups(agent.userId);
          if (!eligible.length) continue;

          const matchup = pickLeastVotedFirst(eligible);
          const crowd = await getMatchupCrowdSplit(matchup.id);
          const choice = decideMatchup(
            { contrarianism, specialties },
            matchup,
            crowd
          );

          const inserted = await db.transaction(async (tx) => {
            const [row] = await tx.insert(votes).values({
              userId: agent.userId,
              voteType: "face_off",
              targetType: "face_off",
              targetId: matchup.id,
              value: choice,
              weight: 1.0,
            }).onConflictDoNothing().returning({ id: votes.id });
            if (!row) return false;
            await tx
              .update(profiles)
              .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
              .where(eq(profiles.id, agent.userId));
            return true;
          });
          if (!inserted) continue;

          let xpAwarded = 0;
          try {
            const xpResult = await gamificationService.awardXp(
              agent.userId,
              "vote_face_off",
              `face_off_${matchup.id}_${agent.userId}`,
              { matchupId: matchup.id, votedOption: choice, agent: true }
            );
            xpAwarded = xpResult.xpAwarded;
          } catch (e) {
            log(`[VoteWorker] XP award failed for ${agent.displayName}: ${e}`);
          }

          await fireAgentVoteRewards(agent.userId, "matchup", matchup.id, {
            votedOption: choice,
          });

          const choiceLabel = choice === "option_a" ? matchup.optionAText : matchup.optionBText;
          results.push({
            agentName: agent.displayName,
            voteType: "matchup",
            target: `${matchup.optionAText} vs ${matchup.optionBText}`,
            choice: choiceLabel,
            xpAwarded,
          });
          voted = true;
          log(`[VoteWorker] ${agent.displayName} voted "${choiceLabel}" on matchup "${matchup.optionAText} vs ${matchup.optionBText}" (+${xpAwarded} XP)`);
        } else if (voteType === "sentiment_poll") {
          const eligible = await getEligibleSentimentPolls(agent.userId);
          if (!eligible.length) continue;

          const poll = pickLeastVotedFirst(eligible);
          const crowd = await getPollCrowdSplit(poll.id);
          const choice = decideSentimentPoll({ contrarianism }, poll, crowd);

          const inserted = await db.transaction(async (tx) => {
            const [row] = await tx.insert(trendingPollVotes).values({
              pollId: poll.id,
              userId: agent.userId,
              choice,
            }).onConflictDoNothing().returning({ id: trendingPollVotes.id });
            if (!row) return false;
            await tx
              .update(profiles)
              .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
              .where(eq(profiles.id, agent.userId));
            return true;
          });
          if (!inserted) continue;

          let xpAwarded = 0;
          try {
            const xpResult = await gamificationService.awardXp(
              agent.userId,
              "vote_sentiment",
              `sentiment_poll_${poll.id}_${agent.userId}`,
              { pollId: poll.id, choice, agent: true }
            );
            xpAwarded = xpResult.xpAwarded;
          } catch (e) {
            log(`[VoteWorker] XP award failed for ${agent.displayName}: ${e}`);
          }

          await fireAgentVoteRewards(agent.userId, "trending_poll", String(poll.id), {
            choice,
          });

          results.push({
            agentName: agent.displayName,
            voteType: "sentiment_poll",
            target: poll.headline,
            choice,
            xpAwarded,
          });
          voted = true;
          log(`[VoteWorker] ${agent.displayName} voted "${choice}" on poll "${poll.headline}" (+${xpAwarded} XP)`);
        } else if (voteType === "opinion_poll") {
          const eligible = await getEligibleOpinionPolls(agent.userId);
          if (!eligible.length) continue;

          const poll = pickLeastVotedFirst(eligible);
          const choice = decideOpinionPoll({ contrarianism }, poll.options);

          const inserted = await db.transaction(async (tx) => {
            const [row] = await tx.insert(opinionPollVotes).values({
              pollId: poll.id,
              optionId: choice.id,
              userId: agent.userId,
            }).onConflictDoNothing().returning({ id: opinionPollVotes.id });
            if (!row) return false;
            await tx
              .update(profiles)
              .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
              .where(eq(profiles.id, agent.userId));
            return true;
          });
          if (!inserted) continue;

          let xpAwarded = 0;
          try {
            const xpResult = await gamificationService.awardXp(
              agent.userId,
              "vote_opinion",
              `opinion_poll_${poll.id}_${agent.userId}`,
              { pollId: poll.id, optionId: choice.id, agent: true }
            );
            xpAwarded = xpResult.xpAwarded;
          } catch (e) {
            log(`[VoteWorker] XP award failed for ${agent.displayName}: ${e}`);
          }

          await fireAgentVoteRewards(agent.userId, "opinion_poll", String(poll.id), {
            optionId: choice.id,
          });

          results.push({
            agentName: agent.displayName,
            voteType: "opinion_poll",
            target: poll.title,
            choice: choice.name,
            xpAwarded,
          });
          voted = true;
          log(`[VoteWorker] ${agent.displayName} voted "${choice.name}" on opinion poll "${poll.title}" (+${xpAwarded} XP)`);
        } else if (voteType === "underrated_overrated") {
          const eligible = await getEligiblePeopleForSentiment(agent.userId);
          if (!eligible.length) continue;

          const person = eligible[Math.floor(Math.random() * eligible.length)];
          const choice = decideUnderratedOverrated(
            { contrarianism, prestigeBias },
            { trendScore: person.trendScore }
          );
          const today = new Date().toISOString().split("T")[0];

          const inserted = await db.transaction(async (tx) => {
            const [row] = await tx.insert(sentimentVotes).values({
              userId: agent.userId,
              personId: person.id,
              personName: person.name,
              voteType: choice,
              votedDate: today,
            }).onConflictDoNothing().returning({ id: sentimentVotes.id });
            if (!row) return false;
            await tx
              .update(profiles)
              .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
              .where(eq(profiles.id, agent.userId));
            return true;
          });
          if (!inserted) continue;

          let xpAwarded = 0;
          try {
            const xpResult = await gamificationService.awardXp(
              agent.userId,
              "vote_sentiment",
              `sentiment_${person.id}_${today}_${agent.userId}`,
              { personId: person.id, choice, agent: true }
            );
            xpAwarded = xpResult.xpAwarded;
          } catch (e) {
            log(`[VoteWorker] XP award failed for ${agent.displayName}: ${e}`);
          }

          await fireAgentVoteRewards(
            agent.userId,
            "sentiment",
            `${person.id}_${today}`,
            { personId: person.id, voteType: choice },
          );

          results.push({
            agentName: agent.displayName,
            voteType: "underrated_overrated",
            target: person.name,
            choice,
            xpAwarded,
          });
          voted = true;
          log(`[VoteWorker] ${agent.displayName} voted "${choice}" on ${person.name} (+${xpAwarded} XP)`);
        } else if (voteType === "approval_rating") {
          // Sparing trigger: even when this type is up next, only fire a small
          // fraction of the time so total platform-wide approval volume stays
          // well below "moves the needle" territory.
          if (Math.random() >= APPROVAL_RATING_TRIGGER_CHANCE) continue;

          const simulation = getSimulationProfile(agent.simulationProfile);
          const candidates = await getEligiblePeopleForApprovalRating(agent.userId);
          if (!candidates.length) continue;

          const person = chooseRatingTarget(candidates, simulation);
          const rating = decideApprovalRating(
            { contrarianism, prestigeBias },
            simulation,
            person,
          );

          const inserted = await db.transaction(async (tx) => {
            const [row] = await tx
              .insert(userVotes)
              .values({
                userId: agent.userId,
                personId: person.id,
                personName: person.name,
                rating,
              })
              .onConflictDoNothing({
                target: [userVotes.userId, userVotes.personId],
              })
              .returning({ id: userVotes.id });
            if (!row) return false;
            await tx
              .update(profiles)
              .set({ totalVotes: sql`${profiles.totalVotes} + 1` })
              .where(eq(profiles.id, agent.userId));
            return true;
          });
          if (!inserted) continue;

          // Refresh the displayed leaderboard aggregates so the rating shows
          // up immediately. Failure here doesn't roll back the rating —
          // the next celebrity-metrics nightly recompute will fix it.
          try {
            await recomputeCelebrityMetrics(person.id);
          } catch (recomputeErr) {
            log(`[VoteWorker] Approval recompute failed for ${person.id}: ${recomputeErr}`);
          }

          results.push({
            agentName: agent.displayName,
            voteType: "approval_rating",
            target: person.name,
            choice: `${rating}/5`,
            xpAwarded: 0,
          });
          voted = true;
          log(`[VoteWorker] ${agent.displayName} rated ${person.name} ${rating}/5 (band=${simulation.personaBand}, crowd=${person.currentAvg ?? "-"})`);
        }
      }

      if (!voted) {
        log(`[VoteWorker] ${agent.displayName} found no eligible polls/matchups to vote on`);
      }
    } catch (err) {
      log(`[VoteWorker] Error processing agent ${agent.displayName}: ${err}`);
    }
  }

  return results;
}

// ── Scheduler ──────────────────────────────────────────────────────────

function getRandomHourMs(): number {
  const minHour = 8;
  const maxHour = 22;
  const hour = minHour + Math.floor(Math.random() * (maxHour - minHour));
  const minute = Math.floor(Math.random() * 60);
  return (hour * 60 + minute) * 60 * 1000;
}

function msUntilNextSweep(): number {
  const now = new Date();
  const todayMidnightUtc = new Date(now);
  todayMidnightUtc.setUTCHours(0, 0, 0, 0);

  const targetMs = todayMidnightUtc.getTime() + getRandomHourMs();

  if (targetMs > now.getTime()) {
    return targetMs - now.getTime();
  }
  const tomorrowMidnight = new Date(todayMidnightUtc);
  tomorrowMidnight.setUTCDate(tomorrowMidnight.getUTCDate() + 1);
  return tomorrowMidnight.getTime() + getRandomHourMs() - now.getTime();
}

function scheduleNextSweep() {
  const delayMs = msUntilNextSweep();
  const hours = (delayMs / 3_600_000).toFixed(1);
  log(`[VoteWorker] Next sweep in ${hours}h`);

  setTimeout(async () => {
    try {
      const results = await runVoteSweep();
      log(`[VoteWorker] Sweep complete: ${results.length} votes cast`);
    } catch (e) {
      console.error("[VoteWorker] Sweep failed:", e);
    }
    scheduleNextSweep();
  }, delayMs);
}

export function startVoteWorkerScheduler(): void {
  log(`[VoteWorker] Starting (${BOOT_DELAY_MS / 1000}s boot delay, daily sweep at random hour 08-22 UTC)`);

  setTimeout(() => {
    runVoteSweep()
      .then((results) => {
        log(`[VoteWorker] Initial sweep: ${results.length} votes cast`);
        scheduleNextSweep();
      })
      .catch((e) => {
        console.error("[VoteWorker] Initial sweep failed:", e);
        scheduleNextSweep();
      });
  }, BOOT_DELAY_MS);
}
