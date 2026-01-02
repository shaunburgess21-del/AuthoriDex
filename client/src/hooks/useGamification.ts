import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type Capability = 
  | 'can_vote_sentiment'
  | 'can_vote_face_off'
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
}

interface UserStats {
  userId: string;
  username: string;
  xpPoints: number;
  predictCredits: number;
  rank: Rank | null;
  currentStreak: number;
  capabilities: Record<Capability, boolean>;
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
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useCreditHistory(limit: number = 20, enabled: boolean = true) {
  return useQuery({
    queryKey: ['/api/gamification/credit-history', { limit }],
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

export function generateIdempotencyKey(action: string, targetId?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return targetId 
    ? `${action}_${targetId}_${timestamp}_${random}`
    : `${action}_${timestamp}_${random}`;
}
