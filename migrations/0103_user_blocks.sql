-- One-directional user blocks for public comments.
-- The blocker stops seeing the blocked user's comments in threads they load.
-- Comments stay in place for everyone else. Additive and idempotent.
--
-- Each command is its own deploy statement. node-pg runs one command per query.

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id varchar NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id varchar NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON public.user_blocks (blocked_id);
--> statement-breakpoint

-- Deny-by-default via the Data API. Express uses the service role, which
-- bypasses RLS. Clients block and unblock through the API, not PostgREST.
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
