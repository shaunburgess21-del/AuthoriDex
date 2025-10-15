-- FameDex Supabase Schema
-- Run this in Supabase SQL Editor to create all tables, views, functions, and policies

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Persons table (tracked celebrities/influencers)
CREATE TABLE IF NOT EXISTS persons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  avatar TEXT,
  hero_img_url TEXT, -- URL to hero image in Supabase Storage
  youtube_id TEXT,
  spotify_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_persons_name ON persons(name);
CREATE INDEX idx_persons_category ON persons(category);

-- Trend snapshots (time-series data)
CREATE TABLE IF NOT EXISTS trend_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  news_count REAL NOT NULL DEFAULT 0,
  youtube_views REAL NOT NULL DEFAULT 0,
  spotify_followers REAL NOT NULL DEFAULT 0,
  search_volume REAL NOT NULL DEFAULT 0,
  trend_score REAL NOT NULL,
  change_24h REAL,
  change_7d REAL,
  rank INTEGER,
  UNIQUE(person_id, timestamp)
);

CREATE INDEX idx_snapshots_person ON trend_snapshots(person_id);
CREATE INDEX idx_snapshots_timestamp ON trend_snapshots(timestamp DESC);
CREATE INDEX idx_snapshots_rank ON trend_snapshots(rank) WHERE rank IS NOT NULL;

-- Platform insights (top content per platform)
CREATE TABLE IF NOT EXISTS platform_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- X, YouTube, Instagram, TikTok, Spotify, News
  insight_type TEXT NOT NULL, -- Most Liked Tweet, Top Video, etc.
  metric_name TEXT NOT NULL -- likes, views, plays
);

CREATE INDEX idx_insights_person ON platform_insights(person_id);

-- Insight items (top 5 ranked items per insight)
CREATE TABLE IF NOT EXISTS insight_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  insight_id UUID NOT NULL REFERENCES platform_insights(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank >= 1 AND rank <= 5),
  title TEXT NOT NULL,
  metric_value REAL NOT NULL,
  link TEXT,
  image_url TEXT,
  timestamp TIMESTAMPTZ
);

CREATE INDEX idx_items_insight ON insight_items(insight_id);
CREATE INDEX idx_items_rank ON insight_items(rank);

-- Votes table (user engagement)
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  user_ip TEXT NOT NULL, -- Temporary identifier (replace with auth.uid() when auth is enabled)
  voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(person_id, user_ip, DATE(voted_at)) -- One vote per person per day per IP
);

CREATE INDEX idx_votes_person ON votes(person_id);
CREATE INDEX idx_votes_date ON votes(DATE(voted_at));

-- ============================================================================
-- API SCHEMA (Read-only views for frontend)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS api;

-- Current leaderboard view (latest snapshot per person with vote counts)
CREATE OR REPLACE VIEW api.leaderboard AS
SELECT 
  p.id,
  p.name,
  p.avatar,
  p.category,
  p.hero_img_url,
  ts.trend_score,
  ts.change_24h,
  ts.change_7d,
  ts.rank,
  ts.timestamp,
  COALESCE(v.vote_count, 0) AS votes
FROM persons p
LEFT JOIN LATERAL (
  SELECT * FROM trend_snapshots 
  WHERE person_id = p.id 
  ORDER BY timestamp DESC 
  LIMIT 1
) ts ON TRUE
LEFT JOIN (
  SELECT person_id, COUNT(*) as vote_count
  FROM votes
  WHERE voted_at >= NOW() - INTERVAL '7 days'
  GROUP BY person_id
) v ON v.person_id = p.id
WHERE ts.rank IS NOT NULL
ORDER BY ts.rank;

-- Person detail view
CREATE OR REPLACE VIEW api.person_detail AS
SELECT 
  p.id,
  p.name,
  p.avatar,
  p.category,
  p.hero_img_url,
  p.youtube_id,
  p.spotify_id,
  ts.trend_score,
  ts.change_24h,
  ts.change_7d,
  ts.rank,
  ts.timestamp,
  COALESCE(v.vote_count, 0) AS votes
