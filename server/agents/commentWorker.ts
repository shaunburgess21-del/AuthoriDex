/**
 * Sparse comment worker for simulated agents. It writes directly through the
 * unified comments table after resolving live parent rows, keeping volume low
 * and capped per persona.
 */

import { and, count, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import {
  agentConfigs,
  comments as unifiedComments,
  matchups,
  opinionPolls,
  predictionMarkets,
  profiles,
  trendingPolls,
} from "@shared/schema";
import { db } from "../db";
import { log } from "../log";
import {
  getSimulationProfile,
  isV2SimulationProfile,
  type AgentSimulationProfile,
} from "./simulationProfile";

const COMMENT_WORKER_BOOT_DELAY_MS = 7 * 60_000;

type CommentParentType = "matchup" | "trending_poll" | "opinion_poll" | "open_market";

interface EligibleCommentParent {
  parentType: CommentParentType;
  parentId: string;
  title: string;
  category: string | null;
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

async function countAgentCommentsThisWeek(userId: string): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(unifiedComments)
    .where(
      and(
        eq(unifiedComments.userId, userId),
        gte(unifiedComments.createdAt, getMondayOfWeek()),
        sql`${unifiedComments.deletedAt} IS NULL`,
      ),
    );
  return Number(row?.c ?? 0);
}

async function getEligibleParents(userId: string): Promise<EligibleCommentParent[]> {
  const now = new Date();
  const [faceOffs, trendPolls, opinion, markets] = await Promise.all([
    db
      .select({
        parentId: matchups.id,
        title: matchups.title,
        category: matchups.category,
      })
      .from(matchups)
      .where(and(eq(matchups.isActive, true), eq(matchups.visibility, "live")))
      .orderBy(desc(matchups.createdAt))
      .limit(30),
    db
      .select({
        parentId: trendingPolls.id,
        title: trendingPolls.headline,
        category: trendingPolls.category,
      })
      .from(trendingPolls)
      .where(eq(trendingPolls.visibility, "live"))
      .orderBy(desc(trendingPolls.createdAt))
      .limit(30),
    db
      .select({
        parentId: opinionPolls.id,
        title: opinionPolls.title,
        category: opinionPolls.category,
      })
      .from(opinionPolls)
      .where(eq(opinionPolls.visibility, "live"))
      .orderBy(desc(opinionPolls.createdAt))
      .limit(30),
    // Only world markets that are still open AND haven't expired yet — agents
    // commenting on a market that closes in an hour reads as bot-like.
    db
      .select({
        parentId: predictionMarkets.id,
        title: predictionMarkets.title,
        category: predictionMarkets.category,
      })
      .from(predictionMarkets)
      .where(and(
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.visibility, "live"),
        gt(predictionMarkets.endAt, now),
      ))
      .orderBy(desc(predictionMarkets.createdAt))
      .limit(30),
  ]);

  const parents: EligibleCommentParent[] = [
    ...faceOffs.map((row) => ({ ...row, parentType: "matchup" as const })),
    ...trendPolls.map((row) => ({ ...row, parentType: "trending_poll" as const })),
    ...opinion.map((row) => ({ ...row, parentType: "opinion_poll" as const })),
    ...markets.map((row) => ({ ...row, parentType: "open_market" as const })),
  ];

  if (!parents.length) return [];

  const parentIds = parents.map((parent) => parent.parentId);
  const existing = await db
    .select({
      parentType: unifiedComments.parentType,
      parentId: unifiedComments.parentId,
    })
    .from(unifiedComments)
    .where(
      and(
        eq(unifiedComments.userId, userId),
        inArray(unifiedComments.parentId, parentIds),
        sql`${unifiedComments.deletedAt} IS NULL`,
      ),
    );
  const alreadyCommented = new Set(existing.map((row) => `${row.parentType}:${row.parentId}`));

  return parents.filter((parent) => !alreadyCommented.has(`${parent.parentType}:${parent.parentId}`));
}

