-- Manual CMS ordering for sentiment polls, opinion polls, and world (community) markets.
-- Matchups (face_offs) already had display_order.

ALTER TABLE "trending_polls" ADD COLUMN IF NOT EXISTS "display_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "opinion_polls" ADD COLUMN IF NOT EXISTS "display_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "prediction_markets" ADD COLUMN IF NOT EXISTS "cms_display_order" integer DEFAULT 0 NOT NULL;

-- Preserve previous default UX: newest-created rows first (matches former ORDER BY created_at DESC).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM trending_polls
)
UPDATE trending_polls AS t
SET display_order = ranked.rn
FROM ranked
WHERE t.id = ranked.id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM opinion_polls
)
UPDATE opinion_polls AS o
SET display_order = ranked.rn
FROM ranked
WHERE o.id = ranked.id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM prediction_markets
  WHERE market_type = 'community'
)
UPDATE prediction_markets AS m
SET cms_display_order = ranked.rn
FROM ranked
WHERE m.id = ranked.id;
