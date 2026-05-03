-- Admin-authored broadcast notifications.
--
-- Why a dedicated table instead of just inserting N notification rows?
--
--   1. Auditability: a single source-of-truth for "what did we send,
--      to who, when, and why" — survives even if individual user
--      notification rows are dismissed/cleaned up.
--   2. Analytics: seen/read/click rate per broadcast is computed by
--      joining notifications.idempotencyKey LIKE 'broadcast:<id>:%'
--      so we read aggregate stats from the canonical notification
--      log without snapshotting them here (and risking drift).
--   3. Replay/cancel: a scheduled broadcast can be cancelled before
--      sendAt; in-flight failed sends can be retried by the same
--      broadcast row's idempotencyKey without duplicating user rows
--      (the unique (user_id, idempotency_key) constraint absorbs).
--
-- Audience is stored as JSONB so the schema stays flexible while we
-- iterate on segmentation rules without a migration each time.

CREATE TABLE IF NOT EXISTS public.admin_broadcasts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Admin who composed/sent the broadcast. Profile may be deleted later;
  -- ON DELETE SET NULL preserves the audit trail without a dangling FK.
  created_by varchar REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text,
  href text,
  -- 0 = silent (bell only), 1 = high (auto-toast). Mirrors the
  -- notifications.priority semantics so the dispatcher can pass through.
  priority integer NOT NULL DEFAULT 1,
  -- Notification category — defaults to 'system' so it composes with
  -- the user's "Announcements" category preference. Admins could in
  -- future pick e.g. 'predictions' for a market-related comms blast.
  category text NOT NULL DEFAULT 'system',
  -- JSONB describing the audience filter. Shape (V1):
  --   { "kind": "everyone" }
  --   { "kind": "active_30d" }
  --   { "kind": "placed_bet" }
  --   { "kind": "category_subscribers", "category": "sports" }
  --   { "kind": "single_user", "userId": "..." }
  --   { "kind": "test_self" }
  audience jsonb NOT NULL,
  -- Snapshot at send-time so historical rows still tell the truth even
  -- if the underlying user base shifts.
  target_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  -- 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'
  status text NOT NULL DEFAULT 'draft',
  scheduled_for timestamp,
  sent_at timestamp,
  cancelled_at timestamp,
  -- Stable per-broadcast key. Per-user idempotency keys are derived
  -- as `broadcast:<id>:<userId>` so the same broadcast can be safely
  -- retried mid-send without duplicating notification rows.
  idempotency_key text NOT NULL UNIQUE,
  -- Last error (truncated) when status='failed'.
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created_at
  ON public.admin_broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_status
  ON public.admin_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_scheduled_for
  ON public.admin_broadcasts(scheduled_for)
  WHERE status = 'scheduled';

-- Server-only table: API routes already gate on requireAdmin. We keep
-- RLS disabled here so cron/derivation jobs (running as the service
-- role) can read broadcast rows without per-policy scaffolding.
ALTER TABLE public.admin_broadcasts DISABLE ROW LEVEL SECURITY;
