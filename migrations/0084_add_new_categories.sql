-- Add 7 new canonical categories: Crypto, AI, Fashion, Beauty, Health, Travel, Dating.
--
-- These mirror the additions to CANONICAL_CATEGORIES in shared/constants.ts.
-- Two changes are required:
--   1. Seed the admin-managed content_categories registry so the new categories
--      become selectable in admin create/edit modals (GET /api/admin/categories).
--   2. Expand the user_category_engagement CHECK constraint. engagementWriter.ts
--      derives CANONICAL_IDS from CANONICAL_CATEGORIES at module load; once the
--      7 new ids exist there, engagement upserts for them would be rejected by
--      the original CHECK (migration 0043) unless we widen it here.
--
-- Authored idempotently (ON CONFLICT DO NOTHING / DROP IF EXISTS + re-add) so
-- reruns against an already-patched environment are a safe no-op.

INSERT INTO public.content_categories (id, label, sort_order) VALUES
  ('crypto', 'Crypto', 130),
  ('ai', 'AI', 140),
  ('fashion', 'Fashion', 150),
  ('beauty', 'Beauty', 160),
  ('health', 'Health', 170),
  ('travel', 'Travel', 180),
  ('dating', 'Dating', 190)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- Widen the canonical-id CHECK to include the 7 new ids. The constraint already
-- exists from migration 0043, so drop and re-add with the full 19-id set.
ALTER TABLE "user_category_engagement"
  DROP CONSTRAINT IF EXISTS "user_category_engagement_category_check";
--> statement-breakpoint

ALTER TABLE "user_category_engagement"
  ADD CONSTRAINT "user_category_engagement_category_check"
  CHECK ("category_id" IN (
    'tech','politics','business','music','sports','film-tv',
    'gaming','creator','comedy','food-drink','lifestyle',
    'crypto','ai','fashion','beauty','health','travel','dating',
    'misc'
  ));