function chooseParent(parents: EligibleCommentParent[], profile: AgentSimulationProfile): EligibleCommentParent {
  const preferred = parents.filter((parent) => parent.category && profile.favoriteCategories.includes(parent.category));
  const pool = preferred.length > 0 && Math.random() < 0.7 ? preferred : parents;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Comment template pool. Each style has a wide pool so 56 agents posting
// once or twice a week don't end up echoing the same line on different cards.
const COMMENT_TEMPLATES_BY_STYLE = {
  short: [
    "Close one.",
    "Tight call.",
    "Need to see more movement first.",
    "This could tighten quickly.",
    "Small lean here.",
    "Feels underpriced.",
    "Slight overcorrection.",
    "Not the price I want yet.",
    "Sitting on this for now.",
    "Coin flip.",
    "Could swing fast.",
    "Watching the next move.",
    "Holding off.",
    "Tempting at this number.",
    "Nope, too rich.",
    "Solid spot.",
    "I'd want a better number.",
    "Mild lean, no size.",
  ],
  casual: [
    "I can see this going either way, but the current split feels a bit light.",
    "Not sure the market has fully caught up on this yet.",
    "This one feels like it depends on the next couple of days.",
    "I like the angle, but not at any price.",
    "Could be a lot closer than it looks.",
    "Honestly the chatter on this one is louder than the evidence.",
    "Going to wait for the dust to settle.",
    "I keep going back and forth on this.",
    "The vibe feels off vs the numbers.",
    "Funny how confident some people are here.",
    "I'd nibble at a slightly worse price.",
    "Not feeling the conviction yet.",
    "Feels like it's about to move, just not sure which way.",
    "I'll be honest, I have no real read here.",
    "Could be a sleeper, could be nothing.",
  ],
  skeptical: [
    "Feels like people are chasing the obvious side here.",
    "I don't love the crowd read on this.",
    "Would not be shocked if this flips.",
    "This is getting a bit crowded for me.",
    "The easy take might be the wrong one.",
    "Hot takes on this one are doing a lot of heavy lifting.",
    "Hard pass at these numbers.",
    "Calling it now: the favourite is overvalued.",
    "Half the people in here are just following the herd.",
    "I need someone to convince me this isn't already priced.",
    "Yeah, I'm fading the consensus here.",
    "Looks like a trap to me.",
    "The narrative is louder than the data.",
    "Don't love how clean this looks.",
    "Smells like a recency-bias play.",
  ],
  analytical: [
    "Price matters here. I would rather wait unless the edge widens.",
    "The setup is interesting, but I need a cleaner signal before sizing up.",
    "Current odds look a little ahead of the evidence.",
    "I am treating this as a small edge, not a lock.",
    "The category trend matters more than the headline on this one.",
    "Implied probability looks ~5 points off where I'd model it.",
    "Two-way market, but the priors feel mispriced.",
    "Need to see another data point before I commit size.",
    "If the price drifts another tick I'm interested.",
    "Skill-weighted, this is a marginal play.",
    "Reasonable EV, but the variance is wide here.",
    "I'd rather be small and right than big and wrong on this one.",
    "Tracking, not buying yet.",
    "This is the kind of spot that resolves on a single news cycle.",
    "The base rate disagrees with the price.",
  ],
} satisfies Record<AgentSimulationProfile["commentStyle"], string[]>;

const CATEGORY_HOOKS: Record<string, string[]> = {
  sports: [
    "Performance over headlines for this one.",
    "Form lines matter more than the chatter.",
    "Stat-wise I'm not seeing the conviction.",
  ],
  music: [
    "Streams will move the needle more than the headlines.",
    "Charts cycle fast — easy to overrate a one-week spike.",
    "The release schedule alone tells a story.",
  ],
  entertainment: [
    "Press cycles flatter to deceive on these.",
    "The fan-base intensity is doing more than people think.",
    "Watch the secondary coverage, not the front page.",
  ],
  creator: [
    "Algorithm sentiment moves faster than the actual numbers.",
    "Creator economy stuff is always thinner than it looks.",
    "Keep an eye on subscriber retention, not just spikes.",
  ],
  business: [
    "Fundamentals don't move at the pace of headlines.",
    "Earnings cycle could swing this either way.",
    "The macro overlay matters more than the company story here.",
  ],
  politics: [
    "Polling noise is wild this close to the deadline.",
    "Narrative momentum and actual votes are different things.",
    "Late-cycle moves rarely follow the early consensus.",
  ],
  tech: [
    "Product cycles don't care about momentum traders.",
    "Adoption curves are slower than the chatter implies.",
    "Watch the launch quality, not the keynote.",
  ],
};

const REPLY_TAILS = [
  "Curious how this resolves.",
  "Will watch closely.",
  "Open to being wrong.",
  "Not married to it.",
  "Could change my mind on a single update.",
];

function pickFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildComment(profile: AgentSimulationProfile, parent: EligibleCommentParent): string {
  const options = COMMENT_TEMPLATES_BY_STYLE[profile.commentStyle];
  let body = pickFrom(options);

  // Roughly 30% of the time, layer in a category-aware sentence so comments
  // don't read like generic platitudes copy-pasted across topics.
  const categoryHooks = parent.category ? CATEGORY_HOOKS[parent.category] : undefined;
  if (categoryHooks && Math.random() < 0.3) {
    body = `${body} ${pickFrom(categoryHooks)}`;
  }

  // Analytical agents on world markets sometimes add a softer reply tail
  // ("Curious how this resolves.") to feel less mechanical.
  if (parent.parentType === "open_market" && profile.commentStyle === "analytical" && Math.random() < 0.5) {
    body = `${body} ${pickFrom(REPLY_TAILS)}`;
  }

  return body;
}

export async function runCommentSweep(): Promise<{ posted: number; skipped: number }> {
  const agents = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.isActive, true));

  // Shuffle so the same agents don't always go first and dominate the
  // small daily eligibility pool.
  for (let i = agents.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [agents[i], agents[j]] = [agents[j], agents[i]];
  }

  let posted = 0;
  let skipped = 0;

  for (const agent of agents) {
    if (!isV2SimulationProfile(agent.simulationProfile)) {
      skipped++;
      continue;
    }

    const simulation = getSimulationProfile(agent.simulationProfile);
    if (Math.random() > simulation.dailyCommentChance) {
      skipped++;
      continue;
    }

    const weeklyCount = await countAgentCommentsThisWeek(agent.userId);
    if (weeklyCount >= simulation.weeklyCommentCap) {
      skipped++;
      continue;
    }

    const parents = await getEligibleParents(agent.userId);
    if (!parents.length) {
      skipped++;
      continue;
    }

    const parent = chooseParent(parents, simulation);
    const body = buildComment(simulation, parent);

    try {
      await db.transaction(async (tx) => {
        await tx.insert(unifiedComments).values({
          parentType: parent.parentType,
          parentId: parent.parentId,
          userId: agent.userId,
          body,
        });
        await tx
          .update(profiles)
          .set({ lastActiveAt: new Date() })
          .where(eq(profiles.id, agent.userId));
      });
      posted++;
      log(`[CommentWorker] ${agent.displayName} commented on ${parent.parentType}:${parent.parentId}`);
    } catch (err) {
      skipped++;
      log(`[CommentWorker] Failed for ${agent.displayName}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { posted, skipped };
}

function msUntilNextSweep(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(now.getUTCDate() + 1);
  tomorrow.setUTCHours(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);
  return Math.max(60_000, tomorrow.getTime() - now.getTime());
}

function scheduleNextSweep(): void {
  const delay = msUntilNextSweep();
  log(`[CommentWorker] Next sweep in ${(delay / 3_600_000).toFixed(1)}h`);
  setTimeout(async () => {
    try {
      const result = await runCommentSweep();
      log(`[CommentWorker] Sweep complete: ${result.posted} posted, ${result.skipped} skipped`);
    } catch (err) {
      console.error("[CommentWorker] Sweep failed:", err);
    }
    scheduleNextSweep();
  }, delay);
}

export function startCommentWorkerScheduler(): void {
  log(`[CommentWorker] Starting (${COMMENT_WORKER_BOOT_DELAY_MS / 1000}s boot delay, sparse daily sweep)`);
  setTimeout(async () => {
    try {
      const result = await runCommentSweep();
      log(`[CommentWorker] Initial sweep: ${result.posted} posted, ${result.skipped} skipped`);
    } catch (err) {
      console.error("[CommentWorker] Initial sweep failed:", err);
    }
    scheduleNextSweep();
  }, COMMENT_WORKER_BOOT_DELAY_MS);
}
