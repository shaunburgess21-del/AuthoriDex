/**
 * Sparse comment-vote (like / dislike) worker for simulated agents.
 *
 * Comment voting is the lowest-barrier engagement signal we have, so this
 * exists as a separate, very light, no-LLM sweep that runs daily AFTER
 * the main comment sweep. The result: top-take badges and upvote counts
 * accumulate organically instead of every comment sitting at zero.
 *
 * Design:
 *   - No LLM. Pure deterministic selection. Cost = $0.
 *   - Heavy upvote bias (90/10) — humans rarely downvote.
 *   - Per-persona daily chance and per-day cap, derived from personaBand
 *     so we don't need a schema change.
 *   - Platform-wide ceiling per sweep so a misconfig can't flood.
 *   - Mirrors the human upvote insert exactly (commentVotes row +
 *     denormalised counter on the comment row) so existing UI stays
 *     consistent. Unique (userId, commentId) constraint prevents dupes.
 */

import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  agentConfigs,
  comments as unifiedComments,
  commentVotes,
  profiles,
} from "@shared/schema";
import { db } from "../db";
import { log } from "../log";
import {
  getSimulationProfile,
  isV2SimulationProfile,
  type AgentSimulationProfile,
  type SimulationPersonaBand,
} from "./simulationProfile";

const COMMENT_VOTE_WORKER_BOOT_DELAY_MS = 9 * 60_000;
const MAX_LIKES_PER_SWEEP = 60;
const RECENT_WINDOW_DAYS = 7;

/** Per-persona behaviour. liquidity/noisy are clicky; whale/sharp are
 *  picky. The {chance} is the daily probability of liking ANYTHING; the
 *  {max} is the upper bound on likes that day if they're active. */
const PERSONA_LIKE_BEHAVIOUR: Record<
  SimulationPersonaBand,
  { chance: number; min: number; max: number }
> = {
  liquidity: { chance: 0.70, min: 1, max: 3 },
  noisy:     { chance: 0.55, min: 1, max: 3 },
  casual:    { chance: 0.40, min: 1, max: 2 },
  sharp:     { chance: 0.30, min: 1, max: 2 },
  whale:     { chance: 0.20, min: 1, max: 1 },
};

/** 10% of the time, a like flips to a dislike. Matches the realistic
 *  small minority of downvote behaviour you see on Polymarket / Reddit
 *  thread comments. */
const DOWNVOTE_RATE = 0.10;

/** Count likes this agent has cast in the last 24h. Used to skip agents
 *  that already hit their per-day target — important because a Railway
 *  redeploy fires a fresh boot sweep, and without this guard the same
 *  agent could vote 2-3× their daily quota across multiple deploys. */
async function countLikesLast24h(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ c: count() })
    .from(commentVotes)
    .where(
      and(
        eq(commentVotes.userId, userId),
        gte(commentVotes.votedAt, cutoff),
      ),
    );
  return Number(row?.c ?? 0);
}

/** Pool of recent comments that this agent could potentially vote on:
 *   - Not their own
 *   - Not deleted
 *   - Posted in the last RECENT_WINDOW_DAYS days
 *   - Not already voted on by them */
async function getCandidateComments(userId: string): Promise<Array<{
  id: string;
  parentType: string;
  parentId: string;
  authorUserId: string;
}>> {
  const cutoff = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Pull the most recent ~150 candidate comments. Then filter out ones
  // this agent has already voted on. (Cheaper than a NOT EXISTS join on
  // the typical 100-row scan.)
  const candidates = await db
    .select({
      id: unifiedComments.id,
      parentType: unifiedComments.parentType,
      parentId: unifiedComments.parentId,
      authorUserId: unifiedComments.userId,
    })
    .from(unifiedComments)
    .where(
      and(
        sql`${unifiedComments.deletedAt} IS NULL`,
        sql`${unifiedComments.userId} != ${userId}`,
        sql`${unifiedComments.createdAt} >= ${cutoff}`,
      ),
    )
    .orderBy(desc(unifiedComments.createdAt))
    .limit(150);

  if (!candidates.length) return [];

  const candidateIds = candidates.map((c) => c.id);
  const alreadyVoted = await db
    .select({ commentId: commentVotes.commentId })
    .from(commentVotes)
    .where(
      and(
        eq(commentVotes.userId, userId),
        inArray(commentVotes.commentId, candidateIds),
      ),
    );
  const blocked = new Set(alreadyVoted.map((r) => r.commentId));

  return candidates.filter((c) => !blocked.has(c.id));
}

/** Weighted random pick that biases toward more recent comments (top of
 *  the array) — exactly mirrors how a human scrolls a feed. */
function pickWeighted<T>(pool: T[]): T {
  if (pool.length === 1) return pool[0];
  // Top 25% gets 60% of the weight; next 35% gets 30%; tail gets 10%.
  const r = Math.random();
  if (r < 0.60) {
    const slice = Math.max(1, Math.floor(pool.length * 0.25));
    return pool[Math.floor(Math.random() * slice)];
  }
  if (r < 0.90) {
    const start = Math.max(1, Math.floor(pool.length * 0.25));
    const end = Math.max(start + 1, Math.floor(pool.length * 0.60));
    return pool[start + Math.floor(Math.random() * (end - start))];
  }
  const start = Math.max(1, Math.floor(pool.length * 0.60));
  return pool[start + Math.floor(Math.random() * Math.max(1, pool.length - start))];
}

function pickVoteType(profile: AgentSimulationProfile): "up" | "down" {
  // Sharp/whale very rarely downvote (more reserved). Noisy more likely
  // to push the down button. Casual/liquidity stay near baseline.
  let downRate = DOWNVOTE_RATE;
  if (profile.personaBand === "sharp" || profile.personaBand === "whale") downRate *= 0.4;
  if (profile.personaBand === "noisy") downRate *= 1.6;
  return Math.random() < downRate ? "down" : "up";
}

