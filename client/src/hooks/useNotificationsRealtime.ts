import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { shouldAutoToast } from "@/lib/notifications/registry";
import { useInvalidateNotifications } from "@/hooks/useNotifications";

/**
 * Realtime payload uses raw DB column names (snake_case) — this is
 * NOT the same shape as `NotificationRow` from `lib/notifications/types`,
 * which mirrors the camelCase Drizzle/JSON output. We only access
 * single-word columns here (kind, title, body, href) so the camelCase
 * vs snake_case distinction happens to be invisible — but typing the
 * raw payload keeps that fact explicit for the next reader.
 */
interface RealtimeNotificationPayload {
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
}

/**
 * Subscribe to live notification inserts via Supabase Realtime.
 *
 * - Filters by user_id so we don't receive other users' rows.
 * - Invalidates the unread count + list queries on every insert.
 * - Auto-toasts high-priority kinds (market_resolved, rank_up,
 *   credits_granted, announcement). Lower priority kinds land
 *   silently in the bell — exactly the "calm by default" UX the plan
 *   calls for.
 *
 * The polling fallback already lives in `useNotificationCounts`
 * (60s interval) so if Realtime is unavailable for any reason the
 * badge still updates within a minute.
 *
 * Mount this once at the app root (alongside <Toaster />). Mounting
 * it more than once would create duplicate channels and double-toast.
 */
export function useNotificationsRealtime(): void {
  const { user, isLoggedIn } = useAuth();
  const invalidate = useInvalidateNotifications();
  const [, setLocation] = useLocation();
  const lastUserIdRef = useRef<string | null>(null);
  // Keep a stable ref to setLocation so the effect doesn't tear down the
  // realtime channel just because wouter handed us a new function ref.
  const setLocationRef = useRef(setLocation);
  setLocationRef.current = setLocation;

  useEffect(() => {
    if (!isLoggedIn || !user?.id) {
      lastUserIdRef.current = null;
      return;
    }

    let cancelled = false;
    let channelRef: { unsubscribe: () => void } | null = null;

    (async () => {
      try {
        const supabase = await getSupabase();
        if (cancelled) return;

        // Channel name includes userId so each user has their own bus
        // and we don't accidentally fan out events across tabs of
        // different sessions in the same browser.
        const channel = supabase
          .channel(`notifications:user:${user.id}`)
          .on(
            "postgres_changes" as never,
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
              filter: `user_id=eq.${user.id}`,
            },
            (payload: { new: RealtimeNotificationPayload }) => {
              const row = payload?.new;
              invalidate();

              if (!row) return;

              // Best-effort toast for high-priority kinds. We use the
              // existing Sonner instance mounted in App.tsx so the
              // styling matches every other toast in the app.
              if (shouldAutoToast(row.kind)) {
                const description = row.body || undefined;
                const href = row.href;
                if (href) {
                  toast(row.title, {
                    description,
                    action: {
                      label: "View",
                      onClick: () => {
                        // Internal links → SPA navigation via wouter.
                        // External links (rare) → full-page navigate.
                        if (/^https?:\/\//i.test(href)) {
                          window.location.assign(href);
                        } else {
                          setLocationRef.current(href);
                        }
                      },
                    },
                  });
                } else {
                  toast(row.title, { description });
                }
              }
            },
          )
          .subscribe();

        channelRef = {
          unsubscribe: () => {
            try {
              supabase.removeChannel(channel);
            } catch (err) {
              console.warn("[notifications] removeChannel failed", err);
            }
          },
        };
        lastUserIdRef.current = user.id;
      } catch (err) {
        console.warn("[notifications] realtime subscribe failed", err);
      }
    })();

    return () => {
      cancelled = true;
      channelRef?.unsubscribe();
    };
  }, [isLoggedIn, user?.id, invalidate]);
}
