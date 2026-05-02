-- Add covering indexes for foreign-key columns flagged by the Supabase
-- `unindexed_foreign_keys` performance advisor.
--
-- Why this matters:
-- A FK without a covering index forces a sequential scan whenever the
-- parent row is deleted/updated (Postgres must verify no children point
-- to it), and forces the query planner to fall back to seq scans for
-- joins/filters on the FK column. Adding a single-column index on the
-- referencing column fixes both.
--
-- Notes:
--   * `IF NOT EXISTS` makes this idempotent.
--   * We deliberately do NOT use `CONCURRENTLY` because the deploy-time
--     migration runner wraps each migration in a transaction, and
--     `CREATE INDEX CONCURRENTLY` cannot run inside one. These tables
--     are small-to-medium and the brief lock is acceptable. If a future
--     prod migration touches a much larger table, drop CONCURRENTLY into
--     its own dedicated, transaction-free migration script.

CREATE INDEX IF NOT EXISTS agent_configs_user_id_idx
  ON public.agent_configs (user_id);

CREATE INDEX IF NOT EXISTS celebrity_images_person_id_idx
  ON public.celebrity_images (person_id);

CREATE INDEX IF NOT EXISTS community_insights_person_id_idx
  ON public.community_insights (person_id);

CREATE INDEX IF NOT EXISTS face_off_votes_face_off_id_idx
  ON public.face_off_votes (face_off_id);

CREATE INDEX IF NOT EXISTS face_offs_person_a_id_idx
  ON public.face_offs (person_a_id);

CREATE INDEX IF NOT EXISTS face_offs_person_b_id_idx
  ON public.face_offs (person_b_id);

CREATE INDEX IF NOT EXISTS image_votes_image_id_idx
  ON public.image_votes (image_id);

CREATE INDEX IF NOT EXISTS induction_cycle_results_candidate_id_idx
  ON public.induction_cycle_results (candidate_id);

CREATE INDEX IF NOT EXISTS induction_cycle_results_person_id_idx
  ON public.induction_cycle_results (person_id);

CREATE INDEX IF NOT EXISTS induction_votes_candidate_id_idx
  ON public.induction_votes (candidate_id);

CREATE INDEX IF NOT EXISTS insight_items_insight_id_idx
  ON public.insight_items (insight_id);

CREATE INDEX IF NOT EXISTS insight_votes_insight_id_idx
  ON public.insight_votes (insight_id);

CREATE INDEX IF NOT EXISTS market_entries_person_id_idx
  ON public.market_entries (person_id);

CREATE INDEX IF NOT EXISTS opinion_poll_options_person_id_idx
  ON public.opinion_poll_options (person_id);

CREATE INDEX IF NOT EXISTS platform_insights_person_id_idx
  ON public.platform_insights (person_id);

CREATE INDEX IF NOT EXISTS scheduled_agent_actions_entry_id_idx
  ON public.scheduled_agent_actions (entry_id);

CREATE INDEX IF NOT EXISTS scheduled_agent_actions_market_id_idx
  ON public.scheduled_agent_actions (market_id);

CREATE INDEX IF NOT EXISTS suggestions_reviewed_by_idx
  ON public.suggestions (reviewed_by);
