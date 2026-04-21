-- Add missing foreign keys for referential integrity.
--
-- Context: several columns reference row IDs in other tables but have no FK
-- constraint, which means a stray application bug or a rogue SQL statement
-- could orphan rows silently. Adding these FKs as NOT VALID means:
--
--   • New INSERTs / UPDATEs are checked against the constraint immediately.
--   • Existing rows are NOT scanned at migration time (so this stays fast on
--     production data even with millions of rows).
--   • If there are already orphans, the migration still succeeds. You can
--     then audit + clean them up, and run `ALTER TABLE ... VALIDATE
--     CONSTRAINT` on your own schedule.
--
-- Every block is guarded by `to_regclass(...) IS NOT NULL` on BOTH the source
-- and target table, plus a `pg_constraint` existence check. This makes the
-- migration:
--   • Idempotent — re-running against an already-patched environment is a no-op.
--   • Drift-tolerant — if a referenced table doesn't yet exist in this environment
--     (e.g. `comment_reports` exists in schema.ts but wasn't in prod yet), the
--     FK is silently skipped with a NOTICE instead of crashing the deploy.
--     A later migration that creates the missing table can add the FK itself.
--
-- To validate (scan + enforce) later, after cleaning orphans:
--   ALTER TABLE user_votes         VALIDATE CONSTRAINT fk_user_votes_person;
--   ALTER TABLE community_insights VALIDATE CONSTRAINT fk_community_insights_person;
--   ALTER TABLE credit_ledger      VALIDATE CONSTRAINT fk_credit_ledger_user;
--   ALTER TABLE celebrity_profiles VALIDATE CONSTRAINT fk_celebrity_profiles_person;
--   ALTER TABLE comment_reports    VALIDATE CONSTRAINT fk_comment_reports_comment;

-- ─── user_votes.person_id → tracked_people.id ───────────────────────────────
-- Drop on person deletion is what we want — votes are meaningless without
-- the person. This is rare (tracked_people deletion is basically never).
DO $$
BEGIN
  IF to_regclass('public.user_votes') IS NULL
     OR to_regclass('public.tracked_people') IS NULL THEN
    RAISE NOTICE 'Skipping fk_user_votes_person: source or target table missing.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_votes_person'
  ) THEN
    ALTER TABLE user_votes
      ADD CONSTRAINT fk_user_votes_person
      FOREIGN KEY (person_id) REFERENCES tracked_people(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END$$;

-- ─── community_insights.person_id → tracked_people.id ──────────────────────
DO $$
BEGIN
  IF to_regclass('public.community_insights') IS NULL
     OR to_regclass('public.tracked_people') IS NULL THEN
    RAISE NOTICE 'Skipping fk_community_insights_person: source or target table missing.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_community_insights_person'
  ) THEN
    ALTER TABLE community_insights
      ADD CONSTRAINT fk_community_insights_person
      FOREIGN KEY (person_id) REFERENCES tracked_people(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END$$;

-- ─── celebrity_profiles.person_id → tracked_people.id ──────────────────────
-- Already has a UNIQUE constraint; adding the FK completes the logical 1:1.
DO $$
BEGIN
  IF to_regclass('public.celebrity_profiles') IS NULL
     OR to_regclass('public.tracked_people') IS NULL THEN
    RAISE NOTICE 'Skipping fk_celebrity_profiles_person: source or target table missing.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_celebrity_profiles_person'
  ) THEN
    ALTER TABLE celebrity_profiles
      ADD CONSTRAINT fk_celebrity_profiles_person
      FOREIGN KEY (person_id) REFERENCES tracked_people(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END$$;

-- ─── credit_ledger.user_id → profiles.id ───────────────────────────────────
-- NO CASCADE. Credit history is an audit log — we never want to lose it just
-- because a profile row was pruned. Use RESTRICT so deletions surface explicitly.
DO $$
BEGIN
  IF to_regclass('public.credit_ledger') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE NOTICE 'Skipping fk_credit_ledger_user: source or target table missing.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_credit_ledger_user'
  ) THEN
    ALTER TABLE credit_ledger
      ADD CONSTRAINT fk_credit_ledger_user
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END$$;

-- ─── comment_reports.comment_id → insight_comments.id ──────────────────────
-- CASCADE so removing a comment also removes any reports against it.
DO $$
BEGIN
  IF to_regclass('public.comment_reports') IS NULL
     OR to_regclass('public.insight_comments') IS NULL THEN
    RAISE NOTICE 'Skipping fk_comment_reports_comment: source or target table missing.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_comment_reports_comment'
  ) THEN
    ALTER TABLE comment_reports
      ADD CONSTRAINT fk_comment_reports_comment
      FOREIGN KEY (comment_id) REFERENCES insight_comments(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END$$;
