import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { UserMenu } from "@/components/UserMenu";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest } from "@/lib/queryClient";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";
import {
  ArrowLeft,
  Users,
  Loader2,
  Share2,
  Copy,
  Check,
  BarChart3,
  Star,
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

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

  const voteMutation = useMutation({
    mutationFn: async ({ matchupId, option }: { matchupId: string; option: string }) => {
      const res = await apiRequest("POST", `/api/matchups/${matchupId}/vote`, { option });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matchups/by-slug", slug] });
      queryClient.invalidateQueries({ queryKey: ["/api/matchups/user-votes"] });
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

  const handleVote = (matchupId: string, option: 'option_a' | 'option_b') => {
    voteMutation.mutate({ matchupId, option });
  };

  const handleRemoveVote = (matchupId: string) => {
    removeVoteMutation.mutate(matchupId);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast({ title: "Link Copied", description: "Matchup URL copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (error || !matchup) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto flex items-center justify-between h-14 px-4">
            <Link href="/" data-testid="link-home">
              <AuthoriDexLogo size={24} />
            </Link>
            <UserMenu />
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Matchup Not Found</h1>
          <p className="text-muted-foreground mb-6">This matchup may have been removed or doesn't exist.</p>
          <Link href="/vote">
            <Button variant="outline" data-testid="button-back-to-vote">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Vote
            </Button>
          </Link>
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <Link href="/" data-testid="link-home">
            <AuthoriDexLogo size={24} />
          </Link>
          <UserMenu />
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/vote">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryPill category={matchup.category} />
              {matchup.featured && (
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />
              )}
              <Badge variant="outline" className="text-xs">
                {matchup.visibility === 'live' ? 'Active' : matchup.visibility}
              </Badge>
            </div>
            <h1 className="text-xl font-bold mt-1 truncate" data-testid="text-matchup-title">
              {matchup.promptText || `${matchup.optionAText} vs ${matchup.optionBText}`}
            </h1>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCopyLink} data-testid="button-share">
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
          </Button>
        </div>

        <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50 mb-6">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-sky-600/5 rounded-lg" />
          
          <div className="relative p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-cyan-400" />
              <span className="text-sm text-muted-foreground">{matchup.totalVotes.toLocaleString('en-US')} votes</span>
              <span className="text-xs text-muted-foreground ml-auto">Created {formatDate(matchup.createdAt)}</span>
            </div>
            
            {!hasVoted && !matchup.promptText && (
              <div className="text-center mb-4">
                <span className="text-sm text-muted-foreground">
                  Tap to cast your vote
                </span>
              </div>
            )}

            <div className="flex items-stretch gap-3">
              <button
                onClick={() => {
                  if (!hasVoted || votedB) handleVote(matchup.id, 'option_a');
                }}
                className={`flex-1 flex flex-col rounded-lg border transition-all duration-300 overflow-hidden cursor-pointer ${
                  hasVoted
                    ? votedA
                      ? 'border-cyan-500/50 ring-2 ring-cyan-500/30'
                      : 'border-slate-700/30 opacity-70 hover:opacity-90 hover:border-cyan-500/30'
                    : 'border-slate-700/50 hover:border-cyan-500/50'
                }`}
                data-testid="button-vote-option-a"
              >
                <div className="relative" style={{ minHeight: '260px' }}>
                  {matchup.optionAImage ? (
                    <div className="absolute inset-0">
                      <img 
                        src={matchup.optionAImage} 
                        alt={matchup.optionAText}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedA ? 'from-cyan-600/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
                  )}
                </div>
                <div className="px-3 py-3 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                  <span className="font-semibold truncate block">{matchup.optionAText}</span>
                </div>
              </button>
              
              <div className="flex items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
                  <span className="text-sm font-bold text-slate-200">VS</span>
                </div>
              </div>
              
              <button
                onClick={() => {
                  if (!hasVoted || votedA) handleVote(matchup.id, 'option_b');
                }}
                className={`flex-1 flex flex-col rounded-lg border transition-all duration-300 overflow-hidden cursor-pointer ${
                  hasVoted
                    ? votedB
                      ? 'border-sky-600/50 ring-2 ring-sky-600/30'
                      : 'border-slate-700/30 opacity-70 hover:opacity-90 hover:border-sky-600/30'
                    : 'border-slate-700/50 hover:border-sky-600/50'
                }`}
                data-testid="button-vote-option-b"
              >
                <div className="relative" style={{ minHeight: '260px' }}>
                  {matchup.optionBImage ? (
                    <div className="absolute inset-0">
                      <img 
                        src={matchup.optionBImage} 
                        alt={matchup.optionBText}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedB ? 'from-sky-700/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
                  )}
                </div>
                <div className="px-3 py-3 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                  <span className="font-semibold truncate block">{matchup.optionBText}</span>
                </div>
              </button>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-bold ${hasVoted ? (leadingA ? 'text-cyan-400' : 'text-slate-400') : 'text-slate-600'}`}>
                    {hasVoted ? `${matchup.optionAPercent}%` : '?'}
                  </span>
                  {hasVoted && votedA && (
                    <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-400 px-1.5 py-0">
                      Your pick
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasVoted && votedB && (
                    <Badge variant="outline" className="text-[10px] border-sky-600/40 text-sky-500 px-1.5 py-0">
                      Your pick
                    </Badge>
                  )}
                  <span className={`text-xl font-bold ${hasVoted ? (!leadingA ? 'text-[#0386C9]' : 'text-slate-400') : 'text-slate-600'}`}>
                    {hasVoted ? `${matchup.optionBPercent}%` : '?'}
                  </span>
                </div>
              </div>
              <div className={`h-3 rounded-full overflow-hidden flex ${hasVoted ? 'bg-slate-700/50' : 'bg-slate-700/30'}`}>
                {hasVoted ? (
                  <>
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
                      style={{ width: `${matchup.optionAPercent}%` }}
                    />
                    <div 
                      className="h-full bg-gradient-to-r from-sky-500 to-sky-600 transition-all duration-500"
                      style={{ width: `${matchup.optionBPercent}%` }}
                    />
                  </>
                ) : (
                  <div className="h-full w-full bg-slate-700/40" />
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className={`text-xs font-medium ${hasVoted ? 'text-slate-400' : 'text-slate-600'}`}>{matchup.optionAText}</span>
                <span className={`text-xs font-medium ${hasVoted ? 'text-slate-400' : 'text-slate-600'}`}>{matchup.optionBText}</span>
              </div>
            </div>

            {hasVoted && (
              <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-slate-700/30">
                <span className="text-xs text-slate-500">Tap the other image to change your vote</span>
                <span className="text-xs text-slate-500/40">|</span>
                <button
                  onClick={() => handleRemoveVote(matchup.id)}
                  className="text-xs text-slate-500 hover:text-red-400/80 transition-colors"
                  data-testid="button-remove-vote"
                >
                  Remove vote
                </button>
              </div>
            )}
          </div>
        </Card>

        <Card className="bg-slate-900/60 border-slate-700/30 p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-semibold text-slate-300">Stats</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan-400" data-testid="stat-total-votes">{matchup.totalVotes.toLocaleString('en-US')}</div>
              <div className="text-xs text-muted-foreground">Total Votes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan-400" data-testid="stat-option-a-votes">{matchup.optionAVotes.toLocaleString('en-US')}</div>
              <div className="text-xs text-muted-foreground">{matchup.optionAText}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-sky-500" data-testid="stat-option-b-votes">{matchup.optionBVotes.toLocaleString('en-US')}</div>
              <div className="text-xs text-muted-foreground">{matchup.optionBText}</div>
            </div>
          </div>
        </Card>

        {matchup.promptText && (
          <Card className="bg-slate-900/60 border-slate-700/30 p-5 mb-6">
            <div className="text-sm font-semibold text-slate-300 mb-2">Context</div>
            <p className="text-sm text-muted-foreground">{matchup.promptText}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
