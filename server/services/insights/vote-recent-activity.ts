/**
 * Recent vote activity feed for Insights Vote tab.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  matchups,
  opinionPollOptions,
  opinionPolls,
  profiles,
  trackedPeople,
  trendingPolls,
} from "@shared/schema";
import type { VoteFeedItem } from "@shared/insights/types";
import { VOTE_SURFACE_LABELS } from "@shared/insights/constants";
import { memoizeAsync } from "./request-memo";

export const VOTE_RECENT_ACTIVITY_MEMO_MS = 20_000;

type RawFeedRow = {
  id: string;
  user_id: string;
  surface: string;
  target_id: string;
  ref_id: string | null;
  choice: string | null;
  voted_at: Date;
};

function mapRows(result: unknown): Record<string, unknown>[] {
  return (
    (Array.isArray(result)
      ? result
      : (result as { rows: Record<string, unknown>[] }).rows) ?? []
  );
}

function choiceLabelForFaceOff(value: string, matchup: { optionAText: string; optionBText: string }): string {
  if (value === "option_a") return matchup.optionAText;
  if (value === "option_b") return matchup.optionBText;
  if (value === "neutral") return "Neither";
  return value;
}

function choiceLabelForSentiment(choice: string): string {
  if (choice === "approve") return "Approve";
  if (choice === "oppose") return "Oppose";
  if (choice === "neutral") return "Neutral";
  return choice;
}

function revealActor(profile: {
  isAgent: boolean;
  isPublic: boolean | null;
  positionsPublic: boolean | null;
  username: string | null;
  avatarUrl: string | null;
}): { name: string; avatarUrl: string | null } {
  if (profile.isAgent) {
    return { name: profile.username || "Community member", avatarUrl: profile.avatarUrl };
  }
  const hidden = profile.isPublic === false || profile.positionsPublic === false;
  if (hidden) {
    return { name: "Private voter", avatarUrl: null };
  }
  return { name: profile.username || "Anonymous", avatarUrl: profile.avatarUrl };
}

export async function loadRecentVoteActivity(limit: number): Promise<VoteFeedItem[]> {
  const queryLimit = Math.max(1, Math.min(limit || 8, 50));
  const fetchLimit = Math.min(queryLimit * 3, 100);
  const cacheKey = `vote:recent-activity:${queryLimit}`;

  return memoizeAsync(cacheKey, VOTE_RECENT_ACTIVITY_MEMO_MS, async () => {
    const result = await db.execute(sql`
      SELECT * FROM (
        SELECT
          v.id,
          v.user_id,
          'face_off'::text AS surface,
          v.target_id,
          NULL::varchar AS ref_id,
          v.value AS choice,
          v.voted_at
        FROM votes v
        WHERE v.vote_type = 'face_off'
        UNION ALL
        SELECT
          tpv.id,
          tpv.user_id,
          'trending_poll',
          tpv.poll_id,
          NULL,
          tpv.choice,
          GREATEST(tpv.created_at, tpv.updated_at)
        FROM trending_poll_votes tpv
        UNION ALL
        SELECT
          opv.id,
          opv.user_id,
          'opinion_poll',
          opv.poll_id,
          opv.option_id,
          NULL,
          GREATEST(opv.created_at, opv.updated_at)
        FROM opinion_poll_votes opv
        UNION ALL
        SELECT
          uv.id,
          uv.user_id,
          'overall_rating',
          uv.person_id,
          NULL,
          uv.rating::text,
          uv.voted_at
        FROM user_votes uv
        UNION ALL
        SELECT
          cvv.id,
          cvv.user_id,
          'value_vote',
          cvv.celebrity_id,
          NULL,
          cvv.vote,
          GREATEST(cvv.created_at, cvv.updated_at)
        FROM celebrity_value_votes cvv
      ) recent
      ORDER BY voted_at DESC
      LIMIT ${fetchLimit}
    `);

    const rows = mapRows(result) as unknown as RawFeedRow[];
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const matchupIds = rows.filter((r) => r.surface === "face_off").map((r) => r.target_id);
    const sentimentPollIds = rows.filter((r) => r.surface === "trending_poll").map((r) => r.target_id);
    const opinionPollIds = rows.filter((r) => r.surface === "opinion_poll").map((r) => r.target_id);
    const opinionOptionIds = rows
      .filter((r) => r.surface === "opinion_poll" && r.ref_id)
      .map((r) => r.ref_id as string);
    const personIds = [
      ...rows.filter((r) => r.surface === "overall_rating" || r.surface === "value_vote").map((r) => r.target_id),
    ];

    const [
      profileRows,
      matchupRows,
      sentimentRows,
      opinionPollRows,
      opinionOptionRows,
      personRows,
    ] = await Promise.all([
      db
        .select({
          id: profiles.id,
          username: profiles.username,
          avatarUrl: profiles.avatarUrl,
          isAgent: profiles.isAgent,
          isPublic: profiles.isPublic,
          positionsPublic: profiles.positionsPublic,
        })
        .from(profiles)
        .where(and(inArray(profiles.id, userIds), eq(profiles.isHouse, false))),
      matchupIds.length > 0
        ? db
            .select({
              id: matchups.id,
              title: matchups.title,
              slug: matchups.slug,
              optionAText: matchups.optionAText,
              optionBText: matchups.optionBText,
              visibility: matchups.visibility,
            })
            .from(matchups)
            .where(inArray(matchups.id, matchupIds))
        : Promise.resolve([]),
      sentimentPollIds.length > 0
        ? db
            .select({
              id: trendingPolls.id,
              headline: trendingPolls.headline,
              slug: trendingPolls.slug,
              visibility: trendingPolls.visibility,
            })
            .from(trendingPolls)
            .where(inArray(trendingPolls.id, sentimentPollIds))
        : Promise.resolve([]),
      opinionPollIds.length > 0
        ? db
            .select({
              id: opinionPolls.id,
              title: opinionPolls.title,
              slug: opinionPolls.slug,
              visibility: opinionPolls.visibility,
            })
            .from(opinionPolls)
            .where(inArray(opinionPolls.id, opinionPollIds))
        : Promise.resolve([]),
      opinionOptionIds.length > 0
        ? db
            .select({ id: opinionPollOptions.id, name: opinionPollOptions.name })
            .from(opinionPollOptions)
            .where(inArray(opinionPollOptions.id, opinionOptionIds))
        : Promise.resolve([]),
      personIds.length > 0
        ? db
            .select({
              id: trackedPeople.id,
              name: trackedPeople.name,
            })
            .from(trackedPeople)
            .where(inArray(trackedPeople.id, personIds))
        : Promise.resolve([]),
    ]);

    const profilesMap = new Map(
      profileRows.map((row) => [
        row.id,
        {
          username: row.username,
          avatarUrl: row.avatarUrl,
          isAgent: row.isAgent,
          isPublic: row.isPublic,
          positionsPublic: row.positionsPublic,
        },
      ]),
    );

    const matchupsMap = new Map(
      matchupRows.map((row) => [
        row.id,
        {
          title: row.title,
          slug: row.slug,
          optionAText: row.optionAText,
          optionBText: row.optionBText,
          visibility: row.visibility ?? "live",
        },
      ]),
    );

    const sentimentPollsMap = new Map(
      sentimentRows.map((row) => [
        row.id,
        {
          headline: row.headline,
          slug: row.slug,
          visibility: row.visibility ?? "live",
        },
      ]),
    );

    const opinionPollsMap = new Map(
      opinionPollRows.map((row) => [
        row.id,
        {
          title: row.title,
          slug: row.slug,
          visibility: row.visibility ?? "live",
        },
      ]),
    );

    const opinionOptionsMap = new Map(opinionOptionRows.map((row) => [row.id, row.name]));

    const peopleMap = new Map(
      personRows.map((row) => [
        row.id,
        { name: row.name },
      ]),
    );

    const items: VoteFeedItem[] = [];

    for (const row of rows) {
      const profile = profilesMap.get(row.user_id);
      if (!profile) continue;

      const surface = row.surface;
      const surfaceLabel = VOTE_SURFACE_LABELS[surface] ?? surface;
      const actor = revealActor(profile);

      let targetTitle = "";
      let targetHref: string | null = null;
      let choiceLabel = row.choice ?? "";
      let actionText = "voted";

      if (surface === "face_off") {
        const matchup = matchupsMap.get(row.target_id);
        if (!matchup || matchup.visibility !== "live") continue;
        choiceLabel = choiceLabelForFaceOff(row.choice ?? "", matchup);
        targetTitle = matchup.title;
        targetHref = matchup.slug ? `/vote/matchups/${matchup.slug}` : null;
        actionText = `picked ${choiceLabel}`;
      } else if (surface === "trending_poll") {
        const poll = sentimentPollsMap.get(row.target_id);
        if (!poll || poll.visibility !== "live") continue;
        const rawChoice = (row.choice ?? "").toLowerCase();
        choiceLabel = choiceLabelForSentiment(row.choice ?? "");
        targetTitle = poll.headline;
        targetHref = poll.slug ? `/polls/${poll.slug}` : null;
        actionText =
          rawChoice === "approve"
            ? "approved"
            : rawChoice === "oppose"
              ? "opposed"
              : rawChoice === "neutral"
                ? "stayed neutral on"
                : `voted on`;
      } else if (surface === "opinion_poll") {
        const poll = opinionPollsMap.get(row.target_id);
        if (!poll || poll.visibility !== "live") continue;
        const optionName = row.ref_id ? opinionOptionsMap.get(row.ref_id) : null;
        if (!optionName) continue;
        choiceLabel = optionName;
        targetTitle = poll.title;
        targetHref = poll.slug ? `/vote/opinion-polls/${poll.slug}` : null;
        actionText = `chose ${choiceLabel}`;
      } else if (surface === "overall_rating") {
        const person = peopleMap.get(row.target_id);
        if (!person) continue;
        choiceLabel = `${row.choice}/5`;
        targetTitle = person.name;
        targetHref = `/person/${row.target_id}`;
        actionText = `rated ${choiceLabel}`;
      } else if (surface === "value_vote") {
        const person = peopleMap.get(row.target_id);
        if (!person) continue;
        const voteWord = row.choice === "underrated" ? "underrated" : "overrated";
        choiceLabel = voteWord;
        targetTitle = person.name;
        targetHref = `/person/${row.target_id}`;
        actionText = `called ${voteWord}`;
      } else {
        continue;
      }

      items.push({
        id: row.id,
        surface,
        surfaceLabel,
        actorName: actor.name,
        avatarUrl: actor.avatarUrl,
        isAgent: profile.isAgent,
        actionText,
        targetTitle,
        targetHref,
        choiceLabel,
        votedAt: row.voted_at instanceof Date ? row.voted_at.toISOString() : String(row.voted_at),
      });

      if (items.length >= queryLimit) break;
    }

    return items;
  });
}
