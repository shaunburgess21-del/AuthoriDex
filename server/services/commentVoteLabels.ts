import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  marketBets,
  marketEntries,
  matchups,
  opinionPollOptions,
  opinionPollVotes,
  predictionMarkets,
  trendingPollVotes,
  userVotes,
  votes,
} from "@shared/schema";

export const COMMENT_PARENT_TYPES = [
  "community_insight",
  "matchup",
  "trending_poll",
  "opinion_poll",
  "open_market",
  "voices_post",
] as const;
export type CommentParentType = typeof COMMENT_PARENT_TYPES[number];

/**
 * Inline "voted" qualifier shown next to a comment/post author — the author's
 * own vote on the parent card (matchup option, poll choice, approval rating,
 * market position). Mirrors the client ParentVoteLabel union in
 * client/src/components/comments/types.ts.
 */
export type ParentVoteLabel =
  | { type: "trending_poll"; choice: string }
  | { type: "matchup"; choice: string; optionName: string }
  | { type: "opinion_poll"; optionName: string }
  | { type: "approval_rating"; rating: number }
  | { type: "open_market_binary"; side: "yes" | "no" }
  | { type: "open_market_multi"; optionName: string }
  | { type: "open_market_updown"; side: "above" | "below" }
  | null;

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function effectiveOpenMarketFlavor(openMarketType: string | null | undefined): "binary" | "multi" | "updown" {
  if (openMarketType === "binary" || openMarketType === "multi" || openMarketType === "updown") {
    return openMarketType;
  }
  return "multi";
}

function entryIsYesLikeBinary(label: string, displayOrder: number): boolean {
  const l = label.toLowerCase();
  return l === "yes" || l === "above" || displayOrder === 0;
}

function entryIsAboveUpdown(label: string, displayOrder: number): boolean {
  const l = label.toLowerCase();
  return l.includes("above") || l.includes("yes") || displayOrder === 0;
}

