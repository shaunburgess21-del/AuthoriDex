import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface PolarisationItem {
  id: string;
  slug: string | null;
  title: string;
  kind: "opinion_poll" | "face_off";
  maxPct: number;
  spreadStddev: number | null;
  totalVotes: number;
  label: string;
}

export interface PolarisationResponse {
  lopsided: PolarisationItem[];
  evenlySplit: PolarisationItem[];
}

function mapPollRows(
  rows: Record<string, unknown>[],
  kind: "opinion_poll" | "face_off",
): PolarisationItem[] {
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug != null ? String(row.slug) : null,
    title: String(row.title ?? ""),
    kind,
    maxPct: Number(row.max_pct ?? 0),
    spreadStddev: row.spread_stddev != null ? Number(row.spread_stddev) : null,
    totalVotes: Number(row.total_votes ?? 0),
    label: String(row.label ?? ""),
  }));
}

export async function loadPolarisation(): Promise<PolarisationResponse> {
  const pollLopsided = await db.execute(sql`
    WITH option_weights AS (
      SELECT
        op.id AS poll_id,
        op.title,
        op.slug,
        o.id AS option_id,
        COALESCE(vc.vote_count, 0) + COALESCE(o.seed_count, 0) AS weight
      FROM opinion_polls op
      INNER JOIN opinion_poll_options o ON o.poll_id = op.id
      LEFT JOIN (
        SELECT option_id, COUNT(*)::int AS vote_count
        FROM opinion_poll_votes
        GROUP BY option_id
      ) vc ON vc.option_id = o.id
      WHERE op.visibility = 'live'
    ),
    option_pcts AS (
      SELECT
        poll_id,
        title,
        slug,
        weight * 100.0 / NULLIF(SUM(weight) OVER (PARTITION BY poll_id), 0) AS option_pct
      FROM option_weights
    ),
    poll_stats AS (
      SELECT
        poll_id AS id,
        title,
        slug,
        MAX(option_pct) AS max_pct,
        STDDEV(option_pct) AS spread_stddev
      FROM option_pcts
      GROUP BY poll_id, title, slug
      HAVING COUNT(*) >= 2
    )
    SELECT
      ps.id,
      ps.title,
      ps.slug,
      ps.max_pct,
      ps.spread_stddev,
      COALESCE(vt.total_votes, 0)::int AS total_votes,
      ps.title AS label
    FROM poll_stats ps
    LEFT JOIN (
      SELECT poll_id, COUNT(*)::int AS total_votes
      FROM opinion_poll_votes
      GROUP BY poll_id
    ) vt ON vt.poll_id = ps.id
    ORDER BY ps.max_pct DESC NULLS LAST
    LIMIT 5
  `);

  const pollEven = await db.execute(sql`
    WITH option_weights AS (
      SELECT
        op.id AS poll_id,
        op.title,
        op.slug,
        o.id AS option_id,
        COALESCE(vc.vote_count, 0) + COALESCE(o.seed_count, 0) AS weight
      FROM opinion_polls op
      INNER JOIN opinion_poll_options o ON o.poll_id = op.id
      LEFT JOIN (
        SELECT option_id, COUNT(*)::int AS vote_count
        FROM opinion_poll_votes
        GROUP BY option_id
      ) vc ON vc.option_id = o.id
      WHERE op.visibility = 'live'
    ),
    option_pcts AS (
      SELECT
        poll_id,
        title,
        slug,
        weight * 100.0 / NULLIF(SUM(weight) OVER (PARTITION BY poll_id), 0) AS option_pct
      FROM option_weights
    ),
    poll_stats AS (
      SELECT
        poll_id AS id,
        title,
        slug,
        MAX(option_pct) AS max_pct,
        STDDEV(option_pct) AS spread_stddev
      FROM option_pcts
      GROUP BY poll_id, title, slug
      HAVING COUNT(*) >= 2 AND STDDEV(option_pct) IS NOT NULL
    )
    SELECT
      ps.id,
      ps.title,
      ps.slug,
      ps.max_pct,
      ps.spread_stddev,
      COALESCE(vt.total_votes, 0)::int AS total_votes,
      ps.title AS label
    FROM poll_stats ps
    LEFT JOIN (
      SELECT poll_id, COUNT(*)::int AS total_votes
      FROM opinion_poll_votes
      GROUP BY poll_id
    ) vt ON vt.poll_id = ps.id
    ORDER BY ps.spread_stddev ASC NULLS LAST
    LIMIT 5
  `);

  const faceLopsided = await db.execute(sql`
    WITH choice_totals AS (
      SELECT
        fo.id AS face_off_id,
        fo.title,
        fo.slug,
        COALESCE(SUM(CASE WHEN v.choice = 'a' THEN 1 ELSE 0 END), 0) + fo.seed_votes_a AS total_a,
        COALESCE(SUM(CASE WHEN v.choice = 'b' THEN 1 ELSE 0 END), 0) + fo.seed_votes_b AS total_b,
        COALESCE(SUM(CASE WHEN v.choice = 'neutral' THEN 1 ELSE 0 END), 0) + fo.seed_votes_neutral AS total_n
      FROM face_offs fo
      LEFT JOIN face_off_votes v ON v.face_off_id = fo.id
      WHERE fo.visibility = 'live'
      GROUP BY fo.id, fo.title, fo.slug, fo.seed_votes_a, fo.seed_votes_b, fo.seed_votes_neutral
    ),
    face_stats AS (
      SELECT
        face_off_id AS id,
        title,
        slug,
        (total_a + total_b + total_n) AS total_votes,
        GREATEST(
          total_a::float / NULLIF(total_a + total_b + total_n, 0) * 100,
          total_b::float / NULLIF(total_a + total_b + total_n, 0) * 100,
          total_n::float / NULLIF(total_a + total_b + total_n, 0) * 100
        ) AS max_pct,
        NULL::float AS spread_stddev,
        title AS label
      FROM choice_totals
      WHERE (total_a + total_b + total_n) > 0
    )
    SELECT id, title, slug, max_pct, spread_stddev, total_votes::int AS total_votes, label
    FROM face_stats
    ORDER BY max_pct DESC NULLS LAST
    LIMIT 5
  `);

  const faceEven = await db.execute(sql`
    WITH choice_totals AS (
      SELECT
        fo.id AS face_off_id,
        fo.title,
        fo.slug,
        COALESCE(SUM(CASE WHEN v.choice = 'a' THEN 1 ELSE 0 END), 0) + fo.seed_votes_a AS total_a,
        COALESCE(SUM(CASE WHEN v.choice = 'b' THEN 1 ELSE 0 END), 0) + fo.seed_votes_b AS total_b,
        COALESCE(SUM(CASE WHEN v.choice = 'neutral' THEN 1 ELSE 0 END), 0) + fo.seed_votes_neutral AS total_n
      FROM face_offs fo
      LEFT JOIN face_off_votes v ON v.face_off_id = fo.id
      WHERE fo.visibility = 'live'
      GROUP BY fo.id, fo.title, fo.slug, fo.seed_votes_a, fo.seed_votes_b, fo.seed_votes_neutral
    ),
    face_stats AS (
      SELECT
        face_off_id AS id,
        title,
        slug,
        (total_a + total_b + total_n) AS total_votes,
        GREATEST(
          total_a::float / NULLIF(total_a + total_b + total_n, 0) * 100,
          total_b::float / NULLIF(total_a + total_b + total_n, 0) * 100
        ) AS max_pct,
        ABS(
          total_a::float / NULLIF(total_a + total_b + total_n, 0)
          - total_b::float / NULLIF(total_a + total_b + total_n, 0)
        ) * 100 AS spread_stddev,
        title AS label
      FROM choice_totals
      WHERE (total_a + total_b + total_n) > 0
    )
    SELECT id, title, slug, max_pct, spread_stddev, total_votes::int AS total_votes, label
    FROM face_stats
    ORDER BY spread_stddev ASC NULLS LAST
    LIMIT 5
  `);

  const extract = (result: unknown) =>
    (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

  const lopsided = [
    ...mapPollRows(extract(pollLopsided), "opinion_poll"),
    ...mapPollRows(extract(faceLopsided), "face_off"),
  ]
    .sort((a, b) => b.maxPct - a.maxPct)
    .slice(0, 5);

  const evenlySplit = [
    ...mapPollRows(extract(pollEven), "opinion_poll"),
    ...mapPollRows(extract(faceEven), "face_off"),
  ]
    .sort((a, b) => (a.spreadStddev ?? 999) - (b.spreadStddev ?? 999))
    .slice(0, 5);

  return { lopsided, evenlySplit };
}
