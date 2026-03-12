import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { UserMenu } from "@/components/UserMenu";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";
import {
  ArrowLeft,
  Star,
  Clock,
  Users,
  Loader2,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Target,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  ThumbsUp,
  Zap,
  Trophy,
  BarChart3,
  Lock,
  Info,
  Gavel,
  Share2,
} from "lucide-react";

interface MarketEntry {
  id: string;
  label: string;
  totalStake: number;
  seedCount: number;
  displayOrder: number;
  resolutionStatus: string;
  betCount: number;
}

interface MarketComment {
  id: string;
  userId: string;
  username: string;
  body: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

interface ResolutionSource {
  label: string;
  url: string;
}

interface MarketData {
  id: string;
  marketType: string;
  openMarketType: "binary" | "multi" | "updown";
  status: "OPEN" | "CLOSED_PENDING" | "RESOLVED" | "VOID";
  title: string;
  slug: string;
  teaser?: string | null;
  summary?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  sourceUrl?: string | null;
  featured?: boolean;
  timezone?: string | null;
  resolutionCriteria?: string[] | null;
  resolutionSources?: ResolutionSource[] | null;
  resolveMethod?: string | null;
  seedParticipants?: number;
  seedVolume?: string | null;
  underlying?: string | null;
  metric?: string | null;
  strike?: string | null;
  unit?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  closeAt?: string | null;
  createdAt: string;
  entries: MarketEntry[];
  comments?: MarketComment[];
  totalParticipants?: number;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  CLOSED_PENDING: { label: "Closed", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  RESOLVED: { label: "Resolved", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  VOID: { label: "Void", className: "bg-red-500/20 text-red-400 border-red-500/30" },
};

function useCountdown(endDate: string | null) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!endDate) return;
    const update = () => {
      const now = new Date().getTime();
      const end = new Date(endDate).getTime();
      const diff = end - now;
      if (diff <= 0) {
        setTimeLeft("Ended");
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h remaining`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m remaining`);
      } else {
        setTimeLeft(`${minutes}m remaining`);
      }
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [endDate]);

  return timeLeft;
}

