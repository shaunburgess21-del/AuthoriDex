import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, createElement, type CSSProperties } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "sonner";
import { useXpBurst } from "@/components/XpBurstProvider";
import { StreakToast } from "@/components/StreakToast";
import {
  STREAK_TOAST_DELAY_MS,
  STREAK_TOAST_DURATION_MS,
  STREAK_TOAST_WIDTH_CSS,
} from "@/lib/streak-config";

export type Capability = 
  | 'can_vote_sentiment'
  | 'can_vote_matchup'
  | 'can_vote_induction'
  | 'can_vote_curation'
  | 'can_post_insight'
  | 'can_comment'
  | 'can_predict';

interface Rank {
  id: number;
  name: string;
  tier: number;
  minXp: number;
  maxXp: number | null;
  voteMultiplier: number;
  color: string;
  icon: string | null;
  description: string | null;
}

interface UserStats {
  userId: string;
  username: string;
  xpPoints: number;
  predictCredits: number;
  rank: Rank | null;
  /** Peak rank ever reached. Null on legacy rows pre-backfill. */
  highestRank: Rank | null;
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string | null;
  capabilities: Record<Capability, boolean>;
}

/**
 * Response shape for POST /api/gamification/daily-checkin. Mirrors
 * the server contract in server/route-modules/gamification-routes.ts.
 */
interface DailyCheckinResponse {
  streak: number;
  longestStreak: number;
  xpAwarded: number;
  isMilestone: boolean;
  milestoneDay?: number;
  graceUsed?: boolean;
  bonusActionKey?: string | null;
  alreadyCheckedIn: boolean;
}

interface AwardXpResult {
  success: boolean;
  xpAwarded: number;
  newTotalXp: number;
  newRank: string | null;
  dailyCount: number;
  dailyCap: number | null;
  message: string;
}

interface AdjustCreditsResult {
  success: boolean;
  amount: number;
  newBalance: number;
  message: string;
}

interface XpAction {
  id: number;
  actionKey: string;
  displayName: string;
  xpValue: number;
  dailyCap: number | null;
  description: string | null;
  isActive: boolean;
}

interface DailySummary {
  [actionType: string]: {
    count: number;
    total: number;
    cap: number | null;
  };
}

