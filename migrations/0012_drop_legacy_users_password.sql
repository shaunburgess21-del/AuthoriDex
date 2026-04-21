-- Drop the legacy `password` column from `users`.
--
-- Context: auth is handled entirely by Supabase + the `profiles` table. The
-- `users` table has been kept only for historical compatibility; the `password`
-- column has been marked `@deprecated` in `shared/schema.ts` for some time and
-- is not read or written by any code path (verified via grep across server/).
--
-- We use IF EXISTS so the migration is safe to apply on environments where an
-- earlier hand-patch already dropped the column.

ALTER TABLE users DROP COLUMN IF EXISTS password;
