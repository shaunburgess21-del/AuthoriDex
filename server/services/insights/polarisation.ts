import { db } from "../../db";
import { sql } from "drizzle-orm";
import type { PolarisationItem, PolarisationResponse } from "@shared/insights/types";
import {
  resolveOpinionOptionDisplayImageUrl,
  resolveOpinionPollImageUrl,
} from "../opinion-poll-images";
import { resolveMatchupOptionDisplay } from "../matchup-option-images";

export type { PolarisationItem, PolarisationResponse };

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
    optionAPct: row.option_a_pct != null ? Number(row.option_a_pct) : null,
    optionBPct: row.option_b_pct != null ? Number(row.option_b_pct) : null,
    optionAVotes: row.option_a_votes != null ? Number(row.option_a_votes) : null,
    optionBVotes: row.option_b_votes != null ? Number(row.option_b_votes) : null,
    neutralVotes: row.neutral_votes != null ? Number(row.neutral_votes) : null,
    neutralPct: row.neutral_pct != null ? Number(row.neutral_pct) : null,
  }));
}

const extract = (result: unknown) =>
  (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

async function enrichPollItems(items: PolarisationItem[]): Promise<void> {
  const pollIds = items.filter((i) => i.kind === "opinion_poll").map((i) => i.id);
  if (pollIds.length === 0) return;

  const result = await db.execute(sql`
    WITH option_weights AS (
      SELECT
        op.id AS poll_id,
        op.image_url,
        op.slug,
        o.id AS option_id,
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
      WHERE op.id IN (${sql.join(pollIds.map((id) => sql`${id}`), sql`, `)})
    ),
    ranked AS (
      SELECT
        poll_id,
        image_url,
        slug,
        option_name,
        option_image_url,
        person_avatar,
        weight,
        weight * 100.0 / NULLIF(SUM(weight) OVER (PARTITION BY poll_id), 0) AS option_pct,
        ROW_NUMBER() OVER (PARTITION BY poll_id ORDER BY weight DESC) AS rn
      FROM option_weights
    )
    SELECT poll_id, image_url, slug, option_name, option_image_url, person_avatar, option_pct, rn
    FROM ranked
    WHERE rn <= 2
  `);

  type PollMeta = {
    imageUrl: string | null;
    leaderLabel: string;
    leaderPct: number;
    leaderImageUrl: string | null;
    runnerUpLabel?: string;
    runnerUpPct?: number;
  };
  const metaById = new Map<string, PollMeta>();

  for (const row of extract(result)) {
    const pollId = String(row.poll_id);
    const rn = Number(row.rn ?? 1);
    if (rn === 1) {
      metaById.set(pollId, {
        imageUrl: resolveOpinionPollImageUrl(
          row.image_url != null ? String(row.image_url) : null,
          row.slug != null ? String(row.slug) : null,
        ),
        leaderLabel: String(row.option_name ?? ""),
        leaderPct: Number(row.option_pct ?? 0),
        leaderImageUrl: resolveOpinionOptionDisplayImageUrl(
          row.person_avatar != null ? String(row.person_avatar) : null,
          row.option_image_url != null ? String(row.option_image_url) : null,
          row.slug != null ? String(row.slug) : null,
          String(row.option_name ?? ""),
        ),
      });
    } else if (rn === 2) {
      const existing = metaById.get(pollId);
      if (existing) {
        existing.runnerUpLabel = String(row.option_name ?? "");
        existing.runnerUpPct = Number(row.option_pct ?? 0);
      }
    }
  }

  for (const item of items) {
    if (item.kind !== "opinion_poll") continue;
    const meta = metaById.get(item.id);
    if (!meta) continue;
    item.imageUrl = meta.imageUrl;
    item.leaderLabel = meta.leaderLabel;
    item.leaderPct = Math.round(meta.leaderPct);
    item.leaderImageUrl = meta.leaderImageUrl;
    if (meta.runnerUpLabel) {
      item.runnerUpLabel = meta.runnerUpLabel;
      item.runnerUpPct = Math.round(meta.runnerUpPct ?? 0);
    }
  }

  const countResult = await db.execute(sql`
    SELECT poll_id, COUNT(*)::int AS option_count
    FROM opinion_poll_options
    WHERE poll_id IN (${sql.join(pollIds.map((id) => sql`${id}`), sql`, `)})
    GROUP BY poll_id
  `);
  const countById = new Map(
    extract(countResult).map((row) => [String(row.poll_id), Number(row.option_count ?? 0)]),
  );
  for (const item of items) {
    if (item.kind !== "opinion_poll") continue;
    const count = countById.get(item.id);
    if (count != null) item.optionCount = count;
  }
}

async function enrichFaceOffItems(items: PolarisationItem[]): Promise<void> {
  const faceIds = items.filter((i) => i.kind === "face_off").map((i) => i.id);
  if (faceIds.length === 0) return;

  const result = await db.execute(sql`
    SELECT
      fo.id,
      fo.option_a_text,
      fo.option_b_text,
      fo.option_a_image,
      fo.option_b_image,
      fo.person_a_id,
      fo.person_b_id,
      tpa.avatar AS avatar_a,
      tpb.avatar AS avatar_b
    FROM face_offs fo
    LEFT JOIN trending_people tpa ON tpa.id = fo.person_a_id
    LEFT JOIN trending_people tpb ON tpb.id = fo.person_b_id
    WHERE fo.id IN (${sql.join(faceIds.map((id) => sql`${id}`), sql`, `)})
  `);

  for (const row of extract(result)) {
    const id = String(row.id);
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

    const item = items.find((i) => i.id === id);
    if (!item) continue;
    item.participants = [
      { name: optionAText, avatar: optA.resolved },
      { name: optionBText, avatar: optB.resolved },
    ];
  }
}

async function enrichAllItems(items: PolarisationItem[]): Promise<void> {
  await Promise.all([enrichPollItems(items), enrichFaceOffItems(items)]);
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
    poll_totals AS (
      SELECT poll_id, SUM(weight)::int AS total_votes
      FROM option_weights
      GROUP BY poll_id
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
      COALESCE(pt.total_votes, 0)::int AS total_votes,
      ps.title AS label,
      NULL::float AS option_a_pct,
      NULL::float AS option_b_pct
    FROM poll_stats ps
    LEFT JOIN poll_totals pt ON pt.poll_id = ps.id
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
    poll_totals AS (
      SELECT poll_id, SUM(weight)::int AS total_votes
      FROM option_weights
      GROUP BY poll_id
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
      COALESCE(pt.total_votes, 0)::int AS total_votes,
      ps.title AS label,
      NULL::float AS option_a_pct,
      NULL::float AS option_b_pct
    FROM poll_stats ps
    LEFT JOIN poll_totals pt ON pt.poll_id = ps.id
    ORDER BY ps.spread_stddev ASC NULLS LAST
    LIMIT 5
  `);

  const faceLopsided = await db.execute(sql`
    WITH choice_totals AS (
      SELECT
        fo.id AS face_off_id,
        fo.title,
        fo.slug,
        COALESCE(SUM(CASE WHEN v.value = 'option_a' THEN 1 ELSE 0 END), 0) + fo.seed_votes_a AS total_a,
        COALESCE(SUM(CASE WHEN v.value = 'option_b' THEN 1 ELSE 0 END), 0) + fo.seed_votes_b AS total_b,
        COALESCE(SUM(CASE WHEN v.value = 'neutral' THEN 1 ELSE 0 END), 0) + fo.seed_votes_neutral AS total_n
      FROM face_offs fo
      LEFT JOIN votes v ON v.target_id = fo.id AND v.vote_type = 'face_off'
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
        title AS label,
        total_a::int AS option_a_votes,
        total_b::int AS option_b_votes,
        total_n::int AS neutral_votes,
        total_a::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS option_a_pct,
        total_b::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS option_b_pct,
        total_n::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS neutral_pct
      FROM choice_totals
      WHERE (total_a + total_b + total_n) > 0
    )
    SELECT id, title, slug, max_pct, spread_stddev, total_votes::int AS total_votes, label, option_a_pct, option_b_pct, option_a_votes, option_b_votes, neutral_votes, neutral_pct
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
        COALESCE(SUM(CASE WHEN v.value = 'option_a' THEN 1 ELSE 0 END), 0) + fo.seed_votes_a AS total_a,
        COALESCE(SUM(CASE WHEN v.value = 'option_b' THEN 1 ELSE 0 END), 0) + fo.seed_votes_b AS total_b,
        COALESCE(SUM(CASE WHEN v.value = 'neutral' THEN 1 ELSE 0 END), 0) + fo.seed_votes_neutral AS total_n
      FROM face_offs fo
      LEFT JOIN votes v ON v.target_id = fo.id AND v.vote_type = 'face_off'
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
        title AS label,
        total_a::int AS option_a_votes,
        total_b::int AS option_b_votes,
        total_n::int AS neutral_votes,
        total_a::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS option_a_pct,
        total_b::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS option_b_pct,
        total_n::float / NULLIF(total_a + total_b + total_n, 0) * 100 AS neutral_pct
      FROM choice_totals
      WHERE (total_a + total_b + total_n) > 0
    )
    SELECT id, title, slug, max_pct, spread_stddev, total_votes::int AS total_votes, label, option_a_pct, option_b_pct, option_a_votes, option_b_votes, neutral_votes, neutral_pct
    FROM face_stats
    ORDER BY spread_stddev ASC NULLS LAST
    LIMIT 5
  `);

  const pollLopsidedRows = mapPollRows(extract(pollLopsided), "opinion_poll");
  const pollEvenRows = mapPollRows(extract(pollEven), "opinion_poll");
  const faceLopsidedRows = mapPollRows(extract(faceLopsided), "face_off");
  const faceEvenRows = mapPollRows(extract(faceEven), "face_off");

  const allItems = [
    ...pollLopsidedRows,
    ...pollEvenRows,
    ...faceLopsidedRows,
    ...faceEvenRows,
  ];
  await enrichAllItems(allItems);

  const lopsided = [...pollLopsidedRows, ...faceLopsidedRows]
    .sort((a, b) => b.maxPct - a.maxPct)
    .slice(0, 5);

  const evenlySplit = [...pollEvenRows, ...faceEvenRows]
    .sort((a, b) => (a.spreadStddev ?? 999) - (b.spreadStddev ?? 999))
    .slice(0, 5);

  return {
    lopsided,
    evenlySplit,
    polls: { lopsided: pollLopsidedRows, evenlySplit: pollEvenRows },
    faceOffs: { lopsided: faceLopsidedRows, evenlySplit: faceEvenRows },
  };
}
