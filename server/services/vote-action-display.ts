/**
 * Enriches vote_actions rows with admin/user-facing titles and links.
 */

import { db } from "../db";
import {
  comments,
  inductionCandidates,
  matchups,
  opinionPollOptions,
  opinionPolls,
  trackedPeople,
  trendingPolls,
  type VoteAction,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  asMetadata,
  truncateLedgerLabel,
} from "@shared/lib/credit-history-display";
import {
  buildVoteActionDisplay,
  type VoteActionDisplayContext,
  type VoteActionDisplayFields,
} from "@shared/lib/vote-action-display";

export type { VoteActionDisplayFields } from "@shared/lib/vote-action-display";
export { buildVoteActionDisplay } from "@shared/lib/vote-action-display";

export type EnrichedVoteActionRow = VoteAction & VoteActionDisplayFields;

export async function enrichVoteActionRows(
  entries: VoteAction[],
): Promise<EnrichedVoteActionRow[]> {
  if (entries.length === 0) return [];

  const personIds = new Set<string>();
  const matchupIds = new Set<string>();
  const trendingPollIds = new Set<string>();
  const opinionPollIds = new Set<string>();
  const opinionOptionIds = new Set<string>();
  const inductionIds = new Set<string>();
  const commentIds = new Set<string>();
  const insightIds = new Set<string>();

  for (const row of entries) {
    const meta = asMetadata(row.metadata);
    const { voteType, targetId, prevValue, nextValue } = row;

    switch (voteType) {
      case "face_off":
        matchupIds.add(targetId);
        break;
      case "sentiment":
      case "value_vote":
      case "image_curate":
      case "overall_rating":
        personIds.add(targetId);
        break;
      case "trending_poll":
        trendingPollIds.add(targetId);
        break;
      case "opinion_poll":
        opinionPollIds.add(targetId);
        if (prevValue) opinionOptionIds.add(prevValue);
        if (nextValue) opinionOptionIds.add(nextValue);
        break;
      case "induction":
        inductionIds.add(targetId);
        break;
      case "comment_vote":
        commentIds.add(targetId);
        break;
      case "insight_vote":
        insightIds.add(targetId);
        break;
      default: {
        const pid = meta?.personId;
        if (typeof pid === "string") personIds.add(pid);
        break;
      }
    }
  }

  const [
    personRows,
    matchupRows,
    trendingRows,
    opinionPollRows,
    optionRows,
    inductionRows,
    commentRows,
    insightRows,
  ] = await Promise.all([
    personIds.size > 0
      ? db
          .select({ id: trackedPeople.id, name: trackedPeople.name })
          .from(trackedPeople)
          .where(inArray(trackedPeople.id, [...personIds]))
      : Promise.resolve([]),
    matchupIds.size > 0
      ? db
          .select({
            id: matchups.id,
            title: matchups.title,
            slug: matchups.slug,
            optionAText: matchups.optionAText,
            optionBText: matchups.optionBText,
          })
          .from(matchups)
          .where(inArray(matchups.id, [...matchupIds]))
      : Promise.resolve([]),
    trendingPollIds.size > 0
      ? db
          .select({
            id: trendingPolls.id,
            headline: trendingPolls.headline,
            slug: trendingPolls.slug,
          })
          .from(trendingPolls)
          .where(inArray(trendingPolls.id, [...trendingPollIds]))
      : Promise.resolve([]),
    opinionPollIds.size > 0
      ? db
          .select({
            id: opinionPolls.id,
            title: opinionPolls.title,
            slug: opinionPolls.slug,
          })
          .from(opinionPolls)
          .where(inArray(opinionPolls.id, [...opinionPollIds]))
      : Promise.resolve([]),
    opinionOptionIds.size > 0
      ? db
          .select({
            id: opinionPollOptions.id,
            name: opinionPollOptions.name,
          })
          .from(opinionPollOptions)
          .where(inArray(opinionPollOptions.id, [...opinionOptionIds]))
      : Promise.resolve([]),
    inductionIds.size > 0
      ? db
          .select({
            id: inductionCandidates.id,
            displayName: inductionCandidates.displayName,
          })
          .from(inductionCandidates)
          .where(inArray(inductionCandidates.id, [...inductionIds]))
      : Promise.resolve([]),
    commentIds.size > 0
      ? db
          .select({ id: comments.id, body: comments.body })
          .from(comments)
          .where(inArray(comments.id, [...commentIds]))
      : Promise.resolve([]),
    insightIds.size > 0
      ? db
          .select({
            id: comments.id,
            content: comments.body,
            personId: comments.parentId,
            personName: trackedPeople.name,
          })
          .from(comments)
          .innerJoin(trackedPeople, eq(comments.parentId, trackedPeople.id))
          .where(and(
            inArray(comments.id, [...insightIds]),
            eq(comments.parentType, "community_insight"),
          ))
      : Promise.resolve([]),
  ]);

  const personMap = new Map(personRows.map((p) => [p.id, p]));
  const matchupMap = new Map(matchupRows.map((m) => [m.id, m]));
  const trendingMap = new Map(trendingRows.map((p) => [p.id, p]));
  const opinionPollMap = new Map(opinionPollRows.map((p) => [p.id, p]));
  const optionMap = new Map(optionRows.map((o) => [o.id, o]));
  const inductionMap = new Map(inductionRows.map((c) => [c.id, c]));
  const commentMap = new Map(commentRows.map((c) => [c.id, c]));
  const insightMap = new Map(insightRows.map((i) => [i.id, i]));

  return entries.map((row) => {
    const context = resolveVoteActionContext(row, {
      personMap,
      matchupMap,
      trendingMap,
      opinionPollMap,
      optionMap,
      inductionMap,
      commentMap,
      insightMap,
    });
    const fields = buildVoteActionDisplay(
      {
        voteType: row.voteType,
        actionKind: row.actionKind,
        targetId: row.targetId,
        prevValue: row.prevValue,
        nextValue: row.nextValue,
        metadata: asMetadata(row.metadata),
      },
      context,
    );
    return { ...row, ...fields };
  });
}

