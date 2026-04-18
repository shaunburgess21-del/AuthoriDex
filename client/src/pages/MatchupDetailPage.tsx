import { useState, useMemo } from "react";
import { handleImageError } from "@/lib/imageResolver";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { UserMenu } from "@/components/UserMenu";
import { XpPill } from "@/components/XpPill";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/formatDate";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { VoteDetailNavCluster } from "@/components/vote/VoteDetailNavCluster";
import { useDetailNavigation } from "@/hooks/useDetailNavigation";
import { CardComments, useCommentCount } from "@/components/comments/CardComments";
import { CommentsBottomSheet } from "@/components/snap-scroll/CommentsBottomSheet";
import {
  ArrowLeft,
  Clock,
  Users,
  Loader2,
  BarChart3,
  Info,
  Share2,
  MessageSquare,
  Copy,
  Star,
  Check,
  Swords,
  TrendingUp,
  ChevronRight,
} from "lucide-react";

interface MatchupDetail {
  id: string;
  category: string;
  title: string;
  optionAText: string;
  optionAImage: string | null;
  optionAFallbackImage?: string | null;
  optionBText: string;
  optionBImage: string | null;
  optionBFallbackImage?: string | null;
  promptText: string | null;
  description: string | null;
  isActive: boolean;
  visibility: string;
  featured: boolean;
  slug: string | null;
  createdAt: string;
  optionAVotes: number;
  optionBVotes: number;
  neutralVotes: number;
  totalVotes: number;
  optionAPercent: number;
  optionBPercent: number;
  neutralPercent: number;
}


