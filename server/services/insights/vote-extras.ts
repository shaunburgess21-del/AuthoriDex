/**
 * Supplementary vote insights: consensus meter, active voters, approval movers.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import type {
  VoteApprovalMoverRow,
  VoteConsensusStat,
  VoteInsightsExtras,
  VoteActiveVoterRow,
} from "@shared/insights/types";
import { withDiscoverCache } from "./discover-cache";

const allVotesCte = sql`
  all_votes AS (
    SELECT v.user_id, v.voted_at
    FROM votes v
    WHERE v.vote_type = 'face_off'
    UNION ALL
    SELECT tpv.user_id, GREATEST(tpv.created_at, tpv.updated_at)
    FROM trending_poll_votes tpv
    UNION ALL
    SELECT opv.user_id, GREATEST(opv.created_at, opv.updated_at)
    FROM opinion_poll_votes opv
    UNION ALL
    SELECT uv.user_id, uv.voted_at
    FROM user_votes uv
    UNION ALL
    SELECT cvv.user_id, GREATEST(cvv.created_at, cvv.updated_at)
    FROM celebrity_value_votes cvv
  )
`;

function mapRows(result: unknown): Record<string, unknown>[] {
  return (
    (Array.isArray(result)
      ? result
      : (result as { rows: Record<string, unknown>[] }).rows) ?? []
  );
}

async function loadConsensus(): Promise<VoteConsensusStat> {
  const result = await db.execute(sql`
    WITH matchup_user AS (
      SELECT
        v.target_id,
        COUNT(*) FILTER (WHERE v.value = 'option_a')::float AS votes_a,
        COUNT(*) FILTER (WHERE v.value = 'option_b')::float AS votes_b,
        COUNT(*) FILTER (WHERE v.value = 'neutral')::float AS votes_n,
        COUNT(*)::float AS total
      FROM votes v
      WHERE v.vote_type = 'face_off'
      GROUP BY v.target_id
      HAVING COUNT(*) >= 5
    ),
    leader_shares AS (
      SELECT
        GREATEST(
          votes_a / NULLIF(total, 0),
          votes_b / NULLIF(total, 0),
          votes_n / NULLIF(total, 0)
        ) AS leader_share
      FROM matchup_user
    )
    SELECT
      COALESCE(AVG(leader_share), 0)::float AS avg_leader_share,
      COUNT(*)::int AS contest_count
    FROM leader_shares
  `);

  const row = mapRows(result)[0] ?? {};
  const avgShare = Number(row.avg_leader_share ?? 0);
  const contestCount = Number(row.contest_count ?? 0);
  const avgLeaderSharePct = Math.round(avgShare * 100);

  let label = "Mixed splits";
  if (avgLeaderSharePct >= 70) label = "Strong consensus";
  else if (avgLeaderSharePct >= 55) label = "Leaning one way";
  else if (avgLeaderSharePct > 0 && avgLeaderSharePct < 45) label = "Knife-edge territory";

  return {
    avgLeaderSharePct,
    contestCount,
    label,
  };
}

async function loadMostActiveVoters(limit: number): Promise<VoteActiveVoterRow[]> {
  const result = await db.execute(sql`
    WITH ${allVotesCte}
    SELECT
      p.id AS user_id,
      p.username,
      p.avatar_url,
      p.is_agent,
      COUNT(*)::int AS vote_count
    FROM all_votes av
    INNER JOIN profiles p ON p.id = av.user_id
    WHERE p.is_house = false
      AND av.voted_at >= NOW() - INTERVAL '7 days'
    GROUP BY p.id, p.username, p.avatar_url, p.is_agent
    ORDER BY vote_count DESC
    LIMIT ${limit}
  `);

  return mapRows(result).map((row) => ({
    userId: String(row.user_id),
    displayName: String(row.username ?? "Anonymous"),
    avatarUrl: row.avatar_url != null ? String(row.avatar_url) : null,
    isAgent: Boolean(row.is_agent),
    voteCount: Number(row.vote_count ?? 0),
  }));
}

async function loadApprovalMovers(limit: number): Promise<{
  rising: VoteApprovalMoverRow[];
  falling: VoteApprovalMoverRow[];
}> {
  const result = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (person_id)
        person_id,
        approval_avg_rating,
        timestamp
      FROM approval_snapshots
      WHERE approval_avg_rating IS NOT NULL
      ORDER BY person_id, timestamp DESC
    ),
    week_ago AS (
      SELECT DISTINCT ON (person_id)
        person_id,
        approval_avg_rating
      FROM approval_snapshots
      WHERE approval_avg_rating IS NOT NULL
        AND timestamp <= NOW() - INTERVAL '7 days'
      ORDER BY person_id, timestamp DESC
    ),
    deltas AS (
      SELECT
        l.person_id,
        l.approval_avg_rating AS rating_now,
        w.approval_avg_rating AS rating_then,
        (l.approval_avg_rating - w.approval_avg_rating) AS delta_pts
      FROM latest l
      INNER JOIN week_ago w ON w.person_id = l.person_id
      WHERE l.approval_avg_rating IS NOT NULL
        AND w.approval_avg_rating IS NOT NULL
    )
    SELECT
      d.person_id,
      tp.name,
      d.rating_now,
      d.delta_pts
    FROM deltas d
    INNER JOIN tracked_people tp ON tp.id = d.person_id
    WHERE d.delta_pts <> 0
    ORDER BY d.delta_pts DESC
  `);

  const rows = mapRows(result).map((row) => {
    const deltaPts = Math.round(Number(row.delta_pts ?? 0) * 100) / 100;
    return {
      personId: String(row.person_id),
      name: String(row.name ?? ""),
      approvalNow: Math.round(Number(row.rating_now ?? 0) * 100) / 100,
      deltaPts,
      direction: deltaPts >= 0 ? ("up" as const) : ("down" as const),
    };
  });

  const rising = rows.filter((r) => r.deltaPts > 0).slice(0, limit);
  const falling = [...rows].sort((a, b) => a.deltaPts - b.deltaPts).filter((r) => r.deltaPts < 0).slice(0, limit);

  return { rising, falling };
}

export async function loadVoteInsightsExtras(): Promise<VoteInsightsExtras> {
  return withDiscoverCache("vote:extras:v1", async () => {
    const [consensus, mostActiveVoters, approvalMovers] = await Promise.all([
      loadConsensus(),
      loadMostActiveVoters(5),
      loadApprovalMovers(3),
    ]);

    return {
      consensus,
      mostActiveVoters,
      approvalMovers,
    };
  });
}
