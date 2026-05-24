-- Weekly lifetime leaderboard rank snapshots for Weekly Wrap rank-delta copy.

CREATE TABLE IF NOT EXISTS public.user_rank_snapshots (
  user_id varchar NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  iso_week text NOT NULL,
  period text NOT NULL DEFAULT 'all',
  rank integer NOT NULL,
  captured_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, iso_week, period)
);

CREATE INDEX IF NOT EXISTS user_rank_snapshots_week_period_idx
  ON public.user_rank_snapshots (iso_week, period);

ALTER TABLE public.user_rank_snapshots DISABLE ROW LEVEL SECURITY;
