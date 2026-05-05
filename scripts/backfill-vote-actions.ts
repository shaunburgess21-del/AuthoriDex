import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("[vote-actions backfill] starting...");

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        v.user_id,
        v.vote_type,
        v.target_type,
        v.target_id,
        'create',
        NULL,
        v.value,
        'backfill',
        'backfill:votes:' || v.id,
        jsonb_build_object('origin_table', 'votes', 'origin_id', v.id),
        v.voted_at
      FROM votes v
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:votes:' || v.id
      );
    `);

    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        s.user_id,
        'sentiment',
        'person',
        s.person_id,
        'create',
        NULL,
        s.vote_type,
        'backfill',
        'backfill:sentiment_votes:' || s.id,
        jsonb_build_object('origin_table', 'sentiment_votes', 'origin_id', s.id, 'voted_date', s.voted_date),
        s.voted_at
      FROM sentiment_votes s
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:sentiment_votes:' || s.id
      );
    `);

    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        cv.user_id,
        'value_vote',
        'person',
        cv.celebrity_id,
        'create',
        NULL,
        cv.vote,
        'backfill',
        'backfill:celebrity_value_votes:' || cv.id,
        jsonb_build_object('origin_table', 'celebrity_value_votes', 'origin_id', cv.id),
        cv.created_at
      FROM celebrity_value_votes cv
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:celebrity_value_votes:' || cv.id
      );
    `);

    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        u.user_id,
        'overall_rating',
        'person',
        u.person_id,
        'create',
        NULL,
        u.rating::text,
        'backfill',
        'backfill:user_votes:' || u.id,
        jsonb_build_object('origin_table', 'user_votes', 'origin_id', u.id),
        u.voted_at
      FROM user_votes u
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:user_votes:' || u.id
      );
    `);

    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        tp.user_id,
        'trending_poll',
        'trending_poll',
        tp.poll_id,
        'create',
        NULL,
        tp.choice,
        'backfill',
        'backfill:trending_poll_votes:' || tp.id,
        jsonb_build_object('origin_table', 'trending_poll_votes', 'origin_id', tp.id),
        tp.created_at
      FROM trending_poll_votes tp
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:trending_poll_votes:' || tp.id
      );
    `);

    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        op.user_id,
        'opinion_poll',
        'opinion_poll',
        op.poll_id,
        'create',
        NULL,
        op.option_id,
        'backfill',
        'backfill:opinion_poll_votes:' || op.id,
        jsonb_build_object('origin_table', 'opinion_poll_votes', 'origin_id', op.id),
        op.created_at
      FROM opinion_poll_votes op
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:opinion_poll_votes:' || op.id
      );
    `);

    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        iv.user_id,
        'image_curate',
        'image',
        iv.image_id,
        'create',
        NULL,
        iv.direction,
        'backfill',
        'backfill:image_votes:' || iv.id,
        jsonb_build_object('origin_table', 'image_votes', 'origin_id', iv.id),
        iv.voted_at
      FROM image_votes iv
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:image_votes:' || iv.id
      );
    `);

    await tx.execute(sql`
      INSERT INTO vote_actions (
        user_id, vote_type, target_type, target_id, action_kind, prev_value, next_value, source, request_id, metadata, created_at
      )
      SELECT
        i.user_id,
        'induction',
        'induction_candidate',
        i.candidate_id,
        'create',
        NULL,
        'up',
        'backfill',
        'backfill:induction_votes:' || i.id,
        jsonb_build_object('origin_table', 'induction_votes', 'origin_id', i.id),
        i.voted_at
      FROM induction_votes i
      WHERE NOT EXISTS (
        SELECT 1 FROM vote_actions va WHERE va.request_id = 'backfill:induction_votes:' || i.id
      );
    `);
  });

  const [countRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM vote_actions WHERE source = 'backfill'
  `) as unknown as Array<{ count: number }>;
  console.log("[vote-actions backfill] done. backfill rows:", Number(countRow?.count ?? 0));
}

run().catch((error) => {
  console.error("[vote-actions backfill] failed:", error);
  process.exit(1);
});