function getEntryPercentages(entries: MarketEntry[]) {
  const totalWeight = entries.reduce((sum, e) => sum + (e.totalStake || 0) + (e.seedCount || 0), 0);
  return entries.map((e) => {
    const weight = (e.totalStake || 0) + (e.seedCount || 0);
    return {
      ...e,
      percentage: totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : Math.round(100 / entries.length),
      displayStake: weight,
    };
  });
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatTimeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

function BinaryOutcomes({
  entries,
  selectedEntry,
  onSelect,
  disabled,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const sorted = [...entries].sort((a, b) => a.displayOrder - b.displayOrder);
  const yesEntry = sorted[0];
  const noEntry = sorted[1];

  return (
    <div className="grid grid-cols-2 gap-3">
      {yesEntry && (
        <button
          onClick={() => !disabled && onSelect(yesEntry.id)}
          disabled={disabled}
          className={`relative p-4 rounded-xl border-2 transition-all text-left ${
            selectedEntry === yesEntry.id
              ? "border-green-500 bg-green-500/15 shadow-lg shadow-green-500/20"
              : "border-green-500/20 bg-green-500/5 hover:border-green-500/40"
          } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          data-testid={`button-outcome-${yesEntry.id}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span className="font-semibold text-green-400">{yesEntry.label}</span>
          </div>
          <div className="text-3xl font-bold text-green-400 font-mono">{yesEntry.percentage}%</div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{formatNumber(yesEntry.displayStake)} staked</span>
            <span>{yesEntry.betCount} bets</span>
          </div>
        </button>
      )}
      {noEntry && (
        <button
          onClick={() => !disabled && onSelect(noEntry.id)}
          disabled={disabled}
          className={`relative p-4 rounded-xl border-2 transition-all text-left ${
            selectedEntry === noEntry.id
              ? "border-red-500 bg-red-500/15 shadow-lg shadow-red-500/20"
              : "border-red-500/20 bg-red-500/5 hover:border-red-500/40"
          } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          data-testid={`button-outcome-${noEntry.id}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="h-5 w-5 text-red-500" />
            <span className="font-semibold text-red-400">{noEntry.label}</span>
          </div>
          <div className="text-3xl font-bold text-red-400 font-mono">{noEntry.percentage}%</div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{formatNumber(noEntry.displayStake)} staked</span>
            <span>{noEntry.betCount} bets</span>
          </div>
        </button>
      )}
    </div>
  );
}

function MultiOutcomes({
  entries,
  selectedEntry,
  onSelect,
  disabled,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const sorted = [...entries].sort((a, b) => a.displayOrder - b.displayOrder);
  const maxPercentage = Math.max(...sorted.map((e) => e.percentage));

  return (
    <div className="space-y-2">
      {sorted.map((entry) => (
        <button
          key={entry.id}
          onClick={() => !disabled && onSelect(entry.id)}
          disabled={disabled}
          className={`w-full relative p-3 rounded-lg border transition-all text-left ${
            selectedEntry === entry.id
              ? "border-violet-500 bg-violet-500/10 shadow-md shadow-violet-500/20"
              : "border-border/40 hover:border-violet-500/30"
          } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          data-testid={`button-outcome-${entry.id}`}
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {(entry as any).imageUrl && (
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarImage src={(entry as any).imageUrl} alt={entry.label} />
                  <AvatarFallback className="text-[9px]">{entry.label[0]}</AvatarFallback>
                </Avatar>
              )}
              <span className={`font-medium text-sm truncate ${entry.percentage === maxPercentage ? "text-violet-400" : ""}`}>
                {entry.label}
              </span>
            </div>
            <span className="font-mono font-bold text-sm shrink-0">{entry.percentage}%</span>
          </div>
          <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                entry.percentage === maxPercentage
                  ? "bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  : "bg-violet-500/40"
              }`}
              style={{ width: `${entry.percentage}%` }}
            />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
            <span>{formatNumber(entry.displayStake)} staked</span>
            <span>{entry.betCount} bets</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function UpDownOutcomes({
  entries,
  selectedEntry,
  onSelect,
  disabled,
  underlying,
  metric,
  strike,
  unit,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
  underlying: string;
  metric: string;
  strike: string;
  unit: string;
}) {
  const sorted = [...entries].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-violet-500/5 border-violet-500/20">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{underlying} {metric}</p>
          <p className="text-3xl font-bold font-mono text-violet-400">
            {unit}{Number(strike).toLocaleString('en-US')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Strike Price</p>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        {sorted.map((entry) => {
          const isAbove = entry.label.toLowerCase().includes("above") || entry.label.toLowerCase().includes("yes") || entry.displayOrder === 0;
          return (
            <button
              key={entry.id}
              onClick={() => !disabled && onSelect(entry.id)}
              disabled={disabled}
              className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                selectedEntry === entry.id
                  ? isAbove
                    ? "border-green-500 bg-green-500/15 shadow-lg shadow-green-500/20"
                    : "border-red-500 bg-red-500/15 shadow-lg shadow-red-500/20"
                  : isAbove
                    ? "border-green-500/20 bg-green-500/5 hover:border-green-500/40"
                    : "border-red-500/20 bg-red-500/5 hover:border-red-500/40"
              } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              data-testid={`button-outcome-${entry.id}`}
            >
              <div className="flex items-center gap-2 mb-2">
                {isAbove ? (
                  <TrendingUp className="h-5 w-5 text-green-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-500" />
                )}
                <span className={`font-semibold ${isAbove ? "text-green-400" : "text-red-400"}`}>
                  {entry.label}
                </span>
              </div>
              <div className={`text-3xl font-bold font-mono ${isAbove ? "text-green-400" : "text-red-400"}`}>
                {entry.percentage}%
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{formatNumber(entry.displayStake)} staked</span>
                <span>{entry.betCount} bets</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MarketDetailPage() {
  const params = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { user, isLoggedIn, refreshProfile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const pickParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("pick") : null;

  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [pickApplied, setPickApplied] = useState(false);

  const { data: market, isLoading, error } = useQuery<MarketData>({
    queryKey: ["/api/open-markets", params.slug],
    queryFn: async () => {
      const res = await fetch(`/api/open-markets/${params.slug}`);
      if (!res.ok) throw new Error("Market not found");
      return res.json();
    },
    enabled: !!params.slug,
  });

  const betMutation = useMutation({
    mutationFn: async ({ entryId, stakeAmount: amount }: { entryId: string; stakeAmount: number }) => {
      const res = await apiRequest("POST", `/api/open-markets/${params.slug}/bet`, { entryId, stakeAmount: amount });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Prediction placed!", description: "Your prediction has been recorded." });
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets", params.slug] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
      setSelectedEntry(null);
      setStakeAmount("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to place prediction", description: err.message, variant: "destructive" });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/open-markets/${params.slug}/comments`, { body });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Comment posted!" });
      queryClient.invalidateQueries({ queryKey: ["/api/open-markets", params.slug] });
      setCommentBody("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to post comment", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (pickParam && market?.entries && !pickApplied) {
      const pickLower = pickParam.toLowerCase();
      const matched = market.entries.find((e) =>
        e.label.toLowerCase() === pickLower ||
        e.label.toLowerCase().includes(pickLower)
      );
      if (matched) {
        setSelectedEntry(matched.id);
      }
      setPickApplied(true);
    }
  }, [pickParam, market?.entries, pickApplied]);

  const timeLeft = useCountdown(market?.closeAt || market?.endAt || null);

  const entriesWithPercentages = useMemo(() => {
    if (!market?.entries) return [];
    return getEntryPercentages(market.entries);
  }, [market?.entries]);

  const totalPool = useMemo(() => {
    if (!market) return 0;
    const entryWeights = (market.entries || []).reduce((sum, e) => sum + (e.totalStake || 0) + (e.seedCount || 0), 0);
    return entryWeights;
  }, [market]);

  const totalParticipants = useMemo(() => {
    if (!market) return 0;
    const entrySeedTotal = (market.entries || []).reduce((sum: number, e: any) => sum + (e.seedCount || 0), 0);
    return (market.totalParticipants || 0) + entrySeedTotal;
  }, [market]);

  const potentialPayout = useMemo(() => {
    if (!selectedEntry || !stakeAmount || !market) return null;
    const amount = Number(stakeAmount);
    if (isNaN(amount) || amount <= 0) return null;
    const entry = entriesWithPercentages.find((e) => e.id === selectedEntry);
    if (!entry || entry.percentage === 0) return null;
    const payout = (amount / (entry.percentage / 100)) * 0.95;
    return Math.round(payout);
  }, [selectedEntry, stakeAmount, entriesWithPercentages, market]);

  const handlePlaceBet = () => {
    if (!isLoggedIn) {
      setLocation("/login");
      return;
    }
    if (!selectedEntry || !stakeAmount) return;
    const amount = Number(stakeAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter a valid stake amount.", variant: "destructive" });
      return;
    }
    betMutation.mutate({ entryId: selectedEntry, stakeAmount: amount });
  };

  const handlePostComment = () => {
    if (!isLoggedIn) {
      setLocation("/login");
      return;
    }
    if (!commentBody.trim()) return;
    commentMutation.mutate(commentBody.trim());
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" data-testid="loading-spinner" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => window.history.back()} aria-label="Go back" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Link href="/">
                <button className="flex items-center gap-2 hover:opacity-80 transition-opacity" data-testid="button-logo-home">
                  <AuthoriDexLogo size={32} />
                  <span className="font-serif font-bold text-xl hidden sm:block">AuthoriDex</span>
                </button>
              </Link>
            </div>
            <UserMenu />
          </div>
        </header>
        <div className="container mx-auto px-4 py-20 text-center" data-testid="market-not-found">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-serif font-bold mb-2">Market Not Found</h1>
          <p className="text-muted-foreground mb-6">This market doesn't exist or has been removed.</p>
          <Button onClick={() => setLocation("/predict")} data-testid="button-back-to-markets">
            Back to Markets
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[market.status] || STATUS_CONFIG.OPEN;
  const isOpen = market.status === "OPEN";
  const isInactive = (market as any).visibility === "inactive";

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.back()} aria-label="Go back" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link href="/">
              <button
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                data-testid="button-logo-home"
              >
                <AuthoriDexLogo size={32} />
                <span className="font-serif font-bold text-xl hidden sm:block">AuthoriDex</span>
              </button>
            </Link>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-3xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Badge variant="outline" className={statusConfig.className} data-testid="badge-status">
              {statusConfig.label}
            </Badge>
            {market.category && <CategoryPill category={market.category} data-testid="badge-category" />}
            {market.featured && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30" data-testid="badge-featured">
                <Star className="h-3 w-3 mr-1" />
                Featured
              </Badge>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-serif font-bold mb-2" data-testid="text-market-title">
            {market.title}
          </h1>

          {market.teaser && (
            <p className="text-muted-foreground text-sm sm:text-base mb-3" data-testid="text-market-teaser">
              {market.teaser}
            </p>
          )}

          <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
            {timeLeft && (
              <div className="flex items-center gap-1.5" data-testid="text-time-remaining">
                <Clock className="h-3.5 w-3.5" />
                <span>{timeLeft}</span>
              </div>
            )}
            {market.sourceUrl && (
              <a
                href={market.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-violet-400 hover:text-violet-300 transition-colors"
                data-testid="link-source"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Source</span>
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => sharePage(`${market.title} on AuthoriDex`)}
              className="ml-auto"
              data-testid="button-share"
            >
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
          </div>

          {market.tags && market.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              {market.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs" data-testid={`badge-tag-${tag}`}>
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {isOpen && !isInactive && (
          <Card className="p-5 mb-6 border-violet-500/20 bg-violet-500/5" data-testid="section-place-prediction">
            <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-violet-500" />
              Place Your Prediction
            </h2>
            {!isLoggedIn ? (
              <div className="text-center py-4">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">Sign in to place predictions</p>
                <Button onClick={() => setLocation("/login")} data-testid="button-login-to-predict">
                  Sign In
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Your Pick</label>
                  <div className="grid grid-cols-2 gap-2">
                    {entriesWithPercentages.sort((a, b) => a.displayOrder - b.displayOrder).map((entry) => {
                      const isSelected = selectedEntry === entry.id;
                      const isYesLike = entry.label.toLowerCase() === "yes" || entry.label.toLowerCase() === "above" || entry.displayOrder === 0;
                      return (
                        <Button
                          key={entry.id}
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          className={isSelected
                            ? isYesLike
                              ? "bg-green-600 text-white border-green-600"
                              : "bg-red-600 text-white border-red-600"
                            : isYesLike
                              ? "border-green-500/30 text-green-500"
                              : "border-red-500/30 text-red-500"
                          }
                          onClick={() => setSelectedEntry(entry.id)}
                          data-testid={`button-pick-${entry.label.toLowerCase()}`}
                        >
                          {entry.label} ({entry.percentage}%)
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Stake Amount</label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Enter stake amount..."
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="bg-background/50"
                    data-testid="input-stake-amount"
                  />
                </div>

                {potentialPayout !== null && (
                  <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20" data-testid="text-potential-payout">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Est. payout if correct</span>
                      <span className="font-bold font-mono text-green-400">{formatNumber(potentialPayout)} credits</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Estimate — updates as more people bet.</p>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground/50 text-center">Final payout may differ as the pool changes.</p>

                <Button
                  className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                  disabled={!selectedEntry || !stakeAmount || Number(stakeAmount) <= 0 || betMutation.isPending}
                  onClick={handlePlaceBet}
                  data-testid="button-submit-prediction"
                >
                  {betMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {betMutation.isPending
                    ? "Placing..."
                    : !selectedEntry
                      ? "Select an outcome"
                      : !stakeAmount || Number(stakeAmount) <= 0
                        ? "Enter stake amount"
                        : "Place Prediction"}
                </Button>
              </div>
            )}
          </Card>
        )}

        <Card className="p-5 mb-6" data-testid="section-outcomes">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-violet-500" />
            Outcomes
          </h2>
          {market.openMarketType === "binary" && (
            <BinaryOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
            />
          )}
          {market.openMarketType === "multi" && (
            <MultiOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
            />
          )}
          {market.openMarketType === "updown" && (
            <UpDownOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
              underlying={market.underlying || ""}
              metric={market.metric || ""}
              strike={market.strike || "0"}
              unit={market.unit || ""}
            />
          )}
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="section-stats">
          <Card className="p-3 text-center">
            <Zap className="h-4 w-4 text-violet-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-pool">{formatNumber(totalPool)}</p>
            <p className="text-xs text-muted-foreground">Total Pool</p>
          </Card>
          <Card className="p-3 text-center">
            <Users className="h-4 w-4 text-violet-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-participants">{formatNumber(totalParticipants)}</p>
            <p className="text-xs text-muted-foreground">Participants</p>
          </Card>
          <Card className="p-3 text-center">
            <Gavel className="h-4 w-4 text-violet-500 mx-auto mb-1" />
            <p className="text-sm font-semibold capitalize" data-testid="text-resolve-method">
              {(market.resolveMethod || "manual").replace(/_/g, " ")}
            </p>
            <p className="text-xs text-muted-foreground">Resolution</p>
          </Card>
          <Card className="p-3 text-center">
            <Clock className="h-4 w-4 text-violet-500 mx-auto mb-1" />
            <p className="text-sm font-semibold" data-testid="text-close-date">
              {market.closeAt ? formatDate(market.closeAt) : market.endAt ? formatDate(market.endAt) : "TBD"}
            </p>
            <p className="text-xs text-muted-foreground">Close Date</p>
          </Card>
        </div>

        {market.summary && (
          <Card className="p-5 mb-6" data-testid="section-summary">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-violet-500" />
              About
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{market.summary}</p>
            {market.description && market.description !== market.summary && (
              <p className="text-sm text-muted-foreground leading-relaxed mt-3">{market.description}</p>
            )}
          </Card>
        )}

        {((market.resolutionCriteria && market.resolutionCriteria.length > 0) ||
          (market.resolutionSources && market.resolutionSources.length > 0)) && (
          <Card className="p-5 mb-6" data-testid="section-resolution-rules">
            <h2 className="text-lg font-serif font-bold mb-3 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-violet-500" />
              Resolution Rules
            </h2>
            {market.resolutionCriteria && market.resolutionCriteria.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Criteria</p>
                <ul className="space-y-1.5">
                  {market.resolutionCriteria.map((criterion, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {market.resolutionSources && market.resolutionSources.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Sources</p>
                <div className="flex flex-col gap-1.5">
                  {market.resolutionSources.map((source, i) => (
                    <a
                      key={i}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300 transition-colors"
                      data-testid={`link-resolution-source-${i}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      {source.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {isInactive && (
          <Card className="p-5 mb-6 border-amber-500/20 bg-amber-500/5" data-testid="section-inactive-market">
            <div className="text-center py-4">
              <Clock className="h-8 w-8 text-amber-500 mx-auto mb-3" />
              <h2 className="text-lg font-serif font-bold mb-2">{(market as any).inactiveMessage || "Coming Soon"}</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                This market is not yet open for predictions. Check back soon for when it goes live.
              </p>
            </div>
          </Card>
        )}

        <Card className="p-5 mb-6" data-testid="section-comments">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-500" />
            Discussion ({market.comments?.length || 0})
          </h2>

          {isLoggedIn ? (
            <div className="mb-4">
              <Textarea
                placeholder="Share your thoughts..."
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                className="mb-2 bg-background/50 resize-none"
                rows={3}
                data-testid="input-comment"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!commentBody.trim() || commentMutation.isPending}
                  onClick={handlePostComment}
                  data-testid="button-submit-comment"
                >
                  {commentMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Post
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-3 mb-4 rounded-lg border border-dashed border-border/50">
              <p className="text-sm text-muted-foreground">
                <Button variant="ghost" className="p-0 h-auto text-violet-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-comment">
                  Sign in
                </Button>{" "}
                to join the discussion
              </p>
            </div>
          )}

          {market.comments && market.comments.length > 0 ? (
            <ScrollArea className="max-h-96">
              <div className="space-y-3">
                {market.comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3" data-testid={`comment-${comment.id}`}>
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-violet-500/20 text-violet-400 text-xs font-semibold">
                        {(comment.username || "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold" data-testid={`text-comment-user-${comment.id}`}>
                          {comment.username}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTimeAgo(comment.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5" data-testid={`text-comment-body-${comment.id}`}>
                        {comment.body}
                      </p>
                      {comment.upvotes > 0 && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <ThumbsUp className="h-3 w-3" />
                          <span>{comment.upvotes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No comments yet. Be the first to share your thoughts!</p>
          )}
        </Card>

        {/* Related Markets - placeholder for future implementation */}
      </div>
    </div>
  );
}
