-- Add ISO 3166-1 alpha-2 country code to page_views, populated from IP geolocation.
--
-- Context: shared/schema.ts added this column in commit ab7b5e5 but no migration
-- file was generated, so production drifted. This migration catches the codebase
-- up so fresh dev databases and any future environment come out correct.
--
-- Uses ADD COLUMN IF NOT EXISTS so this is a no-op on any environment where the
-- column already exists (including production, which was patched by hand).

ALTER TABLE page_views ADD COLUMN IF NOT EXISTS country text;
