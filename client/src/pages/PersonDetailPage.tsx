import { Fragment, useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { handleImageError } from "@/lib/imageResolver";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TrendBadge } from "@/components/TrendBadge";
import { StatCard } from "@/components/StatCard";
import { UserMenu } from "@/components/UserMenu";
import { useXpBurst } from "@/components/XpBurstProvider";
import { ProfileTabs } from "@/components/ProfileTabs";
import { getCategoryStyle } from "@/components/CategoryPill";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
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
  ChevronDown,
  BarChart3,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { normalizeMarketCategory } from "@shared/constants";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { useFavorites } from "@/hooks/useFavorites";
import { formatNumber, getApprovalColor } from "@/lib/formatNumber";
import { WhyTrendingCard } from "@/components/WhyTrendingCard";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { profileSectionGridClass } from "@/lib/profileSectionGridClass";
import { isUnauthorizedApiError, signInToVoteToastOptions } from "@/lib/signInToVoteToast";
import { ViewAllOverlayHeader } from "@/components/ViewAllOverlayHeader";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { VersusCard, type VersusCardMatchup } from "@/components/matchups/VersusCard";
import { OpinionPollCard } from "@/components/opinion-polls/OpinionPollCard";

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
const LazyMomentumSignals = lazy(() =>
  import("@/components/MomentumSignals").then((m) => ({ default: m.MomentumSignals }))
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
  category: string;
  subjectText?: string | null;
  description?: string | null;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  totalVotes: number;
  personId?: string | null;
  personName?: string | null;
  personAvatar?: string | null;
  imageUrl?: string | null;
  slug?: string | null;
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

type MatchupData = VersusCardMatchup & {
  personAId?: string | null;
  personBId?: string | null;
  relatedPersonIds?: string[];
};

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
  orderIndex?: number;
}

interface OpinionPoll {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  slug: string;
  imageUrl?: string | null;
  options: OpinionPollOption[];
  totalVotes: number;
  userVote?: string | null;
  relatedPersonIds?: string[];
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
        
