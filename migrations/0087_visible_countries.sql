-- Geo-targeted card visibility: empty array = global; non-empty = residence allowlist.
ALTER TABLE face_offs ADD COLUMN IF NOT EXISTS visible_countries text[] NOT NULL DEFAULT '{}';
ALTER TABLE trending_polls ADD COLUMN IF NOT EXISTS visible_countries text[] NOT NULL DEFAULT '{}';
ALTER TABLE opinion_polls ADD COLUMN IF NOT EXISTS visible_countries text[] NOT NULL DEFAULT '{}';
ALTER TABLE prediction_markets ADD COLUMN IF NOT EXISTS visible_countries text[] NOT NULL DEFAULT '{}';
