-- Inbox gesture preference: when true, swipe-right dismisses and swipe-left
-- marks read (default is the opposite).

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS invert_notification_swipe boolean NOT NULL DEFAULT false;
