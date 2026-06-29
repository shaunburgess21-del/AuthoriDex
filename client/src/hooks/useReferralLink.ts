import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { sharePage } from "@/lib/share";
import { useAuth } from "@/contexts/AuthContext";

export interface ReferralStats {
  referralCode: string | null;
  successfulReferrals: number;
  pendingReferrals: number;
}

export interface UseReferralLink {
  stats: ReferralStats | undefined;
  referralCode: string | null;
  referralUrl: string | null;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  /** True once a non-empty referral code is available. */
  hasCode: boolean;
  /** Reflects the most recent copy action (auto-resets after 2s). */
  copied: boolean;
  copy: () => Promise<void>;
  share: () => void;
  refetch: () => void;
}

const REFERRAL_STATS_KEY = ["/api/me/referral-stats"] as const;

/**
 * Single source of truth for the referral link + share/copy affordances.
 * Shared by ReferAFriendCard (/me), the ReferralPromptModal, and any
 * out-of-Vox / menu entry points so the query key, URL shape, and toast
 * behaviour never drift across surfaces.
 *
 * The link is built client-side as `${origin}?ref=${code}` — same shape
 * the inbound capture in `referral-capture.ts` expects. Sharing routes
 * through `sharePage` with `surface: "referral"` so attribution stays
 * consistent with the existing card.
 */
export function useReferralLink(): UseReferralLink {
  const { isLoggedIn, user } = useAuth();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, isFetching } = useQuery<ReferralStats>({
    queryKey: REFERRAL_STATS_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/referral-stats");
      return res.json();
    },
    enabled: isLoggedIn,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const referralCode = data?.referralCode ?? null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const referralUrl = referralCode ? `${origin}?ref=${referralCode}` : null;

  const copy = useCallback(async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      toast.success("Referral link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
  }, [referralUrl]);

  const share = useCallback(() => {
    if (!referralUrl) return;
    void sharePage("Join me on VoxDex", {
      sharerUserId: user?.id,
      surface: "referral",
      url: referralUrl,
    });
  }, [referralUrl, user?.id]);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: REFERRAL_STATS_KEY });
  }, [queryClient]);

  return {
    stats: data,
    referralCode,
    referralUrl,
    isLoading,
    isError,
    isFetching,
    hasCode: Boolean(referralCode),
    copied,
    copy,
    share,
    refetch,
  };
}