        <p className="text-center text-lg font-serif font-bold text-cyan-600 dark:text-cyan-400 mb-4">Which look defines them?</p>
        
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handlePick('a')}
            disabled={!!selectedChoice}
            className={`relative aspect-square rounded-lg overflow-hidden border-3 transition-all duration-300 group cursor-pointer ${
              selectedChoice === 'a' 
                ? 'border-green-500 ring-4 ring-green-500/30 scale-105' 
                : selectedChoice === 'b'
                ? 'border-muted opacity-40 scale-95'
                : 'border-transparent hover:border-cyan-500/60 dark:border-cyan-500/50 hover:scale-102'
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
                className="absolute inset-0 bg-green-500/25 dark:bg-green-500/20 flex items-center justify-center"
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
                : 'border-transparent hover:border-cyan-500/60 dark:border-cyan-500/50 hover:scale-102'
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
                className="absolute inset-0 bg-green-500/25 dark:bg-green-500/20 flex items-center justify-center"
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
  onVote,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: {
  poll: FeaturedPoll;
  onVote: (choice: "support" | "neutral" | "oppose") => void;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const [voted, setVoted] = useState<"support" | "neutral" | "oppose" | null>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const imgSources = [poll.personAvatar, poll.imageUrl].filter(Boolean) as string[];
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    setImgIdx(0);
  }, [poll.id, poll.imageUrl, poll.personAvatar]);

  const currentImgSrc = imgSources[imgIdx] ?? null;

  const handleImgError = () => {
    if (imgIdx + 1 < imgSources.length) {
      setImgIdx(imgIdx + 1);
    } else {
      setImgIdx(imgSources.length);
    }
  };

  const handleVote = (choice: "support" | "neutral" | "oppose") => {
    if (!voted) {
      setVoted(choice);
      onVote(choice);
    }
  };

  const handleChangeVote = () => {
    setVoted(null);
  };

  const pollDetailHref = poll.slug ? `/polls/${poll.slug}` : undefined;
  const raceMarketId = categoryRaceMap.get(normalizeMarketCategory(poll.category)) ?? undefined;

  const bodyCopy = (
    <>
      {poll.subjectText && (
        poll.slug ? (
          <Link href={`/polls/${poll.slug}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
              {poll.subjectText}
            </p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{poll.subjectText}</p>
        )
      )}
      {!poll.subjectText && poll.description && (
        poll.slug ? (
          <Link href={`/polls/${poll.slug}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
              {poll.description}
            </p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{poll.description}</p>
        )
      )}
    </>
  );

  return (
    <div className="relative group h-full">
      <div className="absolute -inset-[1px] rounded-xl border border-[#EFEFEF]/50 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 hidden md:block" />
      <Card
        className="relative pt-6 px-5 pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full min-h-[390px] md:min-h-[300px] flex flex-col border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl"
        data-testid={`card-featured-poll-${poll.id}`}
      >
        <div className="absolute top-3 right-3">
          <InteractiveCategoryPill
            category={poll.category}
            onFilter={() => onFilterCategory(poll.category)}
            raceMarketId={raceMarketId}
            leaderboardCategories={leaderboardCategories}
            detailHref={pollDetailHref}
            detailLabel="View Poll Details"
            data-testid={`badge-category-${poll.id}`}
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
          <span>{poll.totalVotes.toLocaleString("en-US")} votes</span>
        </div>
        <AvatarHeightHeadline
          className="mb-3"
          text={poll.headline}
          serif={false}
          href={pollDetailHref}
          linkTestId={poll.slug ? `link-poll-detail-${poll.id}` : undefined}
          avatar={
            currentImgSrc ? (
              <div
                className="h-16 w-16 rounded-md overflow-hidden shrink-0 bg-muted dark:bg-slate-800 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedImage(currentImgSrc);
                }}
              >
                <img
                  src={currentImgSrc}
                  alt={poll.personName || poll.headline}
                  className="w-full h-full object-cover"
                  onError={handleImgError}
                />
              </div>
            ) : (
              <div className="h-16 w-16 rounded-md bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0">
                <MessageSquare className="h-5 w-5 text-slate-400" />
              </div>
            )
          }
        />
        {bodyCopy}

        {!voted ? (
          <div className="flex flex-col gap-3 mt-auto">
            <button
              type="button"
              onClick={() => handleVote("support")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
              data-testid={`button-poll-support-${poll.id}`}
            >
              <ThumbsUp className="h-4 w-4 shrink-0" />
              <span>Support</span>
            </button>
            <button
              type="button"
              onClick={() => handleVote("neutral")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-muted/40 border border-border text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white text-sm font-medium transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60 dark:hover:border-white/80 dark:hover:bg-white/15"
              data-testid={`button-poll-neutral-${poll.id}`}
            >
              <Minus className="h-4 w-4 shrink-0" />
              <span>Neutral</span>
            </button>
            <button
              type="button"
              onClick={() => handleVote("oppose")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
              data-testid={`button-poll-oppose-${poll.id}`}
            >
              <ThumbsDown className="h-4 w-4 shrink-0" />
              <span>Oppose</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mt-auto">
            <div className="flex items-center gap-3">
              <ThumbsUp className="h-4 w-4 text-[#00C853] shrink-0" />
              <span className="text-sm text-[#00C853] w-16 shrink-0">Support</span>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                  style={{ width: `${poll.approvePercent}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-10 text-right">{poll.approvePercent}%</span>
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
              <span className="text-sm text-muted-foreground w-10 text-right">{poll.neutralPercent}%</span>
            </div>

            <div className="flex items-center gap-3">
              <ThumbsDown className="h-4 w-4 text-[#FF0000] shrink-0" />
              <span className="text-sm text-[#FF0000] w-16 shrink-0">Oppose</span>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                  style={{ width: `${poll.disapprovePercent}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-10 text-right">{poll.disapprovePercent}%</span>
            </div>

            <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/10">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                <span>{poll.totalVotes.toLocaleString("en-US")} total votes</span>
              </div>
              <div
                className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                  voted === "support"
                    ? "bg-[#00C853]/10 border-[#00C853]/40 text-[#00C853]"
                    : voted === "oppose"
                      ? "bg-[#FF0000]/10 border-[#FF0000]/40 text-[#FF0000]"
                      : "bg-slate-500/10 border-slate-500/40 text-slate-500 dark:text-slate-400"
                }`}
                data-testid={`badge-voted-poll-${poll.id}`}
              >
                You voted
              </div>
            </div>

            <button
              type="button"
              onClick={handleChangeVote}
              className="text-xs text-slate-400 hover:text-white transition-colors underline-offset-4 hover:underline text-center"
              data-testid={`button-change-vote-${poll.id}`}
            >
              Change your vote
            </button>
          </div>
        )}
      </Card>
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setExpandedImage(null)}
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={expandedImage}
            alt={poll.personName || poll.headline}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function ViewAllPollsOverlay({
  open,
  onClose,
  title,
  polls,
  onVote,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  polls: FeaturedPoll[];
  onVote: (pollId: string, choice: "support" | "neutral" | "oppose") => void;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const q = searchQuery.toLowerCase();
  const filteredPolls = polls.filter(
    (p) =>
      !searchQuery ||
      p.headline.toLowerCase().includes(q) ||
      (p.subjectText || "").toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q)
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
              onFilterCategory={onFilterCategory}
              categoryRaceMap={categoryRaceMap}
              leaderboardCategories={leaderboardCategories}
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
  const { trigger: triggerXpBurst } = useXpBurst();
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
  const categoryRaceMap = useCategoryRaceMap();
  const leaderboardCats = useLeaderboardCategories();
  const handleSentimentCategoryFilter = useCallback((_category: string) => {
    setLocation("/vote");
  }, [setLocation]);
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

  const { data: hotMoversData } = useQuery<{ data: Array<{ id: string }> }>({
    queryKey: ['/api/trending/hot-movers'],
    queryFn: async () => {
      const response = await fetch('/api/trending/hot-movers');
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const isHotMover = useMemo(() => {
    if (!person || !hotMoversData?.data) return false;
    return hotMoversData.data.some(m => m.id === person.id);
  }, [person, hotMoversData]);

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
    mutationFn: async ({ matchupId, option }: { matchupId: string; option: "option_a" | "option_b" | "neutral"; previousVote?: string | null }) => {
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

  const handleMatchupVote = (matchupId: string, option: "option_a" | "option_b" | "neutral") => {
    if (!user || !session?.access_token) {
      toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      return;
    }
    const previousVote = matchupUserVotes[matchupId] || null;
    matchupVoteMutation.mutate({ matchupId, option, previousVote });
  };

  const handleMatchupRemoveVote = (matchupId: string) => {
    if (!user || !session?.access_token) {
      toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      return;
    }
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
      category: p.category,
      subjectText: p.subjectText ?? null,
      description: p.description ?? null,
      approvePercent: p.approvePercent,
      neutralPercent: p.neutralPercent,
      disapprovePercent: p.disapprovePercent,
      totalVotes: p.totalVotes,
      personId: p.personId,
      personName: p.personName,
      personAvatar: p.personAvatar,
      imageUrl: p.imageUrl,
      slug: p.slug,
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
    <div className="min-h-screen pb-20 md:pb-0 overflow-x-clip">
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
      <div className="container mx-auto px-4 pt-4 md:pt-12 max-w-6xl">
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
                      className="inline-flex items-center gap-1.5 px-2 sm:px-3 min-h-9 rounded-md bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/30 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 font-mono text-xs sm:text-sm font-semibold cursor-help"
                      data-testid="text-header-rank"
                    >
                      <Trophy className="h-3.5 w-3.5" />
                      <span><span className="hidden sm:inline">Overall </span>{person.rank ? `#${person.rank}` : 'New'}</span>
                    </div>
                  </TouchTooltip>
                </div>
                <div className="flex flex-row gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className={`sm:hidden ${isFavorited ? "bg-blue-500/20 dark:bg-blue-500/15 border-blue-500/60 dark:border-blue-400/50 text-blue-600 dark:text-blue-400" : ""}`}
                    onClick={handleToggleFavorite}
                    disabled={favoriteLoading}
                    aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
                    data-testid="button-favorite-mobile"
                  >
                    <Star className={`h-4 w-4 ${isFavorited ? "fill-current" : ""}`} />
                  </Button>
                  <Button variant="outline" size="icon" className="sm:hidden" onClick={() => sharePage(`${person.name} on VoxDex`)} aria-label="Share" data-testid="button-share-mobile">
                    <Share2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className={`hidden sm:inline-flex gap-2 ${isFavorited ? "bg-blue-500/20 dark:bg-blue-500/15 border-blue-500/60 dark:border-blue-400/50 text-blue-600 dark:text-blue-400" : ""}`}
                    onClick={handleToggleFavorite}
                    disabled={favoriteLoading}
                    data-testid="button-favorite"
                  >
                    <Star className={`h-4 w-4 ${isFavorited ? "fill-current" : ""}`} />
                    {isFavorited ? "Favorited" : "Favorite"}
                  </Button>
                  <Button variant="outline" className="hidden sm:inline-flex gap-2" onClick={() => sharePage(`${person.name} on VoxDex`)} data-testid="button-share">
                    <Share2 className="h-4 w-4" />
                    Share
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
      </div>

      {/* Profile Tabs Section — sticky full-width bar (sibling of container column); scroll to top when switching tabs */}
      <div
        id="profile-tabs-section"
        className="sticky top-14 z-10 w-full bg-background border-b border-border/50 shadow-sm py-2"
      >
        <div className="container mx-auto max-w-6xl px-4">
          <ProfileTabs activeTab={activeTab} onTabChange={handleTabChange} noBottomMargin />
        </div>
      </div>

      <div className="container mx-auto px-4 pb-12 max-w-6xl">
        <div className="mt-4">
        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <>
            <Suspense fallback={<ProfileLazyFallback />}>
              <LazyInlineCelebrityBio personId={person.id} personName={person.name} />
            </Suspense>

            <div className="flex justify-end mb-2">
              <a
                href="#momentum-signals"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-jump-to-signals"
              >
                Jump to Signals
                <ChevronDown className="inline h-3 w-3 ml-0.5" />
              </a>
            </div>

            {((person.rank && person.rank <= 20) || isHotMover) && (
              <div className="mb-8">
                <WhyTrendingCard personId={person.id} personName={person.name} hotMover={isHotMover && !(person.rank && person.rank <= 20)} />
              </div>
            )}

            {/* 5. Trend History Chart */}
            <Suspense fallback={<ProfileLazyFallback minHeight="280px" />}>
              <LazyTrendChart personId={person.id} personName={person.name} />
            </Suspense>

            {/* 6. Momentum Signals + Official Profiles */}
            <Suspense fallback={<ProfileLazyFallback />}>
              <LazyMomentumSignals personId={person.id} wikiSlug={person.wikiSlug} />
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
                subtitle="Community approval rating"
                icon={<ThumbsUp className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
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
                icon={<Swords className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
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
                    <VersusCard
                      key={matchup.id}
                      matchup={matchup}
                      userVote={matchupUserVotes[matchup.id] || null}
                      onVote={handleMatchupVote}
                      onRemoveVote={handleMatchupRemoveVote}
                      onFilterCategory={handleSentimentCategoryFilter}
                      categoryRaceMap={categoryRaceMap}
                      leaderboardCategories={leaderboardCats}
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
                icon={<MessageSquare className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
                accent="cyan"
                testId="profile-section-sentiment"
                actions={
                  featuredPollsForPerson.length > 3 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllPollsOverlay(true)}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
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
                  {(() => {
                    const sentimentVisible = featuredPollsForPerson.slice(0, 3);
                    const sg = profileSectionGridClass(sentimentVisible.length);
                    return (
                      <div className={sg.container}>
                        {sentimentVisible.map((poll) => {
                          const card = (
                            <FeaturedPollCard
                              poll={poll}
                              onVote={(choice) => {
                                toast({
                                  title: "Vote Recorded",
                                  description: `You voted "${choice}" on "${poll.headline}"`,
                                });
                              }}
                              onFilterCategory={handleSentimentCategoryFilter}
                              categoryRaceMap={categoryRaceMap}
                              leaderboardCategories={leaderboardCats}
                            />
                          );
                          return sg.item ? (
                            <div key={poll.id} className={sg.item}>
                              {card}
                            </div>
                          ) : (
                            <Fragment key={poll.id}>{card}</Fragment>
                          );
                        })}
                      </div>
                    );
                  })()}

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
                    onFilterCategory={handleSentimentCategoryFilter}
                    categoryRaceMap={categoryRaceMap}
                    leaderboardCategories={leaderboardCats}
                  />
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No sentiment polls about {person.name} yet.
                </div>
              )}
            </section>

            {/* Matchups Section */}
            <section className="mb-10">
              <UnifiedSectionHeader
                title="Matchups"
                subtitle="Vote on A vs B"
                icon={<Swords className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
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
                <CardSection desktopLimit={6} gap="gap-5" testIdPrefix="profile-matchups" centerShortRows>
                  {personMatchups.map((matchup) => (
                    <VersusCard
                      key={matchup.id}
                      matchup={matchup}
                      userVote={matchupUserVotes[matchup.id] || null}
                      onVote={handleMatchupVote}
                      onRemoveVote={handleMatchupRemoveVote}
                      onFilterCategory={handleSentimentCategoryFilter}
                      categoryRaceMap={categoryRaceMap}
                      leaderboardCategories={leaderboardCats}
                    />
                  ))}
                </CardSection>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No matchups featuring {person.name} yet. Check back soon.
                </div>
              )}
            </section>

            {/* Opinion Polls Section */}
            <section className="mb-10">
              <UnifiedSectionHeader
                title="Opinion Polls"
                subtitle="Choose who leads the pack"
                icon={<ListChecks className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
                accent="cyan"
                testId="profile-section-opinion"
              />

              {opinionPollsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-8 w-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : personOpinionPolls.length > 0 ? (
                <CardSection desktopLimit={6} gap="gap-5" testIdPrefix="profile-opinion-polls" centerShortRows>
                  {personOpinionPolls.map((poll) => (
                    <OpinionPollCard
                      key={poll.id}
                      poll={poll}
                      onVote={async (pollSlug, optionId) => {
                        const res = await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { optionId });
                        const data = await res.json();
                        queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls"] });
                        if (data?.xp?.xpAwarded) {
                          triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
                        }
                      }}
                      onRemoveVote={async (pollSlug) => {
                        await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { remove: true });
                        queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls"] });
                      }}
                      onFilterCategory={handleSentimentCategoryFilter}
                      categoryRaceMap={categoryRaceMap}
                      leaderboardCategories={leaderboardCats}
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
                icon={<BarChart3 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
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
                icon={<Camera className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
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
                  <div className="h-16 w-16 rounded-full bg-green-500/15 dark:bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <Check className="h-8 w-8 text-green-700 dark:text-green-500" />
                  </div>
                  <p className="text-lg font-semibold mb-2">Thanks for voting!</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your vote helps determine their official profile image.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setCurateCompleted(false)}
                    className="border-cyan-500/60 dark:border-cyan-500/50 text-cyan-600 dark:text-cyan-400"
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
              personRank={person.rank ?? null}
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
