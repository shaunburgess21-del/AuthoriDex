import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { shouldAutoToast } from "@/lib/notifications/registry";
import { useInvalidateNotifications } from "@/hooks/useNotifications";
import { dispatchRankUp } from "@/components/RankUpModal";
import { STREAK_BADGE_KEYS } from "@shared/badge-config";
import { BadgeToast } from "@/components/BadgeToast";
import { createElement } from "react";

/**
 * Notification kinds that imply the user's credit balance just
 * changed on the server. When one of these arrives, we refresh the
 * AuthContext profile (the source for every balance pill) AND
 * invalidate /api/gamification/stats so the secondary callers
 * (HowItWorks ladder, predictions hero) catch up too.
 */
const BALANCE_CHANGING_KINDS = new Set<string>([
  "market_resolved",
  "credits_granted",
  "market_void_refund",
]);

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
  /**
   * Server-attached metadata. For rank_up notifications, contains
   * `{ newRank, previousRank, xp, newPersonalBest }` — the inputs
   * <RankUpModal /> needs to render the celebration without a
   * second round-trip. May be a JSON string or an object depending
   * on whether the row was hydrated through Drizzle or arrived raw
   * from Postgres LISTEN; we handle both shapes below.
   */
  metadata?: Record<string, unknown> | string | null;
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
  const { user, isLoggedIn, refreshProfile } = useAuth();
  const invalidate = useInvalidateNotifications();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const lastUserIdRef = useRef<string | null>(null);
  // Keep a stable ref to setLocation so the effect doesn't tear down the
  // realtime channel just because wouter handed us a new function ref.
  const setLocationRef = useRef(setLocation);
  setLocationRef.current = setLocation;
  // Same trick for refreshProfile so a re-render in AuthContext
  // doesn't tear the channel down.
  const refreshProfileRef = useRef(refreshProfile);
  refreshProfileRef.current = refreshProfile;

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

              // Balance-changing kinds: refresh the AuthContext
              // profile (source of every balance pill) and the
              // gamification stats query so the predict surfaces
              // catch up without forcing the user to navigate.
              // Pre-credits-overhaul, async parimutuel payouts left
              // the balance stale until a refocus or route change.
              if (BALANCE_CHANGING_KINDS.has(row.kind)) {
                refreshProfileRef.current().catch((err) => {
                  console.warn("[notifications] refreshProfile failed", err);
                });
                queryClient.invalidateQueries({
                  queryKey: ["/api/gamification/stats"],
                });
                queryClient.invalidateQueries({
                  queryKey: ["/api/gamification/credit-history"],
                });
              }

              // rank_up — bypass the auto-toast path and open the
              // RankUpModal instead. The modal needs the metadata
              // attached by gamificationService.awardXp() so it can
              // render the new tier name, total XP, and the "New
              // personal best" badge without a second fetch.
              if (row.kind === "rank_up") {
                const meta = parseMetadata(row.metadata);
                if (meta) {
                  dispatchRankUp({
                    newRank: String(meta.newRank ?? row.title),
                    previousRank: meta.previousRank
                      ? String(meta.previousRank)
                      : null,
                    xp: Number(meta.xp ?? 0),
                    newPersonalBest: Boolean(meta.newPersonalBest),
                  });
                }
                return;
              }

              // badge_awarded — high-priority kind. Streak-tier
              // badges are delayed 4s so they don't visually fight
              // with the existing streak_milestone toast that the
              // daily-checkin handler fires moments earlier.
              if (row.kind === "badge_awarded") {
                const meta = parseMetadata(row.metadata);
                const badgeKey = meta?.badgeKey
                  ? String(meta.badgeKey)
                  : null;
                const badgeName = meta?.badgeName
                  ? String(meta.badgeName)
                  : row.title.replace(/^New badge:\s*/i, "");
                const rarity = meta?.rarity ? String(meta.rarity) : "COMMON";
                const icon = meta?.icon ? String(meta.icon) : "award";
                const description =
                  (meta?.description ? String(meta.description) : null) ||
                  row.body ||
                  null;
                const delay =
                  badgeKey && STREAK_BADGE_KEYS.has(badgeKey) ? 4000 : 0;
                const fire = () => {
                  // Custom Sonner render so the toast picks up the
                  // rarity-coloured BadgeToast styling instead of the
                  // default text/description layout. Click anywhere on
                  // the toast surface still routes to /me/badges via
                  // the row.href fallback baked into the action below.
                  toast.custom(
                    (id) =>
                      createElement(BadgeToast, {
                        badgeKey: badgeKey ?? "",
                        badgeName,
                        description,
                        rarity,
                        icon,
                        onClose: () => toast.dismiss(id),
                      }),
                    {
                      duration: 6000,
                    },
                  );
                  // Invalidate the badges query so the trophy cabinet
                  // (/me/badges), Impact-tab voting badges, and the
                  // ProfileCompletionCard refresh in lock-step with
                  // the toast. Without this, the user sees "Badge
                  // unlocked" but `/me/badges` keeps the tile in the
                  // locked state until the page is reloaded.
                  queryClient.invalidateQueries({
                    queryKey: ["/api/me/badges"],
                  });
                };
                if (delay > 0) setTimeout(fire, delay);
                else fire();
                return;
              }

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
  }, [isLoggedIn, user?.id, invalidate, queryClient]);
}

/**
 * The realtime payload's `metadata` field can arrive as a JSON-encoded
 * string (when the row is read by the Postgres LISTEN payload format)
 * or as an already-parsed object (when Supabase Realtime hands us a
 * deserialised JSONB column). Tolerate both, fail closed on malformed
 * input rather than crashing the realtime subscriber.
 */
function parseMetadata(
  raw: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
