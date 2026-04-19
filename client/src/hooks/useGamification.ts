import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useXpBurst } from "@/components/XpBurstProvider";

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
  currentStreak: number;
  capabilities: Record<Capability, boolean>;
  /** Present when a daily_login (+ optional streak_bonus) award fired this call. Null otherwise. */
  xp?: { xpAwarded: number; reason: string } | null;
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

export function useXpCelebration(enabled: boolean = true) {
  const { data: stats } = useUserStats(enabled);
  const { data: ranks } = useRanks();
  const { toast } = useToast();
  const { trigger: triggerXpBurst } = useXpBurst();
  const prevRef = useRef<{ xp: number; rank: string } | null>(null);
  const firedLoginBurstRef = useRef<string | null>(null);

  useEffect(() => {
    if (!stats) return;

    // Daily-login + streak-bonus: fire a burst the first time we see an xp
    // payload for this page-session. The server only returns xp once per UTC
    // day (idempotent); we additionally de-dupe against re-renders by keying
    // on xpAwarded + reason so two identical payloads won't fire twice.
    if (stats.xp && stats.xp.xpAwarded > 0) {
      const key = `${stats.xp.xpAwarded}:${stats.xp.reason}`;
      if (firedLoginBurstRef.current !== key) {
        firedLoginBurstRef.current = key;
        triggerXpBurst(stats.xp.xpAwarded, undefined, stats.xp.reason);
      }
    }

    const currentXp = stats.xpPoints;
    const currentRank = stats.rank?.name ?? 'Citizen';

    if (prevRef.current === null) {
      prevRef.current = { xp: currentXp, rank: currentRank };
      return;
    }

    const prev = prevRef.current;

    if (currentRank !== prev.rank && ranks && ranks.length > 0) {
      const prevTier = ranks.find(r => r.name === prev.rank)?.tier ?? 0;
      const currentTier = ranks.find(r => r.name === currentRank)?.tier ?? 0;
      if (currentTier > prevTier) {
        toast({
          title: `Rank Up: ${currentRank}!`,
          description: `You've reached the ${currentRank} rank. Keep going!`,
        });
      }
    }

    prevRef.current = { xp: currentXp, rank: currentRank };
  }, [stats, ranks, toast, triggerXpBurst]);
}

export function generateIdempotencyKey(action: string, targetId?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return targetId 
    ? `${action}_${targetId}_${timestamp}_${random}`
    : `${action}_${timestamp}_${random}`;
}