export async function getCommentParentVoteLabelMap(input: {
  parentType: CommentParentType;
  parentId: string;
  comments: Array<{ id: string; userId: string; deletedAt: Date | null }>;
}): Promise<Map<string, ParentVoteLabel>> {
  const liveComments = input.comments.filter(comment => !comment.deletedAt);
  const userIds = uniqueStrings(liveComments.map(comment => comment.userId));
  const labelByCommentId = new Map<string, ParentVoteLabel>();
  if (liveComments.length === 0 || userIds.length === 0) return labelByCommentId;

  const applyLabelsByUserId = (labelByUserId: Map<string, ParentVoteLabel>) => {
    for (const comment of liveComments) {
      labelByCommentId.set(comment.id, labelByUserId.get(comment.userId) ?? null);
    }
  };

  if (input.parentType === "trending_poll") {
    const parentVotes = await db
      .select({
        userId: trendingPollVotes.userId,
        choice: trendingPollVotes.choice,
      })
      .from(trendingPollVotes)
      .where(and(
        eq(trendingPollVotes.pollId, input.parentId),
        inArray(trendingPollVotes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => [
      vote.userId,
      { type: "trending_poll", choice: vote.choice },
    ])));
    return labelByCommentId;
  }

  if (input.parentType === "matchup") {
    const parentVotes = await db
      .select({
        userId: votes.userId,
        choice: votes.value,
        optionAName: matchups.optionAText,
        optionBName: matchups.optionBText,
      })
      .from(votes)
      .leftJoin(matchups, eq(matchups.id, votes.targetId))
      .where(and(
        eq(votes.voteType, "face_off"),
        eq(votes.targetType, "face_off"),
        eq(votes.targetId, input.parentId),
        inArray(votes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => {
      const optionName =
        vote.choice === "option_a"
          ? vote.optionAName
          : vote.choice === "option_b"
            ? vote.optionBName
            : "neutral";
      return [
        vote.userId,
        { type: "matchup", choice: vote.choice, optionName: optionName ?? "neutral" },
      ];
    })));
    return labelByCommentId;
  }

  if (input.parentType === "opinion_poll") {
    const parentVotes = await db
      .select({
        userId: opinionPollVotes.userId,
        optionName: opinionPollOptions.name,
      })
      .from(opinionPollVotes)
      .leftJoin(opinionPollOptions, eq(opinionPollOptions.id, opinionPollVotes.optionId))
      .where(and(
        eq(opinionPollVotes.pollId, input.parentId),
        inArray(opinionPollVotes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => [
      vote.userId,
      vote.optionName ? { type: "opinion_poll", optionName: vote.optionName } : null,
    ])));
    return labelByCommentId;
  }

  if (input.parentType === "community_insight") {
    // After the merge, parentId IS the personId — no insight lookup needed.
    const parentVotes = await db
      .select({
        userId: userVotes.userId,
        rating: userVotes.rating,
      })
      .from(userVotes)
      .where(and(
        eq(userVotes.personId, input.parentId),
        inArray(userVotes.userId, userIds),
      ));
    applyLabelsByUserId(new Map(parentVotes.map(vote => [
      vote.userId,
      { type: "approval_rating", rating: vote.rating },
    ])));
    return labelByCommentId;
  }

  if (input.parentType === "open_market") {
    const [marketRow] = await db
      .select({
        openMarketType: predictionMarkets.openMarketType,
        marketType: predictionMarkets.marketType,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, input.parentId))
      .limit(1);

    if (!marketRow || marketRow.marketType !== "community") {
      return labelByCommentId;
    }

    const flavor = effectiveOpenMarketFlavor(marketRow.openMarketType);

    const entries = await db
      .select({
        id: marketEntries.id,
        label: marketEntries.label,
        displayOrder: marketEntries.displayOrder,
      })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, input.parentId));

    const entryById = new Map(
      entries.map(e => [e.id, { label: e.label ?? "", displayOrder: e.displayOrder ?? 0 }]),
    );

    const bets = await db
      .select({
        userId: marketBets.userId,
        entryId: marketBets.entryId,
        direction: marketBets.direction,
        stakeAmount: marketBets.stakeAmount,
      })
      .from(marketBets)
      .where(and(
        eq(marketBets.marketId, input.parentId),
        eq(marketBets.status, "active"),
        inArray(marketBets.userId, userIds),
      ));

    type EntryStakes = { yesStake: number; noStake: number };
    const byUserEntry = new Map<string, Map<string, EntryStakes>>();
    for (const b of bets) {
      const uid = b.userId;
      const eid = b.entryId;
      const dir = b.direction === "no" ? "no" : "yes";
      const amt = Number(b.stakeAmount) || 0;
      if (!byUserEntry.has(uid)) byUserEntry.set(uid, new Map());
      const entryMap = byUserEntry.get(uid)!;
      const cur = entryMap.get(eid) ?? { yesStake: 0, noStake: 0 };
      if (dir === "yes") cur.yesStake += amt;
      else cur.noStake += amt;
      entryMap.set(eid, cur);
    }

    const labelByUserId = new Map<string, ParentVoteLabel>();

    for (const uid of userIds) {
      const entryMap = byUserEntry.get(uid);
      if (!entryMap || entryMap.size === 0) continue;

      let bestEntryId: string | null = null;
      let bestTotal = -1;
      for (const [eid, s] of entryMap) {
        const total = s.yesStake + s.noStake;
        if (total <= 0) continue;
        if (total > bestTotal || (total === bestTotal && bestEntryId !== null && eid < bestEntryId)) {
          bestTotal = total;
          bestEntryId = eid;
        }
      }

      if (!bestEntryId || bestTotal <= 0) continue;

      const meta = entryById.get(bestEntryId);
      if (!meta) continue;

      const stakes = entryMap.get(bestEntryId)!;

      let lbl: Exclude<ParentVoteLabel, null>;
      if (flavor === "multi") {
        lbl = { type: "open_market_multi", optionName: meta.label.trim() || "—" };
      } else {
        const dominantDir: "yes" | "no" =
          stakes.yesStake > stakes.noStake
            ? "yes"
            : stakes.noStake > stakes.yesStake
              ? "no"
              : "yes";
        if (flavor === "binary") {
          const yesLike = entryIsYesLikeBinary(meta.label, meta.displayOrder);
          const semanticYes = (yesLike && dominantDir === "yes") || (!yesLike && dominantDir === "no");
          lbl = { type: "open_market_binary", side: semanticYes ? "yes" : "no" };
        } else {
          const aboveLike = entryIsAboveUpdown(meta.label, meta.displayOrder);
          const semanticAbove = (aboveLike && dominantDir === "yes") || (!aboveLike && dominantDir === "no");
          lbl = { type: "open_market_updown", side: semanticAbove ? "above" : "below" };
        }
      }

      labelByUserId.set(uid, lbl);
    }

    applyLabelsByUserId(labelByUserId);
    return labelByCommentId;
  }

  return labelByCommentId;
}

/**
 * Batch variant for surfaces with mixed parents (Voices feed): groups items
 * by (parentType, parentId), resolves each group's labels, and returns a map
 * keyed by item id. `voices_post` items resolve to null (no card vote).
 */
export async function getVoteLabelsForItems(items: Array<{
  id: string;
  userId: string;
  parentType: CommentParentType;
  parentId: string;
}>): Promise<Map<string, ParentVoteLabel>> {
  const groups = new Map<string, {
    parentType: CommentParentType;
    parentId: string;
    comments: Array<{ id: string; userId: string; deletedAt: Date | null }>;
  }>();

  for (const item of items) {
    if (item.parentType === "voices_post") continue;
    const key = `${item.parentType}:${item.parentId}`;
    let group = groups.get(key);
    if (!group) {
      group = { parentType: item.parentType, parentId: item.parentId, comments: [] };
      groups.set(key, group);
    }
    group.comments.push({ id: item.id, userId: item.userId, deletedAt: null });
  }

  const labelByItemId = new Map<string, ParentVoteLabel>();
  const groupMaps = await Promise.all(
    Array.from(groups.values()).map(group => getCommentParentVoteLabelMap(group)),
  );
  for (const groupMap of groupMaps) {
    for (const [itemId, label] of groupMap) {
      labelByItemId.set(itemId, label);
    }
  }
  return labelByItemId;
}
