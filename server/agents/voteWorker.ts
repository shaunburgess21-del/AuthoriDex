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
  sentimentVotes,
  trendingPeople,
} from "@shared/schema";
import { eq, and, sql, gte, count, desc } from "drizzle-orm";
import { log } from "../log";
import { gamificationService } from "../services/gamification";

const WEEKLY_VOTE_CAP = 3;
const DAILY_SKIP_PROBABILITY = 0.50;
const BOOT_DELAY_MS = 180_000; // 3 minutes after boot

type VoteType = "matchup" | "sentiment_poll" | "underrated_overrated";

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

  return (
    Number(matchupCount?.c || 0) +
    Number(pollCount?.c || 0) +
    Number(sentimentCount?.c || 0)
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
  return active.filter((m) => !votedSet.has(m.id));
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
  return Math.random() < aRatio ? "option_b" : "option_a";
}

// ── Sentiment poll (trending poll) voting ──────────────────────────────

async function getEligibleSentimentPolls(userId: string) {
  const active = await db
    .select({
      id: trendingPolls.id,
      category: trendingPolls.category,
      headline: trendingPolls.headline,
      seedSupportCount: trendingPolls.seedSupportCount,
      seedNeutralCount: trendingPolls.seedNeutralCount,
      seedOpposeCount: trendingPolls.seedOpposeCount,
    })
    .from(trendingPolls)
    .where(eq(trendingPolls.visibility, "live"));

  const alreadyVoted = await db
    .select({ pollId: trendingPollVotes.pollId })
    .from(trendingPollVotes)
    .where(eq(trendingPollVotes.userId, userId));

  const votedSet = new Set(alreadyVoted.map((v) => v.pollId));
  return active.filter((p) => !votedSet.has(p.id));
}

async function getPollCrowdSplit(pollId: string) {
  const results = await db
    .select({ choice: trendingPollVotes.choice, c: count() })
    .from(trendingPollVotes)
    .where(eq(trendingPollVotes.pollId, pollId))
    .groupBy(trendingPollVotes.choice);

  return {
    support: Number(results.find((r) => r.choice === "support")?.c || 0),
    neutral: Number(results.find((r) => r.choice === "neutral")?.c || 0),
    oppose: Number(results.find((r) => r.choice === "oppose")?.c || 0),
  };
}

function decideSentimentPoll(
  agent: { contrarianism: number },
  poll: { seedSupportCount: number; seedNeutralCount: number; seedOpposeCount: number },
  crowd: { support: number; neutral: number; oppose: number }
): "support" | "neutral" | "oppose" {
  const s = crowd.support + (poll.seedSupportCount || 0);
  const n = crowd.neutral + (poll.seedNeutralCount || 0);
  const o = crowd.oppose + (poll.seedOpposeCount || 0);
  const total = s + n + o;

  if (Math.random() < 0.15) return "neutral";

  if (total === 0) {
    const r = Math.random();
    return r < 0.45 ? "support" : r < 0.90 ? "oppose" : "neutral";
  }

  const supportRatio = s / total;
  const opposeRatio = o / total;

  if (agent.contrarianism > 0.6) {
    return supportRatio > opposeRatio ? "oppose" : "support";
  }
  return supportRatio >= opposeRatio ? "support" : "oppose";
}

// ── Underrated/Overrated voting ────────────────────────────────────────

async function getEligiblePeopleForSentiment(userId: string) {
  const today = new Date().toISOString().split("T")[0];

  const people = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
      category: trendingPeople.category,
      trendScore: trendingPeople.trendScore,
    })
    .from(trendingPeople)
    .orderBy(desc(trendingPeople.trendScore))
    .limit(50);

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

// ── Main sweep ─────────────────────────────────────────────────────────

async function runVoteSweep(): Promise<AgentVoteResult[]> {
  const agents = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.isActive, true));

  if (!agents.length) {
    log("[VoteWorker] No active agents found");
    return [];
  }

  const results: AgentVoteResult[] = [];

  for (const agent of agents) {
    try {
      const weeklyCount = await countAgentVotesThisWeek(agent.userId);
      if (weeklyCount >= WEEKLY_VOTE_CAP) {
        log(`[VoteWorker] ${agent.displayName} at weekly cap (${weeklyCount}/${WEEKLY_VOTE_CAP}), skipping`);
        continue;
      }

      if (Math.random() < DAILY_SKIP_PROBABILITY) {
        log(`[VoteWorker] ${agent.displayName} randomly skipped today`);
        continue;
      }

      const contrarianism = Number(agent.contrarianism);
      const prestigeBias = Number(agent.prestigeBias);
      const specialties = agent.specialties || [];

      const voteTypes: VoteType[] = ["matchup", "sentiment_poll", "underrated_overrated"];
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

          const matchup = eligible[Math.floor(Math.random() * eligible.length)];
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

          const poll = eligible[Math.floor(Math.random() * eligible.length)];
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

          results.push({
            agentName: agent.displayName,
            voteType: "sentiment_poll",
            target: poll.headline,
            choice,
            xpAwarded,
          });
          voted = true;
          log(`[VoteWorker] ${agent.displayName} voted "${choice}" on poll "${poll.headline}" (+${xpAwarded} XP)`);
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

          results.push({
            agentName: agent.displayName,
            voteType: "underrated_overrated",
            target: person.name,
            choice,
            xpAwarded,
          });
          voted = true;
          log(`[VoteWorker] ${agent.displayName} voted "${choice}" on ${person.name} (+${xpAwarded} XP)`);
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
