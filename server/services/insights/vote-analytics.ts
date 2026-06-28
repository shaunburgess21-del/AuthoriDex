/**
 * Top-voted opinion polls and matchups for the Insights Vote tab.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { TopVotedResponse, TopVoteMatchup, TopVotePoll } from "@shared/insights/types";
import { withDiscoverCache } from "./discover-cache";
import {
  resolveOpinionOptionDisplayImageUrl,
  resolveOpinionPollImageUrl,
} from "../opinion-poll-images";
import { resolveMatchupOptionDisplay } from "../matchup-option-images";

const extract = (result: unknown) =>
  (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

async function loadTopOpinionPolls(limit: number): Promise<TopVotePoll[]> {
  const result = await db.execute(sql`
    WITH option_weights AS (
      SELECT
        op.id AS poll_id,
        op.title,
        op.slug,
        op.image_url,
        o.name AS option_name,
        o.image_url AS option_image_url,
        tp.avatar AS person_avatar,
        COALESCE(vc.vote_count, 0) + COALESCE(o.seed_count, 0) AS weight
      FROM opinion_polls op
      INNER JOIN opinion_poll_options o ON o.poll_id = op.id
      LEFT JOIN trending_people tp ON tp.id = o.person_id
      LEFT JOIN (
        SELECT option_id, COUNT(*)::int AS vote_count
        FROM opinion_poll_votes
        GROUP BY option_id
      ) vc ON vc.option_id = o.id
      WHERE op.visibility = 'live'
    ),
    poll_totals AS (
      SELECT poll_id, SUM(weight)::int AS total_votes
      FROM option_weights
      GROUP BY poll_id
      HAVING SUM(weight) > 0
    ),
    option_counts AS (
      SELECT poll_id, COUNT(*)::int AS option_count
      FROM opinion_poll_options
      GROUP BY poll_id
    ),
    ranked_leaders AS (
      SELECT
        ow.poll_id,
        ow.title,
        ow.slug,
        ow.image_url,
        ow.option_name,
        ow.option_image_url,
        ow.person_avatar,
        ow.weight * 100.0 / NULLIF(SUM(ow.weight) OVER (PARTITION BY ow.poll_id), 0) AS option_pct,
        ROW_NUMBER() OVER (PARTITION BY ow.poll_id ORDER BY ow.weight DESC) AS rn
      FROM option_weights ow
      INNER JOIN poll_totals pt ON pt.poll_id = ow.poll_id
    ),
    top_polls AS (
      SELECT poll_id, total_votes
      FROM poll_totals
      ORDER BY total_votes DESC
      LIMIT ${limit}
    )
    SELECT
      rl.poll_id AS id,
      rl.title,
      rl.slug,
      tp.total_votes,
      COALESCE(oc.option_count, 0)::int AS option_count,
      rl.image_url,
      rl.option_name,
      rl.option_image_url,
      rl.person_avatar,
      rl.option_pct,
      rl.rn
    FROM ranked_leaders rl
    INNER JOIN top_polls tp ON tp.poll_id = rl.poll_id
    LEFT JOIN option_counts oc ON oc.poll_id = rl.poll_id
    WHERE rl.rn <= 2
    ORDER BY tp.total_votes DESC, rl.poll_id, rl.rn
  `);

  type PollBuild = TopVotePoll;
  const byId = new Map<string, PollBuild>();

  for (const row of extract(result)) {
    const pollId = String(row.id);
    const rn = Number(row.rn ?? 1);
    const slug = row.slug != null ? String(row.slug) : null;
    const optionName = String(row.option_name ?? "");

    if (rn === 1) {
      byId.set(pollId, {
        id: pollId,
        slug,
        title: String(row.title ?? ""),
        totalVotes: Number(row.total_votes ?? 0),
        optionCount: Number(row.option_count ?? 0),
        imageUrl: resolveOpinionPollImageUrl(
          row.image_url != null ? String(row.image_url) : null,
          slug,
        ),
        leaderLabel: optionName,
        leaderPct: Math.round(Number(row.option_pct ?? 0)),
        leaderImageUrl: resolveOpinionOptionDisplayImageUrl(
          row.person_avatar != null ? String(row.person_avatar) : null,
          row.option_image_url != null ? String(row.option_image_url) : null,
          slug,
          optionName,
        ),
      });
    } else if (rn === 2) {
      const existing = byId.get(pollId);
      if (existing) {
        existing.runnerUpLabel = optionName;
        existing.runnerUpPct = Math.round(Number(row.option_pct ?? 0));
      }
    }
  }

  return Array.from(byId.values());
}

async function loadTopMatchups(limit: number): Promise<TopVoteMatchup[]> {
  const result = await db.execute(sql`
    WITH choice_totals AS (
      SELECT
        fo.id,
        fo.title,
        fo.slug,
        fo.option_a_text,
        fo.option_b_text,
        fo.option_a_image,
        fo.option_b_image,
        fo.person_a_id,
        fo.person_b_id,
        COALESCE(SUM(CASE WHEN v.value = 'option_a' THEN 1 ELSE 0 END), 0) + fo.seed_votes_a AS total_a,
        COALESCE(SUM(CASE WHEN v.value = 'option_b' THEN 1 ELSE 0 END), 0) + fo.seed_votes_b AS total_b,
        COALESCE(SUM(CASE WHEN v.value = 'neutral' THEN 1 ELSE 0 END), 0) + fo.seed_votes_neutral AS total_n
      FROM face_offs fo
      LEFT JOIN votes v ON v.target_id = fo.id AND v.vote_type = 'face_off'
      WHERE fo.visibility = 'live'
      GROUP BY
        fo.id, fo.title, fo.slug,
        fo.option_a_text, fo.option_b_text,
        fo.option_a_image, fo.option_b_image,
        fo.person_a_id, fo.person_b_id,
        fo.seed_votes_a, fo.seed_votes_b, fo.seed_votes_neutral
    ),
    with_totals AS (
      SELECT
        *,
        (total_a + total_b + total_n) AS total_votes,
        total_a::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS option_a_pct,
        total_b::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS option_b_pct,
        total_n::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS neutral_pct,
        total_a::int AS option_a_votes,
        total_b::int AS option_b_votes,
        total_n::int AS neutral_votes
      FROM choice_totals
      WHERE (total_a + total_b + total_n) > 0
    )
    SELECT
      wt.id,
      wt.title,
      wt.slug,
      wt.total_votes::int AS total_votes,
      wt.option_a_pct,
      wt.option_b_pct,
      wt.neutral_pct,
      wt.option_a_votes,
      wt.option_b_votes,
      wt.neutral_votes,
      wt.option_a_text,
      wt.option_b_text,
      wt.option_a_image,
      wt.option_b_image,
      wt.person_a_id,
      wt.person_b_id,
      tpa.avatar AS avatar_a,
      tpb.avatar AS avatar_b
    FROM with_totals wt
    LEFT JOIN trending_people tpa ON tpa.id = wt.person_a_id
    LEFT JOIN trending_people tpb ON tpb.id = wt.person_b_id
    ORDER BY wt.total_votes DESC
    LIMIT ${limit}
  `);

  return extract(result).map((row) => {
    const optionAText = String(row.option_a_text ?? "A");
    const optionBText = String(row.option_b_text ?? "B");
    const personAId = row.person_a_id != null ? String(row.person_a_id) : null;
    const personBId = row.person_b_id != null ? String(row.person_b_id) : null;
    const avatarById: Record<string, string | null> = {};
    const avatarByName: Record<string, string | null> = {};
    if (row.avatar_a) avatarById[personAId ?? ""] = String(row.avatar_a);
    if (row.avatar_b) avatarById[personBId ?? ""] = String(row.avatar_b);
    avatarByName[optionAText.toLowerCase()] = row.avatar_a != null ? String(row.avatar_a) : null;
    avatarByName[optionBText.toLowerCase()] = row.avatar_b != null ? String(row.avatar_b) : null;

    const optA = resolveMatchupOptionDisplay(
      row.option_a_image != null ? String(row.option_a_image) : null,
      personAId,
      optionAText,
      optionAText,
      optionBText,
      avatarById,
      avatarByName,
      row.slug != null ? String(row.slug) : null,
    );
    const optB = resolveMatchupOptionDisplay(
      row.option_b_image != null ? String(row.option_b_image) : null,
      personBId,
      optionBText,
      optionAText,
      optionBText,
      avatarById,
      avatarByName,
      row.slug != null ? String(row.slug) : null,
    );

    return {
      id: String(row.id),
      slug: row.slug != null ? String(row.slug) : null,
      title: String(row.title ?? ""),
      totalVotes: Number(row.total_votes ?? 0),
      optionAPct: Math.round(Number(row.option_a_pct ?? 50)),
      optionBPct: Math.round(Number(row.option_b_pct ?? 50)),
      neutralPct: Math.round(Number(row.neutral_pct ?? 0)),
      optionAVotes: Number(row.option_a_votes ?? 0),
      optionBVotes: Number(row.option_b_votes ?? 0),
      neutralVotes: Number(row.neutral_votes ?? 0),
      participants: [
        { name: optionAText, avatar: optA.resolved },
        { name: optionBText, avatar: optB.resolved },
      ],
    };
  });
}

export async function loadTopVoted(limit = 5): Promise<TopVotedResponse> {
  return withDiscoverCache("vote:top", async () => {
    const [polls, matchups] = await Promise.all([
      loadTopOpinionPolls(limit),
      loadTopMatchups(limit),
    ]);
    return { polls, matchups };
  });
}
