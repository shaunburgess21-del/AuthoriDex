-- Re-baseline migration (no-op).
-- This migration exists solely to anchor the drizzle-kit snapshot at the
-- current schema state. All tables, enums, indexes, and constraints already
-- exist in the database from migrations 0000–0049.
SELECT 1;
