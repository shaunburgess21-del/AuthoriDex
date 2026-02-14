-- Sentiment Voting Enhancement for AuthoriDex
-- Add sentiment_value column to votes table and create aggregation function

-- Add sentiment_value column (1-10 scale)
ALTER TABLE votes ADD COLUMN IF NOT EXISTS sentiment_value INTEGER CHECK (sentiment_value >= 1 AND sentiment_value <= 10);

-- Update unique constraint to allow one vote per person per user per day
-- (This was already in the schema, but ensuring it's correct)

-- Create RPC function to get sentiment distribution for a person
CREATE OR REPLACE FUNCTION get_sentiment_distribution(p_person_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_distribution JSON;
BEGIN
  -- Get count of votes per sentiment value (1-10) for the last 30 days
  SELECT json_object_agg(
    sentiment_value::text,
    vote_count
  ) INTO v_distribution
  FROM (
    SELECT 
      sentiment_value,
      COUNT(*) as vote_count
    FROM votes
    WHERE person_id = p_person_id
      AND voted_at >= NOW() - INTERVAL '30 days'
      AND sentiment_value IS NOT NULL
    GROUP BY sentiment_value
    ORDER BY sentiment_value
  ) distribution;
  
  -- Return empty object if no votes
  RETURN COALESCE(v_distribution, '{}'::json);
END;
$$;

-- Update cast_vote function to accept sentiment_value
CREATE OR REPLACE FUNCTION cast_vote(p_person_id UUID, p_user_ip TEXT, p_sentiment_value INTEGER)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_vote_today INTEGER;
  v_new_vote_id UUID;
  v_total_votes INTEGER;
  v_distribution JSON;
BEGIN
  -- Validate sentiment value
  IF p_sentiment_value < 1 OR p_sentiment_value > 10 THEN
    RAISE EXCEPTION 'Sentiment value must be between 1 and 10';
  END IF;
  
  -- Check if user already voted for this person today
  SELECT COUNT(*) INTO v_existing_vote_today
  FROM votes
  WHERE person_id = p_person_id
    AND user_ip = p_user_ip
    AND DATE(voted_at) = CURRENT_DATE;
  
  IF v_existing_vote_today > 0 THEN
    -- Update existing vote instead of creating new one
    UPDATE votes
    SET sentiment_value = p_sentiment_value,
        voted_at = NOW()
    WHERE person_id = p_person_id
      AND user_ip = p_user_ip
      AND DATE(voted_at) = CURRENT_DATE
    RETURNING id INTO v_new_vote_id;
  ELSE
    -- Insert the vote
    INSERT INTO votes (person_id, user_ip, sentiment_value)
    VALUES (p_person_id, p_user_ip, p_sentiment_value)
    RETURNING id INTO v_new_vote_id;
  END IF;
  
  -- Get total votes for this person (last 30 days)
  SELECT COUNT(*) INTO v_total_votes
  FROM votes
  WHERE person_id = p_person_id
    AND voted_at >= NOW() - INTERVAL '30 days';
  
  -- Get distribution
  v_distribution := get_sentiment_distribution(p_person_id);
  
  RETURN json_build_object(
    'success', true,
    'vote_id', v_new_vote_id,
    'total_votes', v_total_votes,
    'distribution', v_distribution,
    'updated', v_existing_vote_today > 0
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_sentiment_distribution TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cast_vote TO anon, authenticated;

-- Update api.person_detail view to include sentiment distribution
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
  COALESCE(v.vote_count, 0) AS votes,
  get_sentiment_distribution(p.id) AS sentiment_distribution
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
  WHERE voted_at >= NOW() - INTERVAL '30 days'
  GROUP BY person_id
) v ON v.person_id = p.id;
