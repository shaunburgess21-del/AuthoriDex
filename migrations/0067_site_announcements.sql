-- Site-wide announcement strip (public banner above app content).
-- Distinct from admin_broadcasts / in-app notification fan-out.

CREATE TABLE IF NOT EXISTS public.site_announcements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  href text,
  style text NOT NULL DEFAULT 'promo',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  is_enabled boolean NOT NULL DEFAULT true,
  dismissible boolean NOT NULL DEFAULT true,
  created_by varchar REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_announcements_starts_at
  ON public.site_announcements (starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_announcements_enabled
  ON public.site_announcements (is_enabled)
  WHERE is_enabled = true;
