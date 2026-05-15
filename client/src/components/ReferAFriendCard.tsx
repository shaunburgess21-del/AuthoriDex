import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { sharePage } from "@/lib/share";
import { useAuth } from "@/contexts/AuthContext";

interface ReferralStats {
  referralCode: string | null;
  successfulReferrals: number;
  pendingReferrals: number;
}

/**
 * "Refer a Friend" card mounted on /me. Shows the user's referral
 * link, a copy + share affordance, and counters fed by
 * GET /api/me/referral-stats.
 *
 * Hides itself when the server hasn't generated a code yet (very
 * fresh signup pre-sync, or a backfill window for legacy accounts).
 * The next /api/profile/sync call populates the column, so this is
 * a transient state that resolves on its own.
 */
export function ReferAFriendCard() {
  const { isLoggedIn, user } = useAuth();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<ReferralStats>({
    queryKey: ["/api/me/referral-stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/referral-stats");
      return res.json();
    },
    enabled: isLoggedIn,
    staleTime: 60 * 1000,
  });

  if (!isLoggedIn) return null;
  if (isLoading) {
    return (
      <Card className="p-6 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    );
  }
  if (!data?.referralCode) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const referralUrl = `${origin}?ref=${data.referralCode}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      toast.success("Referral link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  const handleShare = () => {
    void sharePage("Join me on VoxDex", {
      sharerUserId: user?.id,
      surface: "referral",
      url: referralUrl,
    });
  };

  return (
    <Card className="p-6 space-y-4 border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <h3 className="font-semibold">Refer a Friend</h3>
        </div>
        <Badge variant="outline" className="text-xs">
          {data.successfulReferrals} successful
          {data.pendingReferrals > 0 ? ` · ${data.pendingReferrals} pending` : ""}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        Your friend gets 12,000 credits to start (10,000 signup grant + 2,000
        bonus). You get 500 credits when they make their first move.
      </p>

      <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
        <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
          {referralUrl}
        </code>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          aria-label="Copy referral link"
          data-testid="button-copy-referral"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={handleShare}
        data-testid="button-share-referral"
      >
        <Share2 className="h-4 w-4" />
        Share link
      </Button>
    </Card>
  );
}
