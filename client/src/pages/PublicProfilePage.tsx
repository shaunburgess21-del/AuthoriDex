import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarGradient, getAvatarInitials } from "@/lib/avatar";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, User, Trophy, Vote, TrendingUp, Calendar, Lock, Sparkles,
  Shield, BrainCircuit, BarChart3, Coins, Target, ChevronRight, Loader2, Share2, Check,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface PublicProfile {
  username: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  rank?: string;
  xpPoints?: number;
  totalVotes?: number;
  totalPredictions?: number;
  winRate?: number;
  isAgent?: boolean;
  isPublic: boolean;
  createdAt?: string;
  message?: string;
  profitLoss?: number;
  volume?: number;
  totalBets?: number;
  biggestWin?: number;
  agentProfile?: {
    displayName: string;
    bio?: string | null;
    archetype: string;
    specialties: string[];
    totalEntered?: number;
    accuracy?: number | null;
  } | null;
}

interface BetRecord {
  betId: string;
  marketSlug: string;
  marketTitle: string;
  marketType: string;
  marketCategory: string;
  entryLabel: string;
  stakeAmount: number;
  payout: number;
  pnl: number;
  status: string;
  confidence: number | null;
  thesis: string | null;
  predictedScore: number | null;
  placedAt: string;
  settledAt: string | null;
}

interface BetsResponse {
  bets: BetRecord[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

function ShareLinkButton({ url, label }: { url: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: label });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy} title="Copy link">
      {copied ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <Share2 className="h-4 w-4" />}
    </Button>
  );
}

function RankBadge({ rank }: { rank: string }) {
  const badgeConfig: Record<string, { color: string; icon: typeof Shield }> = {
    "Citizen": { color: "bg-gray-500/25 dark:bg-gray-500/20 text-gray-500 dark:text-gray-300 border-gray-500/40 dark:border-gray-500/30", icon: Shield },
    "Aspirant": { color: "bg-green-500/25 dark:bg-green-500/20 text-green-500 dark:text-green-300 border-green-500/40 dark:border-green-500/30", icon: Shield },
    "Insider": { color: "bg-blue-500/25 dark:bg-blue-500/20 text-blue-500 dark:text-blue-300 border-blue-500/40 dark:border-blue-500/30", icon: Sparkles },
    "Analyst": { color: "bg-purple-500/25 dark:bg-purple-500/20 text-purple-500 dark:text-purple-300 border-purple-500/40 dark:border-purple-500/30", icon: Sparkles },
    "Expert": { color: "bg-amber-500/25 dark:bg-amber-500/20 text-amber-500 dark:text-amber-300 border-amber-500/40 dark:border-amber-500/30", icon: Trophy },
    "Maven": { color: "bg-red-500/25 dark:bg-red-500/20 text-red-500 dark:text-red-300 border-red-500/40 dark:border-red-500/30", icon: Trophy },
    "Hall of Famer": { color: "bg-yellow-500/25 dark:bg-yellow-500/20 text-yellow-500 dark:text-yellow-300 border-yellow-500/40 dark:border-yellow-500/30", icon: Trophy },
  };
  const config = badgeConfig[rank] || badgeConfig["Citizen"];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {rank}
    </Badge>
  );
}

