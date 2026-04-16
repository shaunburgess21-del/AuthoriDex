-- Scaling indexes for 150-200+ people on the leaderboard
-- These indexes support the most frequent query patterns that were previously doing sequential scans.

-- trending_people: leaderboard sort/filter queries
CREATE INDEX IF NOT EXISTS trending_people_rank_idx ON trending_people (rank);
CREATE INDEX IF NOT EXISTS trending_people_category_idx ON trending_people (category);

-- trend_snapshots: per-person history lookups and 7-day window scans
CREATE INDEX IF NOT EXISTS trend_snapshots_person_ts_idx ON trend_snapshots (person_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS trend_snapshots_person_origin_ts_idx ON trend_snapshots (person_id, snapshot_origin, timestamp DESC);

-- api_cache: GROUP BY provider aggregations (freshness endpoint) and provider-scoped queries
CREATE INDEX IF NOT EXISTS api_cache_provider_idx ON api_cache (provider);

-- celebrity_metrics: approval/value tab sorting on the leaderboard
CREATE INDEX IF NOT EXISTS celebrity_metrics_approval_idx ON celebrity_metrics (approval_avg_rating DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS celebrity_metrics_value_idx ON celebrity_metrics (value_score DESC NULLS LAST);

-- tracked_people: ingest and market-generator filter by status
CREATE INDEX IF NOT EXISTS tracked_people_status_idx ON tracked_people (status);

-- sentiment_votes: per-person vote counts
CREATE INDEX IF NOT EXISTS sentiment_votes_person_idx ON sentiment_votes (person_id);

-- celebrity_images: admin GROUP BY person_id aggregation
CREATE INDEX IF NOT EXISTS celebrity_images_person_idx ON celebrity_images (person_id);