export async function runCommentVoteSweep(): Promise<{
  cast: number;
  upvotes: number;
  downvotes: number;
  agentsParticipated: number;
  skipped: number;
  capReached: boolean;
}> {
  const agents = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.isActive, true));

  // Shuffle so the same agents don't always claim the freshest comments.
  for (let i = agents.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [agents[i], agents[j]] = [agents[j], agents[i]];
  }

  let cast = 0;
  let upvotes = 0;
  let downvotes = 0;
  let agentsParticipated = 0;
  let skipped = 0;
  let capReached = false;

  for (const agent of agents) {
    if (cast >= MAX_LIKES_PER_SWEEP) {
      capReached = true;
      skipped++;
      continue;
    }

    if (!isV2SimulationProfile(agent.simulationProfile)) {
      skipped++;
      continue;
    }
    const simulation = getSimulationProfile(agent.simulationProfile);
    const behaviour = PERSONA_LIKE_BEHAVIOUR[simulation.personaBand];

    if (Math.random() > behaviour.chance) {
      skipped++;
      continue;
    }

    // Deploy-storm guard: if this agent has already hit their per-day max
    // (from an earlier sweep that day, e.g. a previous boot), skip.
    const last24h = await countLikesLast24h(agent.userId);
    if (last24h >= behaviour.max) {
      skipped++;
      continue;
    }

    const pool = await getCandidateComments(agent.userId);
    if (!pool.length) {
      skipped++;
      continue;
    }

    const remainingDailyQuota = behaviour.max - last24h;
    const desiredLikes = behaviour.min + Math.floor(Math.random() * (behaviour.max - behaviour.min + 1));
    const targetLikes = Math.min(desiredLikes, remainingDailyQuota);
    const used = new Set<string>();
    let agentDidVote = false;

    for (let i = 0; i < targetLikes; i++) {
      if (cast >= MAX_LIKES_PER_SWEEP) {
        capReached = true;
        break;
      }
      const remaining = pool.filter((c) => !used.has(c.id));
      if (!remaining.length) break;

      const target = pickWeighted(remaining);
      used.add(target.id);
      const voteType = pickVoteType(simulation);

      try {
        // Insert WITHOUT onConflictDoNothing on purpose: if the unique
        // (userId, commentId) constraint fires, we want the transaction
        // to roll back so the denormalised counter doesn't drift. The
        // candidate filter already excludes already-voted comments, so
        // a conflict only happens in a tiny race window — treat it as
        // an error and skip rather than silently bump the count.
        await db.transaction(async (tx) => {
          await tx
            .insert(commentVotes)
            .values({
              commentId: target.id,
              userId: agent.userId,
              voteType,
            });
          await tx
            .update(unifiedComments)
            .set({
              upvotes: sql`${unifiedComments.upvotes} + ${voteType === "up" ? 1 : 0}`,
              downvotes: sql`${unifiedComments.downvotes} + ${voteType === "down" ? 1 : 0}`,
            })
            .where(eq(unifiedComments.id, target.id));
        });
        cast++;
        if (voteType === "up") upvotes++; else downvotes++;
        agentDidVote = true;
      } catch (err) {
        // Most common cause: unique violation from a concurrent vote.
        // Logged at debug level — not actionable.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/unique|duplicate/i.test(msg)) {
          log(`[CommentVoteWorker] Failed for ${agent.displayName} on comment ${target.id}: ${msg}`);
        }
      }
    }

    if (agentDidVote) {
      agentsParticipated++;
      try {
        await db
          .update(profiles)
          .set({ lastActiveAt: new Date() })
          .where(eq(profiles.id, agent.userId));
      } catch {
        // best-effort
      }
    } else {
      skipped++;
    }
  }

  return { cast, upvotes, downvotes, agentsParticipated, skipped, capReached };
}

function msUntilNextSweep(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(now.getUTCDate() + 1);
  // Stagger across 12-22 UTC so it doesn't overlap with the comment
  // sweep (9-19 UTC) — likes should follow the comments that day.
  tomorrow.setUTCHours(12 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);
  return Math.max(60_000, tomorrow.getTime() - now.getTime());
}

function scheduleNextSweep(): void {
  const delay = msUntilNextSweep();
  log(`[CommentVoteWorker] Next sweep in ${(delay / 3_600_000).toFixed(1)}h`);
  setTimeout(async () => {
    try {
      const result = await runCommentVoteSweep();
      log(`[CommentVoteWorker] Sweep complete: ${result.cast} cast (${result.upvotes}↑ / ${result.downvotes}↓), ${result.agentsParticipated} agents`);
    } catch (err) {
      console.error("[CommentVoteWorker] Sweep failed:", err);
    }
    scheduleNextSweep();
  }, delay);
}

export function startCommentVoteWorkerScheduler(): void {
  log(`[CommentVoteWorker] Starting (${COMMENT_VOTE_WORKER_BOOT_DELAY_MS / 1000}s boot delay, sparse daily sweep)`);
  setTimeout(async () => {
    try {
      const result = await runCommentVoteSweep();
      log(`[CommentVoteWorker] Initial sweep: ${result.cast} cast (${result.upvotes}↑ / ${result.downvotes}↓), ${result.agentsParticipated} agents`);
    } catch (err) {
      console.error("[CommentVoteWorker] Initial sweep failed:", err);
    }
    scheduleNextSweep();
  }, COMMENT_VOTE_WORKER_BOOT_DELAY_MS);
}