function BetHistorySection({ username }: { username: string }) {
  const [tab, setTab] = useState<"settled" | "active">("settled");
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<BetsResponse>({
    queryKey: ["/api/profile/u", username, "bets", tab],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/profile/u/${username}/bets?tab=${tab}&limit=50`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch bets");
      return res.json();
    },
    enabled: !!username,
  });

  const bets = data?.bets ?? [];

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Prediction History</h2>
        <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
          <button
            onClick={() => setTab("settled")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              tab === "settled" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Closed
          </button>
          <button
            onClick={() => setTab("active")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              tab === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-8 text-destructive text-sm">
          Failed to load prediction history
        </div>
      ) : bets.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {tab === "active" ? "No active predictions" : "No settled predictions yet"}
        </div>
      ) : (
        <div className="space-y-2">
          {bets.map((bet) => (
            <div
              key={bet.betId}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer group"
              onClick={() => setLocation(`/markets/${bet.marketSlug}`)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {bet.status === "won" && (
                    <Badge variant="outline" className="bg-emerald-500/15 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30 text-[10px] px-1.5 py-0">Won</Badge>
                  )}
                  {bet.status === "lost" && (
                    <Badge variant="outline" className="bg-red-500/15 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/40 dark:border-red-500/30 text-[10px] px-1.5 py-0">Lost</Badge>
                  )}
                  {bet.status === "active" && (
                    <Badge variant="outline" className="bg-blue-500/15 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/40 dark:border-blue-500/30 text-[10px] px-1.5 py-0">Active</Badge>
                  )}
                  {(bet.status === "void" || bet.status === "refunded") && (
                    <Badge variant="outline" className="bg-gray-500/15 dark:bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/40 dark:border-gray-500/30 text-[10px] px-1.5 py-0">Void</Badge>
                  )}
                  <span className="text-sm font-medium truncate">{bet.marketTitle}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-violet-600 dark:text-violet-400 font-medium">
                    {bet.predictedScore != null ? bet.entryLabel
                      : bet.marketType === 'updown' ? `Picked: ${bet.entryLabel}`
                      : `Backed: ${bet.entryLabel}`}
                  </span>
                  {bet.predictedScore != null && (
                    <span className="text-amber-600 dark:text-amber-400">Score: {Number(bet.predictedScore).toLocaleString()}</span>
                  )}
                  {bet.confidence != null && (
                    <span className="text-cyan-600 dark:text-cyan-400">{Math.round(bet.confidence * 100)}% conf</span>
                  )}
                  <span>{bet.stakeAmount.toLocaleString()} credits</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                {bet.status === "won" && (
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">+{bet.pnl.toLocaleString()}</span>
                )}
                {bet.status === "lost" && (
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">{bet.pnl.toLocaleString()}</span>
                )}
                {bet.status === "active" && (
                  <span className="text-sm text-muted-foreground">{bet.stakeAmount.toLocaleString()}</span>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          ))}
          {data?.hasMore && (
            <p className="text-center text-xs text-muted-foreground pt-2">Showing first {bets.length} results</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function PublicProfilePage() {
  const [, params] = useRoute("/u/:username");
  const [, setLocation] = useLocation();
  const username = params?.username;

  const { data: profile, isLoading, error } = useQuery<PublicProfile>({
    queryKey: ["/api/profile/u", username],
    enabled: !!username,
  });

  const xpLevel = Math.floor((profile?.xpPoints || 0) / 500) + 1;

  if (isLoading) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="flex items-center gap-4 mb-6">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Profile</span>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 max-w-md">
          <Card className="p-8 text-center">
            <User className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">User Not Found</h2>
            <p className="text-muted-foreground">The user @{username} does not exist.</p>
            <Button variant="outline" className="mt-6" onClick={() => setLocation("/")} data-testid="button-go-home">Go to Homepage</Button>
          </Card>
        </div>
      </div>
    );
  }

  if (!profile.isPublic) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Profile</span>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 max-w-md">
          <Card className="p-8 text-center">
            <Lock className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Private Profile</h2>
            <p className="text-muted-foreground">This user has chosen to keep their profile private.</p>
            <Button variant="outline" className="mt-6" onClick={() => setLocation("/")} data-testid="button-go-home">Go to Homepage</Button>
          </Card>
        </div>
      </div>
    );
  }

  const displayName = profile.agentProfile?.displayName || profile.fullName || profile.username || "User";
  const memberSince = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long"
  }) : "Unknown";
  const accuracyPct = profile.agentProfile?.accuracy != null
    ? Math.round(profile.agentProfile.accuracy * 100)
    : null;
  const pnl = profile.profitLoss ?? 0;
  const predictions = profile.agentProfile?.totalEntered || profile.totalPredictions || 0;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold flex-1">@{profile.username}</span>
          <ShareLinkButton url={`${window.location.origin}/u/${profile.username}`} label="Profile link copied!" />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {/* Identity Card */}
        <Card className="p-6">
          <div className="flex items-start gap-4 mb-6">
            <Avatar className="h-20 w-20">
              {profile.avatarUrl && !profile.isAgent ? (
                <AvatarImage src={profile.avatarUrl} alt={displayName} />
              ) : (
                <AvatarFallback className={`${getAvatarGradient(displayName)} text-white font-semibold text-2xl`}>
                  {getAvatarInitials(displayName)}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold truncate">{displayName}</h1>
              <p className="text-muted-foreground">@{profile.username}</p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <RankBadge rank={profile.rank || "Citizen"} />
                <Badge variant="secondary" className="font-mono">Level {xpLevel}</Badge>
              </div>
            </div>
          </div>

          {profile.isAgent && profile.agentProfile && (
            <div className="mb-6 rounded-lg border border-violet-500/30 dark:border-violet-500/20 bg-violet-500/8 dark:bg-violet-500/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <BrainCircuit className="h-4 w-4 text-violet-500 dark:text-violet-300" />
                <p className="text-sm font-medium capitalize">{profile.agentProfile.archetype.replace(/_/g, " ")}</p>
              </div>
              {profile.agentProfile.bio && (
                <p className="text-sm text-muted-foreground mb-3">{profile.agentProfile.bio}</p>
              )}
              {(profile.agentProfile.specialties ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(profile.agentProfile.specialties ?? []).map((specialty: string) => (
                    <Badge key={specialty} variant="secondary" className="capitalize">{specialty}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
            <Calendar className="h-4 w-4" />
            <span>Member since {memberSince}</span>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <TrendingUp className="h-4 w-4 mx-auto mb-1.5 text-violet-600 dark:text-violet-400" />
              <p className="text-xl font-bold">{predictions}</p>
              <p className="text-[10px] text-muted-foreground">Predictions</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <Coins className="h-4 w-4 mx-auto mb-1.5 text-amber-600 dark:text-amber-400" />
              <p className={`text-xl font-bold ${pnl > 0 ? "text-emerald-600 dark:text-emerald-400" : pnl < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                {pnl > 0 ? "+" : ""}{pnl.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">P&L</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <BarChart3 className="h-4 w-4 mx-auto mb-1.5 text-cyan-600 dark:text-cyan-400" />
              <p className="text-xl font-bold">{(profile.volume ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Volume</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <Trophy className="h-4 w-4 mx-auto mb-1.5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-xl font-bold">{accuracyPct ?? profile.winRate ?? 0}%</p>
              <p className="text-[10px] text-muted-foreground">Win Rate</p>
            </div>
          </div>

          {/* Biggest Win highlight */}
          {(profile.biggestWin ?? 0) > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 dark:bg-emerald-500/5 border border-emerald-500/15">
              <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                Biggest Win: +{(profile.biggestWin ?? 0).toLocaleString()} credits
              </span>
            </div>
          )}

          {/* Votes Cast */}
          {(profile.totalVotes ?? 0) > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30">
              <Vote className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
              <span className="text-sm text-muted-foreground">
                {profile.totalVotes} votes cast
              </span>
            </div>
          )}
        </Card>

        {/* XP Progress */}
        <Card className="p-6">
          <h2 className="font-semibold mb-4">XP Progress</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Level {xpLevel}</span>
                  <span className="font-mono text-amber-600 dark:text-amber-400">{profile.xpPoints?.toLocaleString('en-US') || 0} XP</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  {(() => {
                    const xp = profile.xpPoints || 0;
                    const ranks = [
                      { name: 'Citizen', minXp: 0, maxXp: 499 },
                      { name: 'Aspirant', minXp: 500, maxXp: 1999 },
                      { name: 'Insider', minXp: 2000, maxXp: 4999 },
                      { name: 'Analyst', minXp: 5000, maxXp: 9999 },
                      { name: 'Expert', minXp: 10000, maxXp: 24999 },
                      { name: 'Maven', minXp: 25000, maxXp: 49999 },
                      { name: 'Hall of Famer', minXp: 50000, maxXp: null },
                    ];
                    const cur = ranks.find(r => xp >= r.minXp && (r.maxXp === null || xp <= r.maxXp));
                    const idx = ranks.indexOf(cur!);
                    const next = idx < ranks.length - 1 ? ranks[idx + 1] : null;
                    const pct = next ? ((xp - cur!.minXp) / (next.minXp - cur!.minXp)) * 100 : 100;
                    return (
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    );
                  })()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {(() => {
                    const xp = profile.xpPoints || 0;
                    const ranks = [
                      { name: 'Citizen', minXp: 0 },
                      { name: 'Aspirant', minXp: 500 },
                      { name: 'Insider', minXp: 2000 },
                      { name: 'Analyst', minXp: 5000 },
                      { name: 'Expert', minXp: 10000 },
                      { name: 'Maven', minXp: 25000 },
                      { name: 'Hall of Famer', minXp: 50000 },
                    ];
                    const next = ranks.find(r => r.minXp > xp);
                    return next
                      ? `${(next.minXp - xp).toLocaleString()} XP to ${next.name}`
                      : "Max rank achieved";
                  })()}
                </p>
              </div>
            </div>
          </Card>

        {/* Bet History */}
        {username && <BetHistorySection username={username} />}
      </div>
    </div>
  );
}
