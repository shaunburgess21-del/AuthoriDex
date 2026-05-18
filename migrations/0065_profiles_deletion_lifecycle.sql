-- User-initiated account deletion with a 7-day soft-delete window.
--
-- Three new nullable timestamp columns on `profiles`:
--
--   deletion_requested_at  Stamped when the user clicks "Delete my
--                          account" (POST /api/me/account/delete).
--                          Triggers a 7-day cooling-off period
--                          during which the deletion can still be
--                          cancelled. Resetting to NULL via cancel
--                          aborts the schedule.
--
--   deletion_scheduled_for The exact moment after which the hourly
--                          sweeper will anonymise the profile.
--                          Always `deletion_requested_at + INTERVAL
--                          '7 days'` at request time; recorded
--                          separately so an admin can adjust the
--                          window for an individual account
--                          without changing the requested-at
--                          forensic timestamp.
--
--   deleted_at             Stamped by the sweeper when the row has
--                          actually been anonymised. After this is
--                          set, the row's PII fields are NULL, the
--                          username is randomised (deleted_<uuid>),
--                          is_public is forced false, and
--                          predict_credits is zeroed. The ROW
--                          ITSELF stays in the table so that
--                          credit_ledger, market_bets, comments,
--                          insight_votes, etc. FKs continue to
--                          resolve and the audit trail survives.
--
-- All three columns default to NULL and are entirely backward-
-- compatible — every existing profile is "not pending deletion".
--
-- Index on (deletion_scheduled_for) so the sweeper's
-- `WHERE deletion_scheduled_for <= NOW() AND deleted_at IS NULL`
-- scan stays planner-friendly even at millions of rows. Partial
-- index keeps the index small (only pending-deletion rows).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_scheduled_for timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_deletion_scheduled_for_idx
  ON public.profiles (deletion_scheduled_for)
  WHERE deletion_scheduled_for IS NOT NULL AND deleted_at IS NULL;
