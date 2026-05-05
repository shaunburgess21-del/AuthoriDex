-- Extra fields on induction candidates so admins can stage social + search data
-- before approve copies them onto tracked_people.

ALTER TABLE "induction_candidates" ADD COLUMN IF NOT EXISTS "instagram_handle" text;
ALTER TABLE "induction_candidates" ADD COLUMN IF NOT EXISTS "tiktok_handle" text;
ALTER TABLE "induction_candidates" ADD COLUMN IF NOT EXISTS "youtube_id" text;
ALTER TABLE "induction_candidates" ADD COLUMN IF NOT EXISTS "spotify_id" text;
ALTER TABLE "induction_candidates" ADD COLUMN IF NOT EXISTS "search_query_override" text;
