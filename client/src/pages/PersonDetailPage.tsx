import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { handleImageError } from "@/lib/imageResolver";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TrendBadge } from "@/components/TrendBadge";
import { StatCard } from "@/components/StatCard";
import { UserMenu } from "@/components/UserMenu";
import { ProfileTabs } from "@/components/ProfileTabs";
import { CategoryPill, getCategoryStyle } from "@/components/CategoryPill";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { TrendScoreInfoIcon } from "@/components/TrendScoreInfo";
import { ApprovalRatingInfoIcon } from "@/components/ApprovalRatingInfo";
import { CardSection } from "@/components/CardSection";
import { UnifiedSectionHeader } from "@/components/UnifiedSectionHeader";
import { UnderratedOverratedCard, type ValueVotePerson } from "@/components/UnderratedOverratedCard";
import { CurateProfileCard, type CuratePerson } from "@/components/curate";
import {
  ArrowLeft,
  Share2,
  Star,
  Users,
  MessageSquare,
  Trophy,
  Zap,
  Camera,
  Check,
  X,
  Search,
  ThumbsUp,
  ThumbsDown,
  Minus,
  HelpCircle,
  Swords,
  ListChecks,
  ChevronRight,
  BarChart3,
  CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { useFavorites } from "@/hooks/useFavorites";
import { formatNumber, getApprovalColor } from "@/lib/formatNumber";
import { WhyTrendingCard } from "@/components/WhyTrendingCard";
import { getExceptionalIndicator } from "@/lib/leaderboard-exceptional";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions } from "@/lib/signInToVoteToast";
import { ViewAllOverlayHeader } from "@/components/ViewAllOverlayHeader";

const LazyPredictTab = lazy(() =>
  import("@/components/PredictTab").then((m) => ({ default: m.PredictTab }))
);
const LazyTrendChart = lazy(() =>
  import("@/components/TrendChart").then((m) => ({ default: m.TrendChart }))
);
const LazyInlineCelebrityBio = lazy(() =>
  import("@/components/InlineCelebrityBio").then((m) => ({ default: m.InlineCelebrityBio }))
);
const LazyCommunityInsights = lazy(() =>
  import("@/components/CommunityInsights").then((m) => ({ default: m.CommunityInsights }))
);
const LazyAnimatedSentimentVotingWidget = lazy(() =>
  import("@/components/AnimatedSentimentVotingWidget").then((m) => ({
    default: m.AnimatedSentimentVotingWidget,
  }))
);

