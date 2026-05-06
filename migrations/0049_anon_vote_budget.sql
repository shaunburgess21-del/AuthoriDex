-- Phase 4 — Anonymous voting budget
-- Tracks budget units consumed by anonymous identities (fdx_sid cookie).
-- One row per (fdx_sid, surface_type, target_id). Re-votes are upserts → 0 additional units.
-- All rows for a given fdx_sid are deleted when the user signs up.
--
-- Surface taxonomy (5 values):
--   matchup_poll      — POST /api/matchups/:id/vote
--   opinion_poll      — POST /api/opinion-polls/:slug/vote
--   induction         — POST /api/vote/induction/:id/vote
--   trending_poll     — POST /api/polls/:slug/vote (in-handler comment confirms it's the trending-poll surface)
--   celebrity_person  — folds value-vote + approval-rating onto one person (D2)
--
-- 'sentiment_poll' was in an earlier draft of the brief but no such endpoint
-- exists in the codebase today; if a true sentiment-only surface is added
-- later, an ALTER TABLE migration to extend the CHECK is trivial.

CREATE TABLE IF NOT EXISTS public.anon_vote_budget (
  fdx_sid       text NOT NULL,
  surface_type  text NOT NULL,
  target_id     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fdx_sid, surface_type, target_id),
  CONSTRAINT anon_vote_budget_surface_check CHECK (surface_type IN (
    'matchup_poll',
    'opinion_poll',
    'induction',
    'trending_poll',
    'celebrity_person'
  ))
);

CREATE INDEX IF NOT EXISTS anon_vote_budget_sid_idx
  ON public.anon_vote_budget (fdx_sid);

CREATE INDEX IF NOT EXISTS anon_vote_budget_created_idx
  ON public.anon_vote_budget (created_at);

-- Server-only table: written exclusively by server/lib/anonBudget.ts via the
-- Drizzle service-role connection, never queried by the client. We disable
-- RLS explicitly so the Supabase advisor doesn't flag "RLS enabled, no
-- policy" on this table and so the access posture is unambiguous. Matches
-- the pattern established in migration 0040 and 0045 (admin_broadcasts).
ALTER TABLE public.anon_vote_budget DISABLE ROW LEVEL SECURITY;