export function useUserStats(enabled: boolean = true) {
  return useQuery<UserStats>({
    queryKey: ['/api/gamification/stats'],
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useCheckPermission(capability: Capability, enabled: boolean = true) {
  return useQuery<{ capability: string; hasPermission: boolean }>({
    queryKey: ['/api/gamification/check-permission', capability],
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

// NOTE: XP awards are handled internally by backend action handlers
// No direct mutation hook for XP - prevents client-side forging
// XP is automatically awarded when performing votes, comments, etc.

// NOTE: Credit adjustments are handled internally by prediction handlers
// Credits are automatically debited when placing predictions
// Credits are automatically credited when winning predictions

export function useXpHistory(limit: number = 20, enabled: boolean = true) {
  return useQuery({
    queryKey: ['/api/gamification/xp-history', { limit }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/gamification/xp-history?limit=${limit}`);
      return res.json();
    },
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useCreditHistory(limit: number = 20, enabled: boolean = true) {
  return useQuery({
    queryKey: ['/api/gamification/credit-history', { limit }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/gamification/credit-history?limit=${limit}`);
      return res.json();
    },
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useDailySummary(enabled: boolean = true) {
  return useQuery<DailySummary>({
    queryKey: ['/api/gamification/daily-summary'],
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useXpActions() {
  return useQuery<XpAction[]>({
    queryKey: ['/api/gamification/xp-actions'],
    staleTime: 5 * 60 * 1000,
  });
}

export function useRanks() {
  return useQuery<Rank[]>({
    queryKey: ['/api/gamification/ranks'],
    staleTime: 5 * 60 * 1000,
  });
}

export function usePermissions() {
  const { data: stats } = useUserStats();
  
  const checkPermission = (capability: Capability): boolean => {
    if (!stats?.capabilities) return false;
    return stats.capabilities[capability] ?? false;
  };

  const hasPermission = (capability: Capability): boolean => {
    return checkPermission(capability);
  };

  return {
    capabilities: stats?.capabilities ?? {},
    hasPermission,
    checkPermission,
    isLoaded: !!stats,
    rank: stats?.rank,
    xpPoints: stats?.xpPoints ?? 0,
    predictCredits: stats?.predictCredits ?? 0,
    currentStreak: stats?.currentStreak ?? 0,
  };
}

/**
 * Previously diffed `useUserStats` polling output to fire a rank-up
 * toast when the same user crossed a tier mid-session. That created
 * a race with the realtime `rank_up` notification path, which now
 * drives the RankUpModal — both fired on the same promotion and
 * users saw a duplicated celebration.
 *
 * After the ranks overhaul, all rank-up celebrations route through
 * the realtime notification (Path A) → RankUpModal. We keep the
 * exported hook (no-op) so existing call sites don't need to be
 * reworked, and so future client-side celebration triggers have an
 * obvious mounting point.
 */
export function useXpCelebration(_enabled: boolean = true) {
  // Intentionally empty — see docblock. Prefer touching
  // RankUpModal / useNotificationsRealtime for new rank celebrations.
}

/**
 * Module-level guard so the daily check-in fires at most once per
 * page lifetime per user. We intentionally use a module-level Set
 * (rather than sessionStorage) so a refresh DOES re-fire — refreshing
 * is a strong signal of user activity that we want to credit. A second
 * call from the same tab is the case we're guarding against (e.g. a
 * StrictMode double-mount or two components both invoking the hook).
 */
const checkedInUserIds = new Set<string>();

/**
 * Fires POST /api/gamification/daily-checkin exactly once per
 * authenticated user per page lifetime. On a successful response with
 * xpAwarded > 0, triggers the XP burst and the streak toast.
 *
 * Mounted from <App /> alongside <XpCelebrationWatcher />. The hook
 * is a no-op when `enabled` is false (e.g. logged out).
 */
export function useDailyCheckin(enabled: boolean = true) {
  const { data: stats } = useUserStats(enabled);
  const { trigger: triggerXpBurst } = useXpBurst();

  useEffect(() => {
    if (!enabled || !stats) return;
    const userId = stats.userId;
    if (!userId || checkedInUserIds.has(userId)) return;
    checkedInUserIds.add(userId);

    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("POST", "/api/gamification/daily-checkin");
        if (!res.ok) return;
        const data = (await res.json()) as DailyCheckinResponse;
        if (cancelled) return;

        // Refresh /stats so any UI bound to currentStreak / longestStreak /
        // xpPoints / lastLoginDate reflects the new values. We don't await
        // — the celebration animations don't need it to land first.
        queryClient.invalidateQueries({ queryKey: ['/api/gamification/stats'] });

        if (data.xpAwarded > 0) {
          const reason = data.isMilestone
            ? `Day ${data.milestoneDay} milestone`
            : data.streak > 1
              ? "Daily login + streak bonus"
              : "Daily login";

          triggerXpBurst(data.xpAwarded, undefined, reason);

          // Slight delay so the burst lands first, then the toast.
          setTimeout(() => {
            toast.custom(
              (id) =>
                createElement(StreakToast, {
                  currentStreak: data.streak,
                  longestStreak: data.longestStreak,
                  xpAwarded: data.xpAwarded,
                  reason,
                  isMilestone: data.isMilestone,
                  milestoneDay: data.milestoneDay,
                  graceUsed: data.graceUsed ?? false,
                  onClose: () => toast.dismiss(id),
                }),
              {
                duration: STREAK_TOAST_DURATION_MS,
                className:
                  "streak-toast-host p-0 bg-transparent border-0 shadow-none overflow-visible",
                style: {
                  "--width": STREAK_TOAST_WIDTH_CSS,
                } as CSSProperties,
              },
            );
          }, STREAK_TOAST_DELAY_MS);
        }
      } catch (err) {
        // Daily check-in is non-critical — swallow so a transient
        // failure doesn't pollute the console with red error spam.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[daily-checkin] failed", err);
        }
        // Allow a retry on the next mount for transient failures.
        checkedInUserIds.delete(userId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, stats, triggerXpBurst]);
}

export function generateIdempotencyKey(action: string, targetId?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return targetId 
    ? `${action}_${targetId}_${timestamp}_${random}`
    : `${action}_${timestamp}_${random}`;
}
