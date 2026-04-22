-- Run in Supabase SQL editor (or psql against prod DATABASE_URL).
-- Read-only recon for page_views.country + migration tracking.
--
-- Railway (manual): Project → Service → Variables — note values for:
--   DISABLE_SCHEDULERS, CRON_SECRET, SERVERLESS_MODE, SKIP_DB_MIGRATE, DATABASE_URL
-- Deploy logs: search for "[Schedulers]" and "[db-deploy-migrate]".

-- A. Does page_views.country exist?
SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'page_views'
  AND column_name = 'country';

-- Optional: all page_views columns
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'page_views'
-- ORDER BY ordinal_position;

-- B. Migrations applied by db-deploy-migrate (source of truth for deploys)
SELECT tag, applied_at
FROM schema_migrations
ORDER BY applied_at;

-- C. Optional: Drizzle kit journal (may not exist on push-based DBs)
-- SELECT id, hash, created_at
-- FROM drizzle.__drizzle_migrations
-- ORDER BY created_at;

-- D. Post-migration / traffic sanity (after deploy + some traffic)
-- SELECT country, COUNT(*) AS views
-- FROM page_views
-- WHERE created_at > now() - interval '1 hour'
-- GROUP BY country
-- ORDER BY views DESC;
