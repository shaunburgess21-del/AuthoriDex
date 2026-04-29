-- Canonical category registry for CMS (admin-managed). Content tables still store
-- category as text; usage is matched with normalizeMarketCategory() on the server.

CREATE TABLE IF NOT EXISTS public.content_categories (
  id varchar(64) PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO public.content_categories (id, label, sort_order) VALUES
  ('tech', 'Tech', 10),
  ('politics', 'Politics', 20),
  ('business', 'Business', 30),
  ('music', 'Music', 40),
  ('sports', 'Sports', 50),
  ('film-tv', 'Film & TV', 60),
  ('gaming', 'Gaming', 70),
  ('creator', 'Creator', 80),
  ('comedy', 'Comedy', 90),
  ('food-drink', 'Food & Drink', 100),
  ('lifestyle', 'Lifestyle', 110),
  ('misc', 'Misc', 120)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.content_categories ENABLE ROW LEVEL SECURITY;