function resolveVoteActionContext(
  row: VoteAction,
  maps: {
    personMap: Map<string, { name: string }>;
    matchupMap: Map<
      string,
      {
        title: string;
        slug: string | null;
        optionAText: string;
        optionBText: string;
      }
    >;
    trendingMap: Map<string, { headline: string; slug: string | null }>;
    opinionPollMap: Map<string, { title: string; slug: string | null }>;
    optionMap: Map<string, { name: string }>;
    inductionMap: Map<string, { displayName: string }>;
    commentMap: Map<string, { body: string }>;
    insightMap: Map<
      string,
      { content: string; personId: string; personName: string }
    >;
  },
): VoteActionDisplayContext {
  const { voteType, targetId, prevValue, nextValue, actionKind } = row;
  const activeOptionId =
    actionKind === "remove" ? prevValue : (nextValue ?? prevValue);

  switch (voteType) {
    case "face_off": {
      const m = maps.matchupMap.get(targetId);
      return {
        matchupTitle: m?.title ?? null,
        matchupSlug: m?.slug ?? null,
        optionAText: m?.optionAText ?? null,
        optionBText: m?.optionBText ?? null,
      };
    }
    case "sentiment":
    case "value_vote":
    case "image_curate":
    case "overall_rating": {
      const p = maps.personMap.get(targetId);
      return { personName: p?.name ?? null, personId: targetId };
    }
    case "trending_poll": {
      const poll = maps.trendingMap.get(targetId);
      return {
        pollHeadline: poll?.headline ?? null,
        trendingPollSlug: poll?.slug ?? null,
      };
    }
    case "opinion_poll": {
      const poll = maps.opinionPollMap.get(targetId);
      const opt = activeOptionId
        ? maps.optionMap.get(activeOptionId)
        : undefined;
      return {
        pollTitle: poll?.title ?? null,
        opinionPollSlug: poll?.slug ?? null,
        optionName: opt?.name ?? null,
      };
    }
    case "induction": {
      const c = maps.inductionMap.get(targetId);
      return { candidateName: c?.displayName ?? null };
    }
    case "comment_vote": {
      const c = maps.commentMap.get(targetId);
      return {
        commentSnippet: c?.body
          ? truncateLedgerLabel(c.body, 48)
          : null,
      };
    }
    case "insight_vote": {
      const i = maps.insightMap.get(targetId);
      return {
        insightSnippet: i?.content
          ? truncateLedgerLabel(i.content, 48)
          : null,
        insightPersonName: i?.personName ?? null,
        insightPersonId: i?.personId ?? null,
      };
    }
    default:
      return {};
  }
}
