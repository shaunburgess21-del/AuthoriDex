-- Admin-configurable link controls for the site announcement banner.
-- link_label   : custom CTA text (falls back to "Learn more" when null + href set).
-- link_display : "cta_chevron" (separate CTA with chevron) or "inline_link" (Railway-style).

ALTER TABLE "site_announcements"
  ADD COLUMN IF NOT EXISTS "link_label" text,
  ADD COLUMN IF NOT EXISTS "link_display" text NOT NULL DEFAULT 'cta_chevron';
