import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { UserMenu } from "@/components/UserMenu";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";
import {
  ArrowLeft,
  Clock,
  Users,
  Loader2,
  Send,
  ThumbsUp,
  ThumbsDown,
  BarChart3,
  Info,
  Share2,
  MessageSquare,
  ArrowUpDown,
  Copy,
  Star,
  Check,
  Swords,
  TrendingUp,
} from "lucide-react";

interface MatchupDetail {
  id: string;
  category: string;
  title: string;
  optionAText: string;
  optionAImage: string | null;
  optionBText: string;
  optionBImage: string | null;
  promptText: string | null;
  description: string | null;
  isActive: boolean;
  visibility: string;
  featured: boolean;
  slug: string | null;
  createdAt: string;
  optionAVotes: number;
  optionBVotes: number;
  totalVotes: number;
  optionAPercent: number;
  optionBPercent: number;
}

interface MatchupComment {
  id: string;
  matchupId: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  body: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

function formatTimeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
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

export default function MatchupDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoggedIn } = useAuth();

  const [commentBody, setCommentBody] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");

  const { data: matchup, isLoading, error } = useQuery<MatchupDetail>({
    queryKey: ["/api/matchups/by-slug", slug],
    queryFn: async () => {
      const res = await fetch(`/api/matchups/by-slug/${slug}`);
      if (!res.ok) throw new Error("Matchup not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const { data: userVotes } = useQuery<Record<string, string>>({
    queryKey: ["/api/matchups/user-votes"],
  });

  const { data: comments = [] } = useQuery<MatchupComment[]>({
    queryKey: ["/api/matchups", slug, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/matchups/${slug}/comments`);
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    enabled: !!slug,
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

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/matchups/${slug}/comments`, { body });
      return res.json();
    },
    onSuccess: () => {
      setCommentBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/matchups", slug, "comments"] });
      toast({ title: "Comment Posted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to post comment. Please sign in.", variant: "destructive" });
    },
  });

  const commentVoteMutation = useMutation({
    mutationFn: async ({ commentId, voteType }: { commentId: string; voteType: "up" | "down" }) => {
      const res = await apiRequest("POST", `/api/matchups/comments/${commentId}/vote`, { voteType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matchups", slug, "comments"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to vote. Please sign in.", variant: "destructive" });
    },
  });

  const sortedComments = useMemo(() => {
    if (!comments.length) return [];
    const sorted = [...comments];
    if (commentSort === "top") {
      sorted.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [comments, commentSort]);

  const handleVote = (matchupId: string, option: 'option_a' | 'option_b') => {
    voteMutation.mutate({ matchupId, option });
  };

  const handleRemoveVote = (matchupId: string) => {
    removeVoteMutation.mutate(matchupId);
  };

  const handleShare = () => {
    sharePage(matchup ? `${matchup.title} on AuthoriDex` : "AuthoriDex");
  };

  const handlePostComment = () => {
    if (!commentBody.trim()) return;
    commentMutation.mutate(commentBody.trim());
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (error || !matchup) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/" data-testid="link-logo-home">
                <AuthoriDexLogo size={28} />
              </Link>
              <Button variant="ghost" size="sm" onClick={() => { window.history.length > 1 ? window.history.back() : setLocation("/vote"); }} data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Vote
              </Button>
            </div>
            <UserMenu />
          </div>
        </header>
        <div className="max-w-3xl mx-auto px-4 py-8">
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
  const leadingA = matchup.optionAPercent >= matchup.optionBPercent;

  return (
    <div className="min-h-screen bg-background" data-testid="matchup-detail-page">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" data-testid="link-logo-home">
              <AuthoriDexLogo size={28} />
            </Link>
            <Button variant="ghost" size="sm" onClick={() => { window.history.length > 1 ? window.history.back() : setLocation("/vote"); }} data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Vote
            </Button>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header Block */}
        <div className="mb-6" data-testid="section-matchup-header">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <CategoryPill category={matchup.category} />
            <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400">
              Matchup
            </Badge>
            {matchup.featured && (
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
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

        {/* Cast Your Vote */}
        <Card className="p-5 mb-6 border-cyan-500/20" data-testid="section-vote-module">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <Swords className="h-5 w-5 text-cyan-500" />
            Cast Your Vote
          </h2>

          <div className="flex items-stretch gap-0 relative mb-4">
            <button
              onClick={() => {
                if (!hasVoted || votedB) handleVote(matchup.id, 'option_a');
              }}
              className={`flex-1 flex flex-col rounded-lg border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedA
                    ? 'border-blue-500/60 ring-2 ring-blue-500/30'
                    : 'border-border/30 opacity-70 hover:opacity-90 hover:border-blue-500/30'
                  : 'border-border/50 hover:border-blue-500/50'
              }`}
              data-testid="button-vote-option-a"
            >
              <div className="relative" style={{ minHeight: '320px' }}>
                {matchup.optionAImage ? (
                  <div className="absolute inset-0">
                    <img
                      src={matchup.optionAImage}
                      alt={matchup.optionAText}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget;
                        const exts = ['.webp', '.png', '.jpg', '.jpeg'];
                        const src = img.src;
                        const currentExt = exts.find(ext => src.toLowerCase().endsWith(ext));
                        const nextIdx = currentExt ? exts.indexOf(currentExt) + 1 : exts.length;
                        if (nextIdx < exts.length) {
                          img.src = src.substring(0, src.length - (currentExt?.length ?? 0)) + exts[nextIdx];
                        } else {
                          img.style.display = 'none';
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className={`absolute inset-0 bg-gradient-to-br ${votedA ? 'from-blue-600/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
                )}
                {votedA && (
                  <div className="absolute top-2 right-2">
                    <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-400 bg-black/50 backdrop-blur-sm py-0">
                      Your pick
                    </Badge>
                  </div>
                )}
              </div>
              <div className="px-3 py-3 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                <span className="font-semibold truncate block">{matchup.optionAText}</span>
              </div>
            </button>

            <div className="absolute left-1/2 top-[calc(50%-16px)] -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center pointer-events-none">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
                <span className="text-xs font-bold text-slate-200">VS</span>
              </div>
            </div>

            <button
              onClick={() => {
                if (!hasVoted || votedA) handleVote(matchup.id, 'option_b');
              }}
              className={`flex-1 flex flex-col rounded-lg border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedB
                    ? 'border-amber-500/60 ring-2 ring-amber-500/30'
                    : 'border-border/30 opacity-70 hover:opacity-90 hover:border-amber-500/30'
                  : 'border-border/50 hover:border-amber-500/50'
              }`}
              data-testid="button-vote-option-b"
            >
              <div className="relative" style={{ minHeight: '320px' }}>
                {matchup.optionBImage ? (
                  <div className="absolute inset-0">
                    <img
                      src={matchup.optionBImage}
                      alt={matchup.optionBText}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget;
                        const exts = ['.webp', '.png', '.jpg', '.jpeg'];
                        const src = img.src;
                        const currentExt = exts.find(ext => src.toLowerCase().endsWith(ext));
                        const nextIdx = currentExt ? exts.indexOf(currentExt) + 1 : exts.length;
                        if (nextIdx < exts.length) {
                          img.src = src.substring(0, src.length - (currentExt?.length ?? 0)) + exts[nextIdx];
                        } else {
                          img.style.display = 'none';
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className={`absolute inset-0 bg-gradient-to-br ${votedB ? 'from-amber-700/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
                )}
                {votedB && (
                  <div className="absolute top-2 right-2">
                    <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400 bg-black/50 backdrop-blur-sm py-0">
                      Your pick
                    </Badge>
                  </div>
                )}
              </div>
              <div className="px-3 py-3 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                <span className="font-semibold truncate block">{matchup.optionBText}</span>
              </div>
            </button>
          </div>

          {hasVoted && (
            <div className="flex items-center justify-center gap-3 pt-3 border-t border-border/30">
              <span className="text-xs text-muted-foreground">Tap the other option to change your vote</span>
              <span className="text-xs text-muted-foreground/40">|</span>
              <button
                onClick={() => handleRemoveVote(matchup.id)}
                className="text-xs text-muted-foreground hover:text-red-400/80 transition-colors underline-offset-4 hover:underline"
                data-testid="button-remove-vote"
              >
                Remove vote
              </button>
            </div>
          )}

          {!isLoggedIn && !hasVoted && (
            <p className="text-xs text-center text-muted-foreground pt-2">
              <Button variant="ghost" className="p-0 h-auto text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-vote">
                Sign in
              </Button>{" "}
              to cast your vote
            </p>
          )}
        </Card>

        {/* Results */}
        <Card className="p-5 mb-6" data-testid="section-results">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
            Results
          </h2>

          <div className="space-y-3 mb-4" data-testid="bar-results">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">{matchup.optionAText}</span>
                <span className={`text-sm font-bold font-mono ${leadingA ? 'text-blue-400' : 'text-muted-foreground'}`}>
                  {matchup.optionAPercent}%
                </span>
              </div>
              <div className="h-8 rounded-md bg-blue-500/10 border border-blue-500/30 overflow-hidden relative">
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

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">{matchup.optionBText}</span>
                <span className={`text-sm font-bold font-mono ${!leadingA ? 'text-amber-400' : 'text-muted-foreground'}`}>
                  {matchup.optionBPercent}%
                </span>
              </div>
              <div className="h-8 rounded-md bg-amber-500/10 border border-amber-500/30 overflow-hidden relative">
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

          <div className="grid grid-cols-2 gap-3 text-center mb-3">
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="h-2.5 w-2.5 rounded-full bg-blue-400" />
                <span className="text-xs font-medium">{matchup.optionAText}</span>
              </div>
              <p className="text-lg font-bold font-mono text-blue-400" data-testid="text-option-a-percent">{matchup.optionAPercent}%</p>
              <p className="text-xs text-muted-foreground">{matchup.optionAVotes.toLocaleString('en-US')} votes</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-medium">{matchup.optionBText}</span>
              </div>
              <p className="text-lg font-bold font-mono text-amber-400" data-testid="text-option-b-percent">{matchup.optionBPercent}%</p>
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
            <Users className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-votes">{matchup.totalVotes.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Total Votes</p>
          </Card>
          <Card className="p-3 text-center">
            <MessageSquare className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-comment-count">{comments.length}</p>
            <p className="text-xs text-muted-foreground">Comments</p>
          </Card>
          <Card className="p-3 text-center">
            <TrendingUp className={`h-4 w-4 mx-auto mb-1 ${matchup.optionAPercent === matchup.optionBPercent ? 'text-muted-foreground' : leadingA ? 'text-blue-400' : 'text-amber-400'}`} />
            <p className={`text-lg font-bold font-mono ${matchup.optionAPercent === matchup.optionBPercent ? 'text-muted-foreground' : leadingA ? 'text-blue-400' : 'text-amber-400'}`} data-testid="text-margin">
              {matchup.optionAPercent === matchup.optionBPercent ? 'Tied' : `${Math.abs(matchup.optionAPercent - matchup.optionBPercent)}pts`}
            </p>
            <p className="text-xs text-muted-foreground">Margin</p>
          </Card>
        </div>

        {/* About This Matchup */}
        {matchup.description && (
          <Card className="p-5 mb-6" data-testid="section-about">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-cyan-500" />
              About This Matchup
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {matchup.description}
            </p>
          </Card>
        )}

        {/* Discussion */}
        <Card className="p-5 mb-6" data-testid="section-comments">
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <h2 className="text-lg font-serif font-bold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-cyan-500" />
              Discussion ({comments.length})
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant={commentSort === "top" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCommentSort("top")}
                data-testid="button-sort-top"
              >
                <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
                Top
              </Button>
              <Button
                variant={commentSort === "newest" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCommentSort("newest")}
                data-testid="button-sort-newest"
              >
                <Clock className="h-3.5 w-3.5 mr-1" />
                Newest
              </Button>
            </div>
          </div>

          {isLoggedIn ? (
            <div className="mb-5">
              <Textarea
                placeholder="Share your thoughts on this matchup..."
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
                <Button variant="ghost" className="p-0 h-auto text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-comment">
                  Sign in
                </Button>{" "}
                to join the discussion
              </p>
            </div>
          )}

          {sortedComments.length > 0 ? (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-4">
                {sortedComments.map((comment, idx) => {
                  const netVotes = comment.upvotes - comment.downvotes;
                  const isTopComment = commentSort === "top" && idx === 0 && netVotes > 0;
                  return (
                    <div
                      key={comment.id}
                      className={`flex gap-3 p-3 rounded-lg ${isTopComment ? "bg-cyan-500/5 border border-cyan-500/20" : ""}`}
                      data-testid={`comment-${comment.id}`}
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        {comment.avatarUrl && <AvatarImage src={comment.avatarUrl} alt={comment.username || ""} />}
                        <AvatarFallback className="bg-cyan-500/20 text-cyan-400 text-xs font-semibold">
                          {(comment.username || "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold" data-testid={`text-comment-user-${comment.id}`}>
                            {comment.username || "Anonymous"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(comment.createdAt)}
                          </span>
                          {isTopComment && (
                            <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400 py-0">
                              Top Take
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap" data-testid={`text-comment-body-${comment.id}`}>
                          {comment.body}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "up" })}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-400 transition-colors"
                            data-testid={`button-upvote-${comment.id}`}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                            {comment.upvotes > 0 && <span>{comment.upvotes}</span>}
                          </button>
                          <button
                            onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "down" })}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-400 transition-colors"
                            data-testid={`button-downvote-${comment.id}`}
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                            {comment.downvotes > 0 && <span>{comment.downvotes}</span>}
                          </button>
                          {netVotes !== 0 && (
                            <span className={`text-xs font-mono ${netVotes > 0 ? "text-cyan-400" : "text-rose-400"}`}>
                              {netVotes > 0 ? `+${netVotes}` : netVotes}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              No comments yet. Be the first to share your thoughts!
            </p>
          )}
        </Card>

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
    </div>
  );
}