function ProfileLazyFallback({ minHeight }: { minHeight?: string }) {
  return (
    <div
      className="flex items-center justify-center py-12"
      style={minHeight ? { minHeight } : undefined}
    >
      <div className="h-8 w-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

interface ValueVoteMetrics {
  userVote: "underrated" | "overrated" | "fairly_rated" | null;
  underratedPct: number | null;
  overratedPct: number | null;
  fairlyRatedPct: number | null;
  valueScore: number | null;
  underratedVotesCount: number;
  overratedVotesCount: number;
  fairlyRatedVotesCount: number;
}

interface FeaturedPoll {
  id: string;
  headline: string;
  description: string;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  totalVotes: number;
}

interface CelebrityImage {
  id: string;
  personId: string;
  imageUrl: string;
  source: string | null;
  isPrimary: boolean;
  votesUp: number;
  votesDown: number;
  addedAt: string;
}

interface MatchupData {
  id: string;
  category: string;
  title: string;
  optionAText: string;
  optionAImage: string | null;
  optionAFallbackImage?: string | null;
  optionBText: string;
  optionBImage: string | null;
  optionBFallbackImage?: string | null;
  promptText?: string | null;
  isActive?: boolean;
  visibility?: string;
  featured?: boolean;
  slug?: string | null;
  createdAt?: string;
  optionAVotes: number;
  optionBVotes: number;
  totalVotes: number;
  optionAPercent: number;
  optionBPercent: number;
  personAId?: string | null;
  personBId?: string | null;
  relatedPersonIds?: string[];
}

interface TrendingPoll {
  id: string;
  headline: string;
  subjectText?: string | null;
  description?: string | null;
  category: string;
  personId?: string | null;
  personName?: string | null;
  personAvatar?: string | null;
  imageUrl?: string | null;
  slug?: string | null;
  totalVotes: number;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  relatedPersonIds?: string[];
}

interface OpinionPollOption {
  id: string;
  name: string;
  imageUrl?: string | null;
  personId?: string | null;
  personName?: string | null;
  votes: number;
  percent: number;
}

interface OpinionPoll {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  slug: string;
  options: OpinionPollOption[];
  totalVotes: number;
  userVote?: string | null;
  relatedPersonIds?: string[];
}

function ProfileMatchupCard({
  matchup,
  userVote,
  onVote,
  onRemoveVote,
}: {
  matchup: MatchupData;
  userVote: string | null;
  onVote: (matchupId: string, option: "option_a" | "option_b") => void;
  onRemoveVote: (matchupId: string) => void;
}) {
  const hasVoted = userVote !== null;
  const votedA = userVote === "option_a";
  const votedB = userVote === "option_b";
  const leadingA = matchup.optionAPercent >= matchup.optionBPercent;

  const handleVoteA = () => {
    if (!hasVoted || votedB) onVote(matchup.id, "option_a");
  };

  const handleVoteB = () => {
    if (!hasVoted || votedA) onVote(matchup.id, "option_b");
  };

  return (
    <div className="relative group h-full">
      <div className="absolute -inset-[1px] rounded-xl border border-cyan-500/60 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 hidden md:block" />
      <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:group-hover:shadow-cyan-500/20 transition-all h-full flex flex-col rounded-none md:rounded-xl min-h-[390px] md:min-h-0">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-sky-600/5 rounded-lg md:rounded-xl" />

        <div className="relative pt-4 pb-4 flex flex-col flex-1">
          <div className="absolute top-3 right-3 z-10">
            <CategoryPill category={matchup.category} data-testid={`badge-matchup-${matchup.id}`} />
          </div>
          <div className="flex items-center mb-3 gap-2 px-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5 text-cyan-400" />
              <span>{matchup.totalVotes.toLocaleString("en-US")} votes</span>
            </div>
          </div>

          <div className="rounded-t-lg border border-slate-700/30 border-b-0 bg-slate-900/80 backdrop-blur-sm px-4 py-2 text-center mb-0 mt-[5px]">
            {matchup.slug ? (
              <Link
                href={`/vote/matchups/${matchup.slug}`}
                className={`text-sm font-semibold transition-colors ${hasVoted ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-300 hover:text-cyan-400'}`}
                data-testid={`link-matchup-${matchup.id}`}
              >
                {hasVoted ? "View details →" : (matchup.promptText || "Who do you prefer?")}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-slate-300">
                {matchup.promptText || "Who do you prefer?"}
              </span>
            )}
          </div>

          <div className="flex items-stretch gap-0 relative">
            <button
              onClick={handleVoteA}
              className={`flex-1 flex flex-col rounded-t-none rounded-b-lg border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedA
                    ? "border-cyan-500/50 ring-2 ring-cyan-500/30"
                    : "border-slate-700/30 opacity-70 hover:opacity-90 hover:border-cyan-500/30"
                  : "border-slate-700/50 hover:border-cyan-500/50"
              }`}
              data-testid={`button-vote-a-${matchup.id}`}
            >
              <div className="relative" style={{ minHeight: "222px" }}>
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
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${
                      hasVoted && votedA
                        ? "from-cyan-600/30 via-slate-800 to-slate-900"
                        : "from-slate-700 via-slate-800 to-slate-900"
                    }`}
                  />
                )}
              </div>
              <div className="px-2 py-2 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                <span className="font-semibold text-sm truncate block">{matchup.optionAText}</span>
              </div>
            </button>

            <div className="absolute left-1/2 top-[calc(50%-16px)] -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center pointer-events-none">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
                <span className="text-xs font-bold text-slate-200">VS</span>
              </div>
            </div>

            <button
              onClick={handleVoteB}
              className={`flex-1 flex flex-col rounded-t-none rounded-b-lg border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedB
                    ? "border-sky-600/50 ring-2 ring-sky-600/30"
                    : "border-slate-700/30 opacity-70 hover:opacity-90 hover:border-sky-600/30"
                  : "border-slate-700/50 hover:border-sky-600/50"
              }`}
              data-testid={`button-vote-b-${matchup.id}`}
            >
              <div className="relative" style={{ minHeight: "222px" }}>
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
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${
                      hasVoted && votedB
                        ? "from-sky-700/30 via-slate-800 to-slate-900"
                        : "from-slate-700 via-slate-800 to-slate-900"
                    }`}
                  />
                )}
              </div>
              <div className="px-2 py-2 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700/30 text-center">
                <span className="font-semibold text-sm truncate block">{matchup.optionBText}</span>
              </div>
            </button>
          </div>

          <div className="mt-auto pt-3 px-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-lg font-bold ${
                      hasVoted ? (leadingA ? "text-cyan-400" : "text-slate-400") : "text-slate-600"
                    }`}
                  >
                    {hasVoted ? `${matchup.optionAPercent}%` : "%"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-lg font-bold ${
                      hasVoted ? (!leadingA ? "text-[#0386C9]" : "text-slate-400") : "text-slate-600"
                    }`}
                  >
                    {hasVoted ? `${matchup.optionBPercent}%` : "%"}
                  </span>
                </div>
              </div>
              <div className={`h-2.5 rounded-full overflow-hidden flex ${hasVoted ? "bg-slate-700/50" : "bg-slate-700/30"}`}>
                {hasVoted ? (
                  <>
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                      style={{ width: `${matchup.optionAPercent}%` }}
                    />
                    <div
                      className="h-full bg-gradient-to-r from-sky-500 to-sky-600"
                      style={{ width: `${matchup.optionBPercent}%` }}
                    />
                  </>
                ) : (
                  <div className="h-full w-full bg-slate-700/40" />
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className={`text-[11px] font-medium ${hasVoted ? "text-slate-500" : "text-slate-600"}`}>
                  {matchup.optionAText}
                </span>
                <span className={`text-[11px] font-medium ${hasVoted ? "text-slate-500" : "text-slate-600"}`}>
                  {matchup.optionBText}
                </span>
              </div>
            </div>
            {hasVoted ? (
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="text-[10px] text-slate-500/70">Tap the other image to change your vote</span>
                <span className="text-[10px] text-slate-500/40">|</span>
                <button
                  onClick={() => onRemoveVote(matchup.id)}
                  className="text-[10px] text-slate-500/70 hover:text-red-400/80 transition-colors"
                  data-testid={`button-remove-vote-${matchup.id}`}
                >
                  Remove vote
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-xs text-slate-500/70 mt-2">
                <Swords className="h-3.5 w-3.5 text-cyan-400/70" />
                <span className="font-medium">Tap an image to pick your side</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function parseOpinionPollVoteError(err: unknown): string {
  if (err instanceof Error && err.message) {
    const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
    if (jsonMatch) {
      try {
        const j = JSON.parse(jsonMatch[1]) as { error?: string };
        if (j.error) return j.error;
      } catch {
        /* ignore */
      }
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

function OpinionPollCardProfile({
  poll,
  onVote,
}: {
  poll: OpinionPoll;
  onVote: (pollSlug: string, optionId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [voted, setVoted] = useState<string | null>(poll.userVote || null);
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [pendingOption, setPendingOption] = useState<{ id: string; name: string } | null>(null);
  const options = poll.options || [];
  const visibleOptions = options.slice(0, 4);
  const remainingCount = options.length - 4;
  const totalVotes = poll.totalVotes || 0;
  const maxPercent = Math.max(...visibleOptions.map((o) => totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0), 0);

  useEffect(() => {
    setVoted(poll.userVote ?? null);
  }, [poll.userVote]);

  const handleVote = async (optionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!voted) {
      try {
        await onVote(poll.slug, optionId);
        setVoted(optionId);
      } catch (err) {
        if (isUnauthorizedApiError(err)) {
          toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
        } else {
          toast({
            title: "Could not record vote",
            description: parseOpinionPollVoteError(err),
            variant: "destructive",
          });
        }
      }
    }
  };

  const openChangeDialog = (option: (typeof options)[0], e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingOption({ id: option.id, name: option.name });
    setChangeDialogOpen(true);
  };

  const confirmChangeVote = async () => {
    if (!pendingOption) return;
    try {
      await onVote(poll.slug, pendingOption.id);
      setVoted(pendingOption.id);
      setChangeDialogOpen(false);
      setPendingOption(null);
    } catch (err) {
      if (isUnauthorizedApiError(err)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        toast({
          title: "Could not change vote",
          description: parseOpinionPollVoteError(err),
          variant: "destructive",
        });
      }
    }
  };

  const hasVoted = !!voted;

  return (
    <div className="relative group h-full">
      <div className="absolute -inset-[1px] rounded-xl border border-cyan-500/60 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 hidden md:block" />
      <Card
        className="relative pt-5 px-5 pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full min-h-[420px] md:min-h-0 flex flex-col border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:group-hover:shadow-cyan-500/20 rounded-none md:rounded-xl"
        data-testid={`opinion-poll-card-${poll.id}`}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-cyan-400" />
            <span className={hasVoted ? "" : "text-slate-600"}>
              {hasVoted ? `${totalVotes.toLocaleString("en-US")} votes` : "Votes"}
            </span>
          </div>
          <CategoryPill category={poll.category || ""} data-testid={`badge-opinion-category-${poll.id}`} />
        </div>

        <div className="flex items-start gap-3 mb-2">
          {poll.options[0]?.imageUrl ? (
            <div className="h-12 w-12 rounded-lg overflow-hidden shrink-0 bg-slate-800">
              <img src={poll.options[0].imageUrl!} alt={poll.title} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0">
              <ListChecks className="h-5 w-5 text-slate-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <Link href={`/vote/opinion-polls/${poll.slug}`} data-testid={`link-opinion-detail-${poll.id}`}>
              <h3 className="font-serif font-bold text-lg leading-tight hover:text-cyan-400 transition-colors cursor-pointer">
                {poll.title}
              </h3>
            </Link>
          </div>
        </div>
        {poll.description && (
          <Link href={`/vote/opinion-polls/${poll.slug}`}>
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2 hover:text-cyan-400 transition-colors cursor-pointer">{poll.description}</p>
          </Link>
        )}
        {!poll.description && <div className="flex-grow" />}

        {!hasVoted ? (
          <div className="space-y-1.5 mt-auto">
            {visibleOptions.map((option) => (
              <button
                key={option.id}
                onClick={(e) => handleVote(option.id, e)}
                className="w-full flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-muted/30 p-0 text-left transition-all duration-200 hover:border-cyan-500/50 hover:bg-cyan-500/10 active:scale-[0.99]"
                data-testid={`opinion-poll-option-${poll.id}-${option.id}`}
              >
                {option.imageUrl ? (
                  <div className="relative shrink-0 w-14 self-stretch min-h-[2.75rem]">
                    <img src={option.imageUrl} alt={option.name} className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/10">
                    <ListChecks className="h-4 w-4 text-cyan-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0 py-1.5 pl-2.5 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{option.name}</span>
                    <span className="shrink-0 text-xs font-mono font-bold text-slate-600">%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-700/50" />
                  <p className="text-[10px] text-slate-600 mt-0.5">Votes</p>
                </div>
              </button>
            ))}
            {remainingCount > 0 && (
              <Link href={`/vote/opinion-polls/${poll.slug}`}>
                <p className="text-xs text-cyan-400 text-center cursor-pointer hover:underline mt-2.5" data-testid={`link-more-options-${poll.id}`}>
                  +{remainingCount} more options
                </p>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-1.5 mt-auto">
            {visibleOptions.map((option) => {
              const isSelected = voted === option.id;
              const percent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
              const isLeading = percent === maxPercent && percent > 0;
              const rowClass = `rounded-lg border overflow-hidden transition-all duration-300 ${
                isSelected
                  ? 'border-cyan-500/60 bg-cyan-500/[0.08]'
                  : 'border-border/30 bg-muted/20'
              }`;
              const rowInner = (
                <div className="flex items-stretch overflow-hidden p-0">
                  {option.imageUrl ? (
                    <div className="relative shrink-0 w-14 self-stretch min-h-[2.75rem]">
                      <img src={option.imageUrl} alt={option.name} className="absolute inset-0 h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/10">
                      <ListChecks className="h-4 w-4 text-cyan-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 py-1.5 pl-2.5 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? 'font-semibold' : ''}`}>{option.name}</span>
                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />}
                      <span className={`shrink-0 text-xs font-mono font-bold ${
                        isLeading ? 'text-cyan-400' : 'text-muted-foreground'
                      }`}>{percent}%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${
                          isLeading ? 'bg-cyan-500' : isSelected ? 'bg-cyan-400/60' : 'bg-slate-600/50'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{(option.votes || 0).toLocaleString("en-US")} votes</p>
                  </div>
                </div>
              );
              return isSelected ? (
                <div
                  key={option.id}
                  className={rowClass}
                  data-testid={`opinion-poll-result-${poll.id}-${option.id}`}
                >
                  {rowInner}
                </div>
              ) : (
                <button
                  type="button"
                  key={option.id}
                  className={`${rowClass} w-full text-left cursor-pointer hover:border-cyan-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30`}
                  onClick={(e) => openChangeDialog(option, e)}
                  data-testid={`opinion-poll-result-${poll.id}-${option.id}`}
                >
                  {rowInner}
                </button>
              );
            })}
            {remainingCount > 0 && (
              <Link href={`/vote/opinion-polls/${poll.slug}`}>
                <p className="text-xs text-cyan-400 text-center cursor-pointer hover:underline mt-2.5" data-testid={`link-more-options-${poll.id}`}>
                  +{remainingCount} more options
                </p>
              </Link>
            )}
            <div className="flex items-center justify-between mt-2 pt-3 border-t border-border/30">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Zap className="h-3 w-3" />
                <span>{totalVotes.toLocaleString("en-US")} total votes</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-cyan-500/10 border-cyan-500/40 text-cyan-400" data-testid={`badge-voted-opinion-${poll.id}`}>
                You voted
              </span>
            </div>
          </div>
        )}
      </Card>

      <AlertDialog
        open={changeDialogOpen}
        onOpenChange={(open) => {
          setChangeDialogOpen(open);
          if (!open) setPendingOption(null);
        }}
      >
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Change your vote?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re switching to{" "}
              <span className="font-medium text-foreground">{pendingOption?.name ?? "this option"}</span>. You can
              change your vote once per day on this poll.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="button" className="bg-cyan-600 hover:bg-cyan-700" onClick={() => void confirmChangeVote()}>
              Change vote
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CurateProfileCardProfile({ 
  poll, 
  onVote,
  onComplete 
}: { 
  poll: any; 
  onVote: () => void;
  onComplete: () => void;
}) {
  const [selectedChoice, setSelectedChoice] = useState<'a' | 'b' | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const timeoutRef1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: images = [] } = useQuery<CelebrityImage[]>({
    queryKey: [`/api/people/${poll.personId}/images`],
    enabled: !!poll.personId,
  });

  const [imageA, imageB] = useMemo(() => {
    if (images.length < 2) return [null, null];
    return [images[0], images[1]];
  }, [images]);

  useEffect(() => {
    return () => {
      if (timeoutRef1.current) clearTimeout(timeoutRef1.current);
      if (timeoutRef2.current) clearTimeout(timeoutRef2.current);
    };
  }, []);

  const handlePick = (choice: 'a' | 'b') => {
    if (!selectedChoice) {
      setSelectedChoice(choice);
      setShowShimmer(true);
      onVote();
      timeoutRef1.current = setTimeout(() => {
        setShowShimmer(false);
        setIsExiting(true);
        timeoutRef2.current = setTimeout(onComplete, 300);
      }, 600);
    }
  };

  return (
    <motion.div 
      className="w-full"
      initial={{ opacity: 1, x: 0 }}
      animate={{ opacity: isExiting ? 0 : 1, x: isExiting ? -100 : 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card 
        className="p-4 transition-all duration-200 hover:shadow-[0_0_20px_rgba(148,163,184,0.08)] relative overflow-hidden"
        style={{ border: '1px solid rgba(148,163,184,0.18)' }}
        data-testid={`card-curate-profile-${poll.id}`}
      >
        <AnimatePresence>
          {showShimmer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 pointer-events-none"
            >
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '200%' }}
                transition={{ duration: 0.6, ease: 'easeInOut' }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-green-400/30 to-transparent skew-x-12"
              />
            </motion.div>
          )}
        </AnimatePresence>
        
        <p className="text-center text-lg font-serif font-bold text-cyan-400 mb-4">Which look defines them?</p>
        
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handlePick('a')}
            disabled={!!selectedChoice}
            className={`relative aspect-square rounded-lg overflow-hidden border-3 transition-all duration-300 group cursor-pointer ${
              selectedChoice === 'a' 
                ? 'border-green-500 ring-4 ring-green-500/30 scale-105' 
                : selectedChoice === 'b'
                ? 'border-muted opacity-40 scale-95'
                : 'border-transparent hover:border-cyan-500/50 hover:scale-102'
            }`}
            data-testid={`button-curate-photo-a-${poll.id}`}
          >
            {imageA ? (
              <>
                <img 
                  src={imageA.imageUrl} 
                  alt={`${poll.personName} Look A`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <span className="text-xs text-white font-medium">Look A</span>
                </div>
              </>
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <div className="text-center">
                  <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                  <span className="text-sm text-muted-foreground font-medium">Look A</span>
                </div>
              </div>
            )}
            {selectedChoice === 'a' && (
              <motion.div 
                className="absolute inset-0 bg-green-500/20 flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
                  className="h-12 w-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/40"
                >
                  <Check className="h-6 w-6 text-white" />
                </motion.div>
              </motion.div>
            )}
          </button>
          
          <button
            onClick={() => handlePick('b')}
            disabled={!!selectedChoice}
            className={`relative aspect-square rounded-lg overflow-hidden border-3 transition-all duration-300 group cursor-pointer ${
              selectedChoice === 'b' 
                ? 'border-green-500 ring-4 ring-green-500/30 scale-105' 
                : selectedChoice === 'a'
                ? 'border-muted opacity-40 scale-95'
                : 'border-transparent hover:border-cyan-500/50 hover:scale-102'
            }`}
            data-testid={`button-curate-photo-b-${poll.id}`}
          >
            {imageB ? (
              <>
                <img 
                  src={imageB.imageUrl} 
                  alt={`${poll.personName} Look B`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <span className="text-xs text-white font-medium">Look B</span>
                </div>
              </>
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <div className="text-center">
                  <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                  <span className="text-sm text-muted-foreground font-medium">Look B</span>
                </div>
              </div>
            )}
            {selectedChoice === 'b' && (
              <motion.div 
                className="absolute inset-0 bg-green-500/20 flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
                  className="h-12 w-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/40"
                >
                  <Check className="h-6 w-6 text-white" />
                </motion.div>
              </motion.div>
            )}
          </button>
        </div>
      </Card>
    </motion.div>
  );
}

function FeaturedPollCard({ 
  poll, 
  onVote 
}: { 
  poll: FeaturedPoll; 
  onVote: (choice: 'support' | 'neutral' | 'oppose') => void;
}) {
  const [voted, setVoted] = useState<'support' | 'neutral' | 'oppose' | null>(null);

  const handleVote = (choice: 'support' | 'neutral' | 'oppose') => {
    if (!voted) {
      setVoted(choice);
      onVote(choice);
    }
  };

  return (
    <Card 
      className="pt-6 px-5 pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full flex flex-col hover:shadow-[0_0_20px_rgba(148,163,184,0.08)] relative"
      style={{ border: '1px solid rgba(148,163,184,0.18)' }}
      data-testid={`card-featured-poll-${poll.id}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-cyan-400" />
        <span>{poll.totalVotes.toLocaleString('en-US')} votes</span>
      </div>
      <h3 className="font-serif font-bold text-lg mb-1">{poll.headline}</h3>
      <p className="text-sm text-muted-foreground mb-5 flex-grow">{poll.description}</p>
      
      {!voted ? (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleVote('support')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
            data-testid={`button-poll-support-${poll.id}`}
          >
            <ThumbsUp className="h-4 w-4 shrink-0" />
            <span>Support</span>
          </button>
          <button
            onClick={() => handleVote('neutral')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15"
            data-testid={`button-poll-neutral-${poll.id}`}
          >
            <Minus className="h-4 w-4 shrink-0" />
            <span>Neutral</span>
          </button>
          <button
            onClick={() => handleVote('oppose')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
            data-testid={`button-poll-oppose-${poll.id}`}
          >
            <ThumbsDown className="h-4 w-4 shrink-0" />
            <span>Oppose</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <ThumbsUp className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="text-sm text-emerald-400 w-16 shrink-0">Support</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${poll.approvePercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-10 text-right">{poll.approvePercent}%</span>
          </div>
          <div className="flex items-center gap-3">
            <Minus className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="text-sm text-slate-400 w-16 shrink-0">Neutral</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-slate-400 rounded-full transition-all duration-500"
                style={{ width: `${poll.neutralPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-10 text-right">{poll.neutralPercent}%</span>
          </div>
          <div className="flex items-center gap-3">
            <ThumbsDown className="h-4 w-4 text-red-400 shrink-0" />
            <span className="text-sm text-red-400 w-16 shrink-0">Oppose</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-red-400 rounded-full transition-all duration-500"
                style={{ width: `${poll.disapprovePercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-10 text-right">{poll.disapprovePercent}%</span>
          </div>
          <button
            onClick={() => setVoted(null)}
            className="text-xs text-muted-foreground hover:text-foreground mt-2 underline"
            data-testid={`button-change-vote-${poll.id}`}
          >
            Change vote
          </button>
        </div>
      )}
    </Card>
  );
}

function ViewAllPollsOverlay({
  open,
  onClose,
  title,
  polls,
  onVote
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  polls: FeaturedPoll[];
  onVote: (pollId: string, choice: 'support' | 'neutral' | 'oppose') => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  
  if (!open) return null;

  const filteredPolls = polls.filter(p => 
    !searchQuery || p.headline.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto premium-scrollbar" data-testid="overlay-view-all-polls">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-4">
          <ViewAllOverlayHeader
            onClose={onClose}
            closeTestId="button-close-polls-overlay"
            backTestId="button-back-polls-overlay"
            className="flex items-center justify-between gap-2 mb-4"
          >
            <h2 className="font-serif font-bold text-xl truncate">{title}</h2>
          </ViewAllOverlayHeader>
          
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search polls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-polls-overlay-search"
            />
          </div>
        </div>
      </div>
      
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPolls.map((poll) => (
            <FeaturedPollCard 
              key={poll.id} 
              poll={poll} 
              onVote={(choice) => onVote(poll.id, choice)}
            />
          ))}
        </div>
        {filteredPolls.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No polls found matching your search.
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryRankPill({ category, rank, personName }: { category: string; rank: number; personName: string }) {
  const catStyle = getCategoryStyle(category);
  return (
    <TouchTooltip
      content={
        <div className="space-y-1.5 normal-case tracking-normal">
          <p className="font-semibold text-sm">{category} Rank</p>
          <p className="text-xs text-muted-foreground">
            {personName}'s position within the {category} category, ranked against others in the same field.
          </p>
        </div>
      }
      side="bottom"
      align="start"
      contentClassName="max-w-[240px]"
      showCloseButton
    >
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold cursor-help ${catStyle.bg} border ${catStyle.border} ${catStyle.text}`}
        data-testid="text-header-category-rank"
      >
        <Trophy className="h-3 w-3" />
        #{rank}
      </span>
    </TouchTooltip>
  );
}

export default function PersonDetailPage() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const [, params] = useRoute("/person/:id");
  const [location, setLocation] = useLocation();
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const { isFavorite } = useFavorites();
  const validTabs = ["overview", "vote", "predict"];
  const initialTab = (() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get("tab");
    return tabParam && validTabs.includes(tabParam) ? tabParam : "overview";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showAllPollsOverlay, setShowAllPollsOverlay] = useState(false);
  const [curateCompleted, setCurateCompleted] = useState(false);
  const [expandedProfileImage, setExpandedProfileImage] = useState<string | null>(null);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "overview") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.replaceState({}, "", url.toString());
    // Scroll so the tab bar is at the top of the view (just below the sticky main header)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const tabsEl = document.getElementById("profile-tabs-section");
        const header = document.querySelector("header");
        if (tabsEl && header) {
          const headerHeight = header.getBoundingClientRect().height;
          const top = tabsEl.getBoundingClientRect().top + window.scrollY - headerHeight;
          window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        } else if (tabsEl) {
          tabsEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  };

  const { data: person, isLoading, error } = useQuery<
    TrendingPerson & { wikiSlug?: string | null; imageSlug?: string | null; categoryRank?: number }
  >({
    queryKey: [`/api/trending/${params?.id}`],
    enabled: !!params?.id,
  });

  const { data: leaderboardForThresholds } = useQuery<{
    data: (TrendingPerson & { rankChange?: number | null })[];
    thresholds?: { rankChangeP90: number; deltaP90: number; negRankChangeP10: number; negDeltaP10: number };
  }>({
    queryKey: ['/api/leaderboard', 'thresholds-full'],
    queryFn: async () => {
      const response = await fetch(`/api/leaderboard?limit=100&offset=0&tab=fame&sortDir=desc`);
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { isHotMover, exceptionalIndicator } = useMemo(() => {
    if (!person || !leaderboardForThresholds?.thresholds) {
      return { isHotMover: false, exceptionalIndicator: null };
    }
    const thresholds = leaderboardForThresholds.thresholds;
    const match = leaderboardForThresholds.data?.find(p => p.id === person.id);
    if (!match) return { isHotMover: false, exceptionalIndicator: null };
    const indicator = getExceptionalIndicator(match as any, thresholds);
    return { isHotMover: indicator?.triggersHotMover === true, exceptionalIndicator: indicator };
  }, [person, leaderboardForThresholds]);

  const isVoteTab = activeTab === "vote";

  const { data: valueMetrics } = useQuery<ValueVoteMetrics>({
    queryKey: ['/api/celebrity', person?.id, 'value-vote'],
    enabled: isVoteTab && !!person,
  });

  // Shared voting data (matchups, sentiment polls, opinion polls) for the Vote tab
  const { data: matchups = [], isLoading: matchupsLoading } = useQuery<MatchupData[]>({
    queryKey: ['/api/matchups'],
    staleTime: 60 * 1000,
    enabled: isVoteTab,
  });

  const { data: matchupUserVotesFromServer = {} } = useQuery<Record<string, string>>({
    queryKey: ['/api/matchups/user-votes'],
    staleTime: 60 * 1000,
    enabled: isVoteTab,
  });

  const [localMatchupVotes, setLocalMatchupVotes] = useState<Record<string, string>>({});

  const mergedMatchupVotes = useMemo(
    () => ({ ...matchupUserVotesFromServer, ...localMatchupVotes }),
    [matchupUserVotesFromServer, localMatchupVotes]
  );

  const matchupUserVotes = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(mergedMatchupVotes).filter(([_, v]) => v !== "__removed__")
      ),
    [mergedMatchupVotes]
  );

  const matchupVoteMutation = useMutation({
    mutationFn: async ({ matchupId, option }: { matchupId: string; option: 'option_a' | 'option_b'; previousVote?: string | null }) => {
      const response = await apiRequest("POST", `/api/matchups/${matchupId}/vote`, { option });
      return response.json();
    },
    onMutate: ({ matchupId, option }) => {
      setLocalMatchupVotes((prev) => ({ ...prev, [matchupId]: option }));
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/matchups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/matchups/user-votes'] });
      const isChange = !!variables.previousVote;
      toast({
        title: isChange ? "Vote changed!" : "Vote recorded!",
        description: isChange ? "Your matchup vote has been updated." : "Your matchup vote has been counted.",
      });
    },
    onError: (error: any, variables) => {
      setLocalMatchupVotes((prev) => {
        const next = { ...prev };
        if (variables.previousVote) {
          next[variables.matchupId] = variables.previousVote as string;
        } else {
          delete next[variables.matchupId];
        }
        return next;
      });
      if (isUnauthorizedApiError(error)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to submit vote",
          variant: "destructive",
        });
      }
    },
  });

  const matchupRemoveVoteMutation = useMutation({
    mutationFn: async ({ matchupId }: { matchupId: string; previousVote: string }) => {
      const response = await apiRequest("POST", `/api/matchups/${matchupId}/vote`, { remove: true });
      return response.json();
    },
    onMutate: ({ matchupId }) => {
      setLocalMatchupVotes((prev) => ({ ...prev, [matchupId]: "__removed__" }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/matchups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/matchups/user-votes'] });
      toast({
        title: "Vote removed",
        description: "Your matchup vote has been removed.",
      });
    },
    onError: (error: any, variables) => {
      setLocalMatchupVotes((prev) => {
        const next = { ...prev };
        if (variables.previousVote) {
          next[variables.matchupId] = variables.previousVote as string;
        } else {
          delete next[variables.matchupId];
        }
        return next;
      });
      if (isUnauthorizedApiError(error)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to update vote",
          variant: "destructive",
        });
      }
    },
  });

  const handleMatchupVote = (matchupId: string, option: 'option_a' | 'option_b') => {
    const previousVote = matchupUserVotes[matchupId] || null;
    matchupVoteMutation.mutate({ matchupId, option, previousVote });
  };

  const handleMatchupRemoveVote = (matchupId: string) => {
    const previousVote = matchupUserVotes[matchupId];
    if (!previousVote) return;
    matchupRemoveVoteMutation.mutate({ matchupId, previousVote });
  };

  const { data: trendingPolls = [], isLoading: sentimentPollsLoading } = useQuery<TrendingPoll[]>({
    queryKey: ['/api/trending-polls'],
    staleTime: 60 * 1000,
    enabled: isVoteTab,
  });

  const { data: opinionPolls = [], isLoading: opinionPollsLoading } = useQuery<OpinionPoll[]>({
    queryKey: ['/api/opinion-polls'],
    staleTime: 60 * 1000,
    enabled: isVoteTab,
  });

  const valueVotePerson: ValueVotePerson | null = useMemo(() => {
    if (!person) return null;

    const metrics = valueMetrics;

    return {
      id: String(person.id),
      name: person.name,
      avatar: person.avatar ?? null,
      category: person.category ?? null,
      fameIndex: (person as any).fameIndex ?? Math.round(person.trendScore / 100),
      trendScore: person.trendScore,
      approvalPct: (person as any).approvalPct ?? null,
      approvalAvgRating: (person as any).approvalAvgRating ?? null,
      underratedPct: metrics?.underratedPct ?? null,
      overratedPct: metrics?.overratedPct ?? null,
      fairlyRatedPct: metrics?.fairlyRatedPct ?? null,
      underratedCount: metrics?.underratedVotesCount ?? null,
      overratedCount: metrics?.overratedVotesCount ?? null,
      fairlyRatedCount: metrics?.fairlyRatedVotesCount ?? null,
      userValueVote: metrics?.userVote ?? null,
    };
  }, [person, valueMetrics]);

  const personMatchups = useMemo(() => {
    if (!person) return [] as MatchupData[];
    const personId = person.id;
    const nameLower = person.name.toLowerCase();
    return matchups.filter((m) => {
      const aName = (m.optionAText || "").toLowerCase();
      const bName = (m.optionBText || "").toLowerCase();
      return (
        m.personAId === personId ||
        m.personBId === personId ||
        aName.includes(nameLower) ||
        bName.includes(nameLower) ||
        (m.relatedPersonIds || []).includes(personId)
      );
    });
  }, [matchups, person]);

  const personTrendingPolls = useMemo(() => {
    if (!person) return [] as TrendingPoll[];
    return (trendingPolls || []).filter((p) =>
      p.personId === person.id ||
      (p.relatedPersonIds || []).includes(person.id)
    );
  }, [trendingPolls, person]);

  const personOpinionPolls = useMemo(() => {
    if (!person) return [] as OpinionPoll[];
    return (opinionPolls || []).filter((poll) =>
      (poll.options || []).some((opt) => opt.personId === person.id) ||
      (poll.relatedPersonIds || []).includes(person.id)
    );
  }, [opinionPolls, person]);

  const featuredPollsForPerson: FeaturedPoll[] = useMemo(() => {
    return personTrendingPolls.map((p) => ({
      id: p.id,
      headline: p.headline,
      description: p.description || p.subjectText || "",
      approvePercent: p.approvePercent,
      neutralPercent: p.neutralPercent,
      disapprovePercent: p.disapprovePercent,
      totalVotes: p.totalVotes,
    }));
  }, [personTrendingPolls]);

  const isFavorited = person ? isFavorite(person.id) : false;

  // Scroll to voting widget when navigated from modal with hash
  useEffect(() => {
    if (!person || isLoading) return;

    const hash = window.location.hash;
    if (hash === '#voting-widget') {
      // Wait a bit for the DOM to fully render
      const scrollTimeout = setTimeout(() => {
        const element = document.getElementById('voting-widget');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);

      return () => clearTimeout(scrollTimeout);
    }
  }, [person, isLoading]);

  const handleToggleFavorite = async () => {
    if (!user || !session?.access_token) {
      toast({
        title: "Sign in required",
        description: "Please sign in to add favorites",
        variant: "destructive",
      });
      setLocation("/login");
      return;
    }

    if (!person) return;

    setFavoriteLoading(true);
    try {
      const method = isFavorited ? "DELETE" : "POST";
      const res = await fetch(`/api/me/favorites/${person.id}`, {
        method,
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        ...(method === "POST" ? {
          body: JSON.stringify({
            personName: person.name,
            personAvatar: person.avatar,
            personCategory: person.category,
          }),
        } : {}),
      });

      if (!res.ok) throw new Error(`Failed: ${res.status}`);

      await queryClient.invalidateQueries({ queryKey: ["/api/me/favorites"] });

      toast({
        title: isFavorited ? "Removed from favorites" : "Added to favorites",
        description: isFavorited
          ? `${person.name} has been removed from your favorites`
          : `${person.name} has been added to your favorites`,
      });
    } catch (error) {
      console.error('Error toggling favorite:', error);
      toast({
        title: "Error",
        description: "Failed to update favorite status",
        variant: "destructive",
      });
    } finally {
      setFavoriteLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading person data...</p>
        </div>
      </div>
    );
  }

  if (error || (!person && !isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Person not found</p>
          <Button className="mt-4" onClick={() => setLocation("/")}>
            Back to Leaderboard
          </Button>
        </div>
      </div>
    );
  }

  if (!person) {
    return null;
  }

  const handlePredictClick = () => {
    handleTabChange("predict");
    const tabsElement = document.getElementById("profile-tabs-section");
    if (tabsElement) {
      tabsElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  setLocation("/");
                }
              }}
              aria-label="Go back"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLocation("/")}
              data-testid="link-logo-home"
            >
              <VoxDexLogo size={32} />
              <span className="font-serif font-bold text-xl">VoxDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/#leaderboard")} data-testid="nav-leaderboard-desktop">
                Leaderboard
              </Button>
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/vote")} data-testid="nav-vote-desktop">
                Vote
              </Button>
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 pt-4 md:pt-12 pb-12 max-w-6xl">
        {/* 1. Header: Name + Category */}
        <div className="mb-8">
          <div className="flex gap-6">
            <PersonAvatar
              name={person.name}
              avatar={person.avatar}
              imageSlug={person.imageSlug}
              imageContext="expanded"
              size="xl"
              onExpand={(url) => setExpandedProfileImage(url)}
            />
            <div className="flex-1 flex flex-col justify-between min-h-[5rem]">
              <div>
                <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2" data-testid="text-person-name">
                  {person.name}
                </h1>
                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                  {person.category && (
                    <p className="text-lg text-muted-foreground">{person.category}</p>
                  )}
                  {person.category && person.categoryRank != null && person.categoryRank > 0 && (
                    <CategoryRankPill
                      category={person.category}
                      rank={person.categoryRank}
                      personName={person.name}
                    />
                  )}
                </div>
              </div>
              <div className="flex flex-row flex-wrap items-center gap-2">
                <div className="flex flex-row gap-2">
                  <TouchTooltip
                    content={
                      <div className="space-y-1.5 normal-case tracking-normal">
                        <p className="font-semibold text-sm">Overall Rank</p>
                        <p className="text-xs text-muted-foreground">
                          {person.name}'s position across all categories on the VoxDex leaderboard, based on their aggregated Trend Score.
                        </p>
                      </div>
                    }
                    side="bottom"
                    align="start"
                    contentClassName="max-w-[240px]"
                    showCloseButton
                  >
                    <div
                      className="inline-flex items-center gap-1.5 px-2 sm:px-3 min-h-9 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-xs sm:text-sm font-semibold cursor-help"
                      data-testid="text-header-rank"
                    >
                      <Trophy className="h-3.5 w-3.5" />
                      <span><span className="hidden sm:inline">Overall </span>{person.rank ? `#${person.rank}` : 'New'}</span>
                    </div>
                  </TouchTooltip>
                </div>
                <div className="flex flex-row gap-2">
                  <Button variant="outline" size="icon" className="sm:hidden" onClick={() => sharePage(`${person.name} on VoxDex`)} aria-label="Share" data-testid="button-share-mobile">
                    <Share2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={`sm:hidden ${isFavorited ? "bg-blue-500/15 border-blue-400/50 text-blue-400" : ""}`}
                    onClick={handleToggleFavorite}
                    disabled={favoriteLoading}
                    aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
                    data-testid="button-favorite-mobile"
                  >
                    <Star className={`h-4 w-4 ${isFavorited ? "fill-current" : ""}`} />
                  </Button>
                  <Button variant="outline" className="hidden sm:inline-flex gap-2" onClick={() => sharePage(`${person.name} on VoxDex`)} data-testid="button-share">
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                  <Button
                    variant="outline"
                    className={`hidden sm:inline-flex gap-2 ${isFavorited ? "bg-blue-500/15 border-blue-400/50 text-blue-400" : ""}`}
                    onClick={handleToggleFavorite}
                    disabled={favoriteLoading}
                    data-testid="button-favorite"
                  >
                    <Star className={`h-4 w-4 ${isFavorited ? "fill-current" : ""}`} />
                    {isFavorited ? "Favorited" : "Favorite"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="text-center p-4">
            <div className="flex items-center justify-center gap-1 mb-1">
              <p className="text-sm text-muted-foreground uppercase tracking-wide">
                Trend Score
              </p>
              <TrendScoreInfoIcon testId="icon-trend-score-profile" className="h-3 w-3 text-muted-foreground/40 cursor-help" />
            </div>
            <p className="text-3xl font-mono font-bold" data-testid="text-trend-score">
              {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString('en-US')}
            </p>
          </Card>
          <Card className="text-center p-4">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              24h Change
            </p>
            <div className="flex justify-center mt-2">
              <TrendBadge value={person.change24h} />
            </div>
          </Card>
          <Card className="text-center p-4">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              7d Change
            </p>
            <div className="flex justify-center mt-2">
              <TrendBadge value={person.change7d} />
            </div>
          </Card>
          <Card className="text-center p-4">
            <div className="flex items-center justify-center gap-1 mb-1">
              <p className="text-sm text-muted-foreground uppercase tracking-wide">
                Approval
              </p>
              <ApprovalRatingInfoIcon testId="icon-approval-profile" className="h-3 w-3 text-muted-foreground/40 cursor-help" onRateNow={() => {
                handleTabChange("vote");
                setTimeout(() => {
                  document.getElementById("voting-widget")?.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 150);
              }} />
            </div>
            {(person as any).approvalAvgRating != null ? (
              <p className="text-3xl font-mono font-bold" data-testid="text-approval-pct">
                <span style={{ color: getApprovalColor((person as any).approvalAvgRating) }}>{((person as any).approvalAvgRating as number).toFixed(1)}</span><span className="text-muted-foreground">/5</span>
              </p>
            ) : (
              <p className="text-xl font-mono text-muted-foreground mt-1" data-testid="text-approval-pct">
                --
              </p>
            )}
          </Card>
        </div>

        {/* Profile Tabs Section — sticky full-width bar; scroll to top when switching tabs */}
        <div
          id="profile-tabs-section"
          className="sticky top-14 z-10 bg-background border-b border-border/50 shadow-sm -mx-4 px-4 py-2"
        >
          <ProfileTabs activeTab={activeTab} onTabChange={handleTabChange} noBottomMargin />
        </div>

        <div className="mt-4">
        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <>
            <Suspense fallback={<ProfileLazyFallback />}>
              <LazyInlineCelebrityBio personId={person.id} personName={person.name} />
            </Suspense>

            {((person.rank && person.rank <= 10) || isHotMover) && (
              <div className="mb-8">
                <WhyTrendingCard personId={person.id} personName={person.name} hotMover={isHotMover && !(person.rank && person.rank <= 10)} />
              </div>
            )}

            {/* 5. Trend History Chart */}
            <Suspense fallback={<ProfileLazyFallback minHeight="280px" />}>
              <LazyTrendChart personId={person.id} personName={person.name} />
            </Suspense>

          </>
        )}

        {/* VOTE TAB */}
        {activeTab === "vote" && (
          <>
            {/* Overall Rating / Sentiment Voting */}
            <section id="voting-widget" className="mb-10">
              <UnifiedSectionHeader
                title="Overall Rating"
                subtitle={`How do you feel about ${person.name}?`}
                icon={<ThumbsUp className="h-5 w-5 text-cyan-400" />}
                accent="cyan"
                testId="profile-section-overall-rating"
              />

              <Suspense fallback={<ProfileLazyFallback minHeight="200px" />}>
                <LazyAnimatedSentimentVotingWidget
                  personId={person.id}
                  personName={person.name}
                  isProfilePage={true}
                />
              </Suspense>
            </section>

            {/* Matchups Section */}
            <section className="mb-10">
              <UnifiedSectionHeader
                title="Matchups"
                subtitle="Vote on A vs B"
                icon={<Swords className="h-5 w-5 text-cyan-400" />}
                accent="cyan"
                testId="profile-section-matchups"
              />

              {matchupsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="bg-slate-800/30 animate-pulse" style={{ minHeight: "380px" }} />
                  ))}
                </div>
              ) : personMatchups.length > 0 ? (
                <CardSection desktopLimit={6} gap="gap-5" testIdPrefix="profile-matchups">
                  {personMatchups.map((matchup) => (
                    <ProfileMatchupCard
                      key={matchup.id}
                      matchup={matchup}
                      userVote={matchupUserVotes[matchup.id] || null}
                      onVote={handleMatchupVote}
                      onRemoveVote={handleMatchupRemoveVote}
                    />
                  ))}
                </CardSection>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No matchups featuring {person.name} yet. Check back soon.
                </div>
              )}
            </section>

            {/* Sentiment Polls Section */}
            <section className="mb-10">
              <UnifiedSectionHeader
                title="Sentiment Polls"
                subtitle="Weigh in on current events"
                icon={<MessageSquare className="h-5 w-5 text-cyan-400" />}
                accent="cyan"
                testId="profile-section-sentiment"
                actions={
                  featuredPollsForPerson.length > 3 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllPollsOverlay(true)}
                      className="text-cyan-400 hover:text-cyan-300"
                      data-testid="button-view-all-polls"
                    >
                      View all
                    </Button>
                  ) : undefined
                }
              />

              {sentimentPollsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-8 w-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : featuredPollsForPerson.length > 0 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {featuredPollsForPerson.slice(0, 3).map((poll) => (
                      <FeaturedPollCard
                        key={poll.id}
                        poll={poll}
                        onVote={(choice) => {
                          toast({
                            title: "Vote Recorded",
                            description: `You voted "${choice}" on "${poll.headline}"`,
                          });
                        }}
                      />
                    ))}
                  </div>

                  <ViewAllPollsOverlay
                    open={showAllPollsOverlay}
                    onClose={() => setShowAllPollsOverlay(false)}
                    title={`All Sentiment Polls about ${person.name}`}
                    polls={featuredPollsForPerson}
                    onVote={(_pollId, _choice) => {
                      toast({
                        title: "Vote Recorded",
                        description: "Your vote has been recorded.",
                      });
                    }}
                  />
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No sentiment polls about {person.name} yet.
                </div>
              )}
            </section>

            {/* Opinion Polls Section */}
            <section className="mb-10">
              <UnifiedSectionHeader
                title="Opinion Polls"
                subtitle="Choose who leads the pack"
                icon={<ListChecks className="h-5 w-5 text-cyan-400" />}
                accent="cyan"
                testId="profile-section-opinion"
              />

              {opinionPollsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-8 w-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : personOpinionPolls.length > 0 ? (
                <CardSection desktopLimit={6} gap="gap-5" testIdPrefix="profile-opinion-polls">
                  {personOpinionPolls.map((poll) => (
                    <OpinionPollCardProfile
                      key={poll.id}
                      poll={poll}
                      onVote={async (pollSlug, optionId) => {
                        await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { optionId });
                        queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls"] });
                      }}
                    />
                  ))}
                </CardSection>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No opinion polls including {person.name} yet.
                </div>
              )}
            </section>

            {/* Underrated / Overrated Section */}
            <section className="mb-10">
              <UnifiedSectionHeader
                title="Underrated / Overrated"
                subtitle="Overhyped or underappreciated?"
                icon={<BarChart3 className="h-5 w-5 text-cyan-400" />}
                accent="cyan"
                testId="profile-section-value"
              />

              {valueVotePerson && (
                <div className="max-w-xl mx-auto">
                  <UnderratedOverratedCard person={valueVotePerson} />
                </div>
              )}
            </section>

            {/* Curate the Profile Section */}
            <section className="mb-10">
              <UnifiedSectionHeader
                title="Curate the Profile"
                subtitle="Help select their profile photo"
                icon={<Camera className="h-5 w-5 text-cyan-400" />}
                accent="cyan"
                testId="profile-section-curate"
                actions={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Help" data-testid="button-curate-info">
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Vote on which image best represents this celebrity. The winning look becomes their primary profile image.</p>
                    </TooltipContent>
                  </Tooltip>
                }
              />

              {!curateCompleted ? (
                <div className="max-w-md mx-auto">
                  <CurateProfileCard
                    person={{
                      id: String(person.id),
                      name: person.name,
                      category: person.category,
                      imageUrl: person.avatar ?? null,
                    } as CuratePerson}
                    onVote={() => {}}
                    onComplete={() => setCurateCompleted(true)}
                    onViewResults={() => {}}
                    showVisitProfileCta={false}
                    cycleNumber={0}
                  />
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <Check className="h-8 w-8 text-green-500" />
                  </div>
                  <p className="text-lg font-semibold mb-2">Thanks for voting!</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your vote helps determine their official profile image.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setCurateCompleted(false)}
                    className="border-cyan-500/50 text-cyan-400"
                    data-testid="button-curate-vote-again"
                  >
                    Vote on Another Look
                  </Button>
                </div>
              )}
            </section>

            {/* Community Insights */}
            <div className="mb-8">
              <Suspense fallback={<ProfileLazyFallback />}>
                <LazyCommunityInsights personId={person.id} personName={person.name} />
              </Suspense>
            </div>
          </>
        )}

        {/* PREDICT TAB */}
        {activeTab === "predict" && (
          <Suspense fallback={<ProfileLazyFallback minHeight="320px" />}>
            <LazyPredictTab
              personId={person.id}
              personName={person.name}
              personAvatar={person.avatar || ""}
              currentScore={person.fameIndex ?? Math.round(person.trendScore / 100)}
            />
          </Suspense>
        )}
        </div>
      </div>

      {expandedProfileImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedProfileImage(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setExpandedProfileImage(null)}
            aria-label="Close"
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={expandedProfileImage}
            alt={person.name}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