export default function MatchupDetailPage() {
  const params = useParams<{ slug: string }>();
  const slugParam = params.slug;
  const slug = useMemo(() => {
    if (!slugParam) return "";
    try {
      return decodeURIComponent(slugParam);
    } catch {
      return slugParam;
    }
  }, [slugParam]);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoggedIn } = useAuth();

  const matchupCommentCount = useCommentCount("matchup", slug || "");
  const { showNav, historyDepth } = useDetailNavigation(slug || undefined, "matchup");
  const [commentsSheetOpen, setCommentsSheetOpen] = useState(false);

  const { data: matchup, isLoading, error } = useQuery<MatchupDetail>({
    queryKey: ["/api/matchups/by-slug", slug],
    queryFn: async () => {
      const res = await fetch(`/api/matchups/by-slug/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error("Matchup not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const { data: userVotes } = useQuery<Record<string, string>>({
    queryKey: ["/api/matchups/user-votes"],
  });

  const voteMutation = useMutation({
    mutationFn: async ({ matchupId, option }: { matchupId: string; option: string }) => {
      const res = await apiRequest("POST", `/api/matchups/${matchupId}/vote`, { option });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matchups/by-slug", slug] });
      queryClient.invalidateQueries({ queryKey: ["/api/matchups/user-votes"] });
      toast({ title: "Vote Recorded", description: "Your vote has been counted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cast vote. Please sign in.", variant: "destructive" });
    },
  });

  const removeVoteMutation = useMutation({
    mutationFn: async (matchupId: string) => {
      const res = await apiRequest("POST", `/api/matchups/${matchupId}/vote`, { remove: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matchups/by-slug", slug] });
      queryClient.invalidateQueries({ queryKey: ["/api/matchups/user-votes"] });
    },
  });

  const handleVote = (matchupId: string, option: 'option_a' | 'option_b' | 'neutral') => {
    voteMutation.mutate({ matchupId, option });
  };

  const handleRemoveVote = (matchupId: string) => {
    removeVoteMutation.mutate(matchupId);
  };

  const handleShare = () => {
    sharePage(matchup ? `${matchup.title} on VoxDex` : "VoxDex");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-700 dark:text-cyan-500" />
      </div>
    );
  }

  if (error || !matchup) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
          <div className="max-w-3xl mx-auto px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="flex items-center gap-3 min-w-0 justify-self-start">
              <Link href="/" data-testid="link-logo-home">
                <VoxDexLogo size={28} />
              </Link>
              <Button variant="ghost" size="sm" onClick={() => { showNav ? window.history.go(-historyDepth) : (window.history.length > 1 ? window.history.back() : setLocation("/vote")); }} data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Vote
              </Button>
            </div>
            <div className="flex justify-center min-w-0 col-start-2">
              <VoteDetailNavCluster listType="matchup" slug={slug || undefined} />
            </div>
            <div className="flex justify-end min-w-0 justify-self-end col-start-3 items-center gap-2">
              <XpPill size="sm" />
              <UserMenu />
            </div>
          </div>
        </header>
        <div className="max-w-3xl mx-auto px-4 pt-8 pb-24 md:pb-6">
          <Card className="p-8 text-center">
            <h1 className="text-xl font-bold mb-2">Matchup Not Found</h1>
            <p className="text-muted-foreground">This matchup may have been removed or doesn't exist.</p>
          </Card>
        </div>
      </div>
    );
  }

  const userVote = userVotes?.[matchup.id] || null;
  const hasVoted = userVote !== null;
  const votedA = userVote === 'option_a';
  const votedB = userVote === 'option_b';
  const votedNeutral = userVote === 'neutral';
  const leadingA = matchup.optionAPercent >= matchup.optionBPercent;

  return (
    <div className="min-h-screen bg-background" data-testid="matchup-detail-page">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex items-center gap-3 min-w-0 justify-self-start">
            <Link href="/" data-testid="link-logo-home">
              <VoxDexLogo size={28} />
            </Link>
            <Button variant="ghost" size="sm" onClick={() => { showNav ? window.history.go(-historyDepth) : (window.history.length > 1 ? window.history.back() : setLocation("/vote")); }} data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Vote
            </Button>
          </div>
          <div className="flex justify-center min-w-0 col-start-2">
            <VoteDetailNavCluster listType="matchup" slug={slug || undefined} />
          </div>
          <div className="flex justify-end min-w-0 justify-self-end col-start-3 items-center gap-2">
            <XpPill size="sm" />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24 md:pb-6">
        {/* Header Block */}
        <div className="mb-6" data-testid="section-matchup-header">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <CategoryPill category={matchup.category} />
            <Badge variant="outline" className="text-xs border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              Matchup
            </Badge>
            {matchup.featured && (
              <Badge variant="outline" className="text-xs border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400">
                Featured
              </Badge>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-serif font-bold mb-3 leading-tight" data-testid="text-matchup-title">
            {matchup.promptText || `${matchup.optionAText} vs ${matchup.optionBText}`}
          </h1>

          {matchup.promptText && (
            <p className="text-base text-muted-foreground mb-4" data-testid="text-matchup-question">
              {matchup.optionAText} vs {matchup.optionBText}
            </p>
          )}

          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatDate(matchup.createdAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {matchup.totalVotes.toLocaleString('en-US')} votes
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="ml-auto"
              data-testid="button-share"
            >
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
          </div>
        </div>

        {/* Cast Your Vote — full-bleed on mobile so option images use full width like list card */}
        <div className="-mx-4 sm:mx-0">
          <Card className="p-5 mb-6 border-0 shadow-none bg-transparent overflow-hidden" data-testid="section-vote-module">
            <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
              <Swords className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
              Cast Your Vote
            </h2>

            <div className="flex items-stretch gap-0 relative mb-4 -mx-5">
            <button
              onClick={() => {
                if (!votedA) handleVote(matchup.id, 'option_a');
              }}
              className={`flex-1 flex flex-col rounded-none border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedA
                    ? 'border-slate-300/60 ring-2 ring-white/15'
                    : 'border-slate-700/30 opacity-70 hover:opacity-90 hover:border-slate-500/50 dark:border-slate-400/40'
                  : 'border-slate-700/50 hover:border-slate-500/60 dark:border-slate-400/50'
              }`}
              data-testid="button-vote-option-a"
            >
              <div className="relative min-h-[222px] md:min-h-0 md:aspect-[100/111]">
                {matchup.optionAImage ? (
                  <div className="absolute inset-0">
                    <img
                      src={matchup.optionAImage}
                      alt={matchup.optionAText}
                      className="w-full h-full object-cover"
                      onError={(e) => handleImageError(e, matchup.optionAFallbackImage)}
                    />
                  </div>
                ) : (
                  <div className={`absolute inset-0 bg-gradient-to-br ${votedA ? 'from-blue-600/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
                )}
                {votedA && (
                  <div className="absolute top-2 right-2">
                    <Badge variant="outline" className="text-[10px] border-blue-500/60 dark:border-blue-500/50 text-blue-600 dark:text-blue-400 bg-black/50 backdrop-blur-sm py-0">
                      Your pick
                    </Badge>
                  </div>
                )}
              </div>
              <div className="px-3 py-3 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                <span className={`font-semibold text-sm truncate block ${votedA ? 'text-blue-600 dark:text-blue-400' : ''}`}>{matchup.optionAText}</span>
              </div>
            </button>

            <div className="absolute left-1/2 top-[calc(50%-18px)] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1">
              <button
                onClick={() => {
                  if (!votedNeutral) handleVote(matchup.id, 'neutral');
                }}
                data-testid="button-vote-neutral"
                className={`h-14 w-14 md:h-11 md:w-11 rounded-full border-2 flex items-center justify-center shadow-lg transition-all duration-300 ${
                  votedNeutral
                    ? 'bg-gradient-to-br from-slate-500 to-slate-600 border-slate-400 ring-2 ring-slate-400/40'
                    : 'bg-gradient-to-br from-slate-700 to-slate-900 border-slate-500 hover:border-slate-400 hover:ring-2 hover:ring-slate-300/30 cursor-pointer'
                }`}
              >
                <span className={`text-sm md:text-xs font-bold ${votedNeutral ? 'text-white' : 'text-slate-200'}`}>VS</span>
              </button>
              {votedNeutral && (
                <span className="text-[9px] font-semibold text-slate-400 bg-slate-800 border border-slate-600 rounded px-1 py-px leading-none whitespace-nowrap shadow-sm">
                  Your pick
                </span>
              )}
            </div>

            <button
              onClick={() => {
                if (!votedB) handleVote(matchup.id, 'option_b');
              }}
              className={`flex-1 flex flex-col rounded-none border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedB
                    ? 'border-slate-300/60 ring-2 ring-white/15'
                    : 'border-slate-700/30 opacity-70 hover:opacity-90 hover:border-slate-500/50 dark:border-slate-400/40'
                  : 'border-slate-700/50 hover:border-slate-500/60 dark:border-slate-400/50'
              }`}
              data-testid="button-vote-option-b"
            >
              <div className="relative min-h-[222px] md:min-h-0 md:aspect-[100/111]">
                {matchup.optionBImage ? (
                  <div className="absolute inset-0">
                    <img
                      src={matchup.optionBImage}
                      alt={matchup.optionBText}
                      className="w-full h-full object-cover"
                      onError={(e) => handleImageError(e, matchup.optionBFallbackImage)}
                    />
                  </div>
                ) : (
                  <div className={`absolute inset-0 bg-gradient-to-br ${votedB ? 'from-amber-700/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
                )}
                {votedB && (
                  <div className="absolute top-2 right-2">
                    <Badge variant="outline" className="text-[10px] border-amber-500/60 dark:border-amber-500/50 text-amber-600 dark:text-amber-400 bg-black/50 backdrop-blur-sm py-0">
                      Your pick
                    </Badge>
                  </div>
                )}
              </div>
              <div className="px-3 py-3 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                <span className={`font-semibold text-sm truncate block ${votedB ? 'text-amber-600 dark:text-amber-400' : ''}`}>{matchup.optionBText}</span>
              </div>
            </button>
          </div>

          {hasVoted && (
            <div className="flex items-center justify-center gap-3 pt-3 border-t border-border/30">
              <span className="text-xs text-muted-foreground">Tap an option or VS to change your vote</span>
              <span className="text-xs text-muted-foreground/40">|</span>
              <button
                onClick={() => handleRemoveVote(matchup.id)}
                className="text-xs text-muted-foreground hover:text-red-600/80 dark:hover:text-red-400/80 transition-colors underline-offset-4 hover:underline"
                data-testid="button-remove-vote"
              >
                Remove vote
              </button>
            </div>
          )}

          {!isLoggedIn && !hasVoted && (
            <p className="text-xs text-center text-muted-foreground pt-2">
              <Button variant="ghost" className="p-0 h-auto text-cyan-600 dark:text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-vote">
                Sign in
              </Button>{" "}
              to cast your vote
            </p>
          )}
          </Card>
        </div>

        {/* Results */}
        <Card className="p-5 mb-6" data-testid="section-results">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
            Results
          </h2>

          <div className="space-y-3 mb-4" data-testid="bar-results">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">{matchup.optionAText}</span>
                <span className={`text-sm font-bold font-mono ${leadingA ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                  {matchup.optionAPercent}%
                </span>
              </div>
              <div className="h-8 rounded-md bg-blue-500/15 dark:bg-blue-500/10 border border-blue-500/40 dark:border-blue-500/30 overflow-hidden relative">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-500 rounded-md flex items-center justify-center"
                  style={{ width: `${Math.max(matchup.optionAPercent, 5)}%` }}
                >
                  {matchup.optionAPercent >= 20 && (
                    <span className="text-xs font-semibold text-white drop-shadow-sm">{matchup.optionAPercent}%</span>
                  )}
                </div>
              </div>
            </div>

            {(matchup.neutralVotes ?? 0) > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-muted-foreground">Neither / Neutral</span>
                  <span className={`text-sm font-bold font-mono ${votedNeutral ? 'text-slate-600 dark:text-slate-300' : 'text-muted-foreground'}`}>
                    {matchup.neutralPercent}%
                  </span>
                </div>
                <div className="h-8 rounded-md bg-slate-500/15 dark:bg-slate-500/10 border border-slate-500/40 dark:border-slate-500/30 overflow-hidden relative">
                  <div
                    className="h-full bg-slate-400 dark:bg-slate-500 transition-all duration-500 rounded-md flex items-center justify-center"
                    style={{ width: `${Math.max(matchup.neutralPercent, 5)}%` }}
                  >
                    {matchup.neutralPercent >= 20 && (
                      <span className="text-xs font-semibold text-white drop-shadow-sm">{matchup.neutralPercent}%</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">{matchup.optionBText}</span>
                <span className={`text-sm font-bold font-mono ${!leadingA ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  {matchup.optionBPercent}%
                </span>
              </div>
              <div className="h-8 rounded-md bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/40 dark:border-amber-500/30 overflow-hidden relative">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-500 rounded-md flex items-center justify-center"
                  style={{ width: `${Math.max(matchup.optionBPercent, 5)}%` }}
                >
                  {matchup.optionBPercent >= 20 && (
                    <span className="text-xs font-semibold text-white drop-shadow-sm">{matchup.optionBPercent}%</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={(matchup.neutralVotes ?? 0) > 0 ? "grid grid-cols-3 gap-3 text-center mb-3" : "grid grid-cols-2 gap-3 text-center mb-3"}>
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="h-2.5 w-2.5 rounded-full bg-blue-400" />
                <span className="text-xs font-medium">{matchup.optionAText}</span>
              </div>
              <p className="text-lg font-bold font-mono text-blue-600 dark:text-blue-400" data-testid="text-option-a-percent">{matchup.optionAPercent}%</p>
              <p className="text-xs text-muted-foreground">{matchup.optionAVotes.toLocaleString('en-US')} votes</p>
            </div>
            {(matchup.neutralVotes ?? 0) > 0 && (
              <div>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <div className="h-2.5 w-2.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                  <span className="text-xs font-medium text-muted-foreground">Neutral</span>
                </div>
                <p className="text-lg font-bold font-mono text-slate-600 dark:text-slate-300">{matchup.neutralPercent}%</p>
                <p className="text-xs text-muted-foreground">{matchup.neutralVotes.toLocaleString('en-US')} votes</p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-medium">{matchup.optionBText}</span>
              </div>
              <p className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400" data-testid="text-option-b-percent">{matchup.optionBPercent}%</p>
              <p className="text-xs text-muted-foreground">{matchup.optionBVotes.toLocaleString('en-US')} votes</p>
            </div>
          </div>

          <div className="pt-3 border-t border-border/30 text-center">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{matchup.totalVotes.toLocaleString('en-US')}</span> total votes
            </p>
          </div>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 mb-6" data-testid="section-stats">
          <Card className="p-3 text-center">
            <Users className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-votes">{matchup.totalVotes.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Total Votes</p>
          </Card>
          <Card className="p-3 text-center">
            <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-comment-count">{matchupCommentCount}</p>
            <p className="text-xs text-muted-foreground">Comments</p>
          </Card>
          <Card className="p-3 text-center">
            <TrendingUp className={`h-4 w-4 mx-auto mb-1 ${matchup.optionAPercent === matchup.optionBPercent ? 'text-muted-foreground' : leadingA ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`} />
            <p className={`text-lg font-bold font-mono ${matchup.optionAPercent === matchup.optionBPercent ? 'text-muted-foreground' : leadingA ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`} data-testid="text-margin">
              {matchup.optionAPercent === matchup.optionBPercent ? 'Tied' : `${Math.abs(matchup.optionAPercent - matchup.optionBPercent)}pts`}
            </p>
            <p className="text-xs text-muted-foreground">Margin</p>
          </Card>
        </div>

        {/* About This Matchup */}
        {matchup.description && (
          <Card className="p-5 mb-6" data-testid="section-about">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
              About This Matchup
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {matchup.description}
            </p>
          </Card>
        )}

        {/* Discussion */}
        <button
          type="button"
          onClick={() => setCommentsSheetOpen(true)}
          className="w-full flex items-center justify-between rounded-xl border border-border/50 bg-card p-4 mb-6 md:hidden"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500" />
            <span className="text-sm font-semibold">Discussion</span>
            <span className="text-xs text-muted-foreground">({matchupCommentCount})</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>

        <div className="hidden md:block">
          <CardComments entityType="matchup" slug={slug || ""} placeholder="Share your thoughts on this matchup..." />
        </div>

        {/* Back to Vote */}
        <div className="flex justify-center pb-8">
          <Link href="/vote">
            <Button variant="outline" data-testid="button-back-to-vote">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Vote
            </Button>
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setCommentsSheetOpen(true)}
        className="fixed bottom-24 right-4 z-40 md:hidden flex items-center gap-1.5 rounded-full bg-cyan-600 text-white px-4 py-2.5 shadow-lg"
      >
        <MessageSquare className="h-4 w-4" />
        <span className="text-xs font-semibold">{matchupCommentCount}</span>
      </button>

      <CommentsBottomSheet
        open={commentsSheetOpen}
        onOpenChange={setCommentsSheetOpen}
        entityType="matchup"
        slug={slug || ""}
      />
    </div>
  );
}
