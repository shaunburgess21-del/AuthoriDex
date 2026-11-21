-- Personal feed hides. The card stays live for everyone else.
-- Polymorphic card_id: no FK, same idea as card_reactions.target_id.
-- Express uses the service role, which bypasses RLS. No policies, so the
-- Data API cannot write this table. Clients hide and unhide through the API.
--
-- Each command is its own deploy statement. node-pg runs one command per query.

CREATE TABLE IF NOT EXISTS public.user_hidden_cards (
  user_id varchar NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_type text NOT NULL,
  card_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_type, card_id),
  CONSTRAINT user_hidden_cards_type_chk CHECK (card_type IN (
    'sentiment_poll', 'matchup', 'opinion_poll', 'value_person',
    'induction_candidate', 'curate_person',
    'market_updown', 'market_h2h', 'market_gainer', 'market_world'
  ))
);
--> statement-breakpoint

ALTER TABLE public.user_hidden_cards ENABLE ROW LEVEL SECURITY;