FROM persons p
LEFT JOIN LATERAL (
  SELECT * FROM trend_snapshots 
  WHERE person_id = p.id 
  ORDER BY timestamp DESC 
  LIMIT 1
) ts ON TRUE
LEFT JOIN (
  SELECT person_id, COUNT(*) as vote_count
  FROM votes
  WHERE voted_at >= NOW() - INTERVAL '7 days'
  GROUP BY person_id
) v ON v.person_id = p.id;

-- Trend history view (for charts)
CREATE OR REPLACE VIEW api.trend_history AS
SELECT 
  ts.id,
  ts.person_id,
  ts.timestamp,
  ts.trend_score,
  ts.news_count,
  ts.youtube_views,
  ts.spotify_followers,
  ts.search_volume,
  ts.change_24h,
  ts.change_7d
FROM trend_snapshots ts
ORDER BY ts.timestamp DESC;

-- Platform insights view
CREATE OR REPLACE VIEW api.platform_insights AS
SELECT 
  pi.id,
  pi.person_id,
  pi.platform,
  pi.insight_type,
  pi.metric_name,
  json_agg(
    json_build_object(
      'rank', ii.rank,
      'title', ii.title,
      'metricValue', ii.metric_value,
      'link', ii.link,
      'imageUrl', ii.image_url,
      'timestamp', ii.timestamp
    ) ORDER BY ii.rank
  ) as items
FROM platform_insights pi
LEFT JOIN insight_items ii ON ii.insight_id = pi.id
GROUP BY pi.id, pi.person_id, pi.platform, pi.insight_type, pi.metric_name;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on votes table
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read votes
CREATE POLICY "Anyone can read votes"
  ON votes FOR SELECT
  USING (true);

-- Allow inserts via RPC function only (enforced in cast_vote function)
CREATE POLICY "Insert votes via RPC only"
  ON votes FOR INSERT
  WITH CHECK (false); -- Blocked by default, RPC bypasses this

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Cast vote function (with 24h rate limit per IP)
CREATE OR REPLACE FUNCTION cast_vote(p_person_id UUID, p_user_ip TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_vote_today INTEGER;
  v_new_vote_id UUID;
  v_total_votes INTEGER;
BEGIN
  -- Check if user already voted for this person today
  SELECT COUNT(*) INTO v_existing_vote_today
  FROM votes
  WHERE person_id = p_person_id
    AND user_ip = p_user_ip
    AND DATE(voted_at) = CURRENT_DATE;
  
  IF v_existing_vote_today > 0 THEN
    RAISE EXCEPTION 'You have already voted for this person today';
  END IF;
  
  -- Insert the vote
  INSERT INTO votes (person_id, user_ip)
  VALUES (p_person_id, p_user_ip)
  RETURNING id INTO v_new_vote_id;
  
  -- Get total votes for this person (last 7 days)
  SELECT COUNT(*) INTO v_total_votes
  FROM votes
  WHERE person_id = p_person_id
    AND voted_at >= NOW() - INTERVAL '7 days';
  
  RETURN json_build_object(
    'success', true,
    'vote_id', v_new_vote_id,
    'total_votes', v_total_votes
  );
END;
$$;

-- ============================================================================
-- REALTIME CONFIGURATION
-- ============================================================================

-- Enable realtime on trend_snapshots
ALTER PUBLICATION supabase_realtime ADD TABLE trend_snapshots;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant usage on api schema
GRANT USAGE ON SCHEMA api TO anon, authenticated;

-- Grant select on api views
GRANT SELECT ON api.leaderboard TO anon, authenticated;
GRANT SELECT ON api.person_detail TO anon, authenticated;
GRANT SELECT ON api.trend_history TO anon, authenticated;
GRANT SELECT ON api.platform_insights TO anon, authenticated;

-- Grant execute on RPC functions
GRANT EXECUTE ON FUNCTION cast_vote TO anon, authenticated;

-- Grant select on votes for reading
GRANT SELECT ON votes TO anon, authenticated;
