import { useState, useEffect, useRef, useMemo, useCallback, Children } from "react";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { handleImageError } from "@/lib/imageResolver";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardGridSkeleton } from "@/components/ui/card-skeletons";
import {
  consumeCategoryPillBrowseIntent,
  InteractiveCategoryPill,
  isCategoryPillDrawerDismissSuppressed,
} from "@/components/InteractiveCategoryPill";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { useXpBurst } from "@/components/XpBurstProvider";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useUserStats } from "@/hooks/useGamification";
import { useOpinionPollVoteMutation } from "@/hooks/useOpinionPollVoteMutation";
import { 
  ArrowLeft, 
  Plus, 
  Vote,
  Users,
  User,
  Clock,
  Sparkles,
  Camera,
  Crown,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
  Minus,
  Star,
  Check,
  X,
  ChevronRight,
  HelpCircle,
  Swords,
  UserPlus,
  ImageIcon,
  BarChart3,
  ListChecks,
  EyeOff,
  Upload,
  Cpu,
  Landmark,
  Briefcase,
  Music2,
  Trophy,
  Video,
  LayoutGrid,
  Flame,
  Clapperboard,
  Gamepad2,
  UtensilsCrossed,
  Heart,
  Laugh,
  Maximize2,
  type LucideIcon
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { toast } from "sonner";
import { CountdownDescription } from "@/components/CountdownDescription";
import { useLocation, Link } from "wouter";
import { Drawer } from "vaul";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import { motion, AnimatePresence } from "framer-motion";
import { getMarketCategoryLabel, normalizeMarketCategory, type FilterCategory, CATEGORIES_LEADERBOARD, CATEGORIES_OPEN, OPINION_POLL_MIN_OPTIONS, OPINION_POLL_MAX_OPTIONS } from "@shared/constants";
import { buildSectionCategoryOptions } from "@/lib/sectionCategoryFilters";
import { CurateSection } from "@/components/curate";
import { CurateProfileCard as CurateProfileCardComponent, type CuratePerson } from "@/components/curate/CurateProfileCard";
import { UnderratedOverratedCard } from "@/components/UnderratedOverratedCard";
import { CardSection } from "@/components/CardSection";
import { VersusCard, type VersusCardMatchup } from "@/components/matchups/VersusCard";
import { OpinionPollCard } from "@/components/opinion-polls/OpinionPollCard";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { FilterDropdown } from "@/components/FilterDropdown";
import { OverlayFilterBar } from "@/components/OverlayFilterBar";
import { ViewAllOverlayHeader } from "@/components/ViewAllOverlayHeader";
import { OnboardingDrawer, type OnboardingStep, type OnboardingDrawerHandle } from "@/components/OnboardingDrawer";
import { StepModal } from "@/components/StepModal";
import { VOTE_RULES_STEPS } from "@/components/rulesStepData";
import { useIsMobile } from "@/hooks/use-mobile";
import { UnifiedSectionHeader } from "@/components/UnifiedSectionHeader";
import { WindowedDotIndicator } from "@/components/WindowedDotIndicator";
import { ScrollMaskedChipRow } from "@/components/ScrollMaskedChipRow";
import { CategoryRowWithSearch } from "@/components/CategoryRowWithSearch";
import { VoteSnapScrollView, type SnapItem, type SnapSectionType } from "@/components/snap-scroll/VoteSnapScrollView";
import {
  navigateToLogin,
  AUTH_APPLY_VOTE_UI_ONCE_KEY,
  type VoteResumePayload,
} from "@/lib/authReturn";
import { useAnonBudget, applyBudgetFromVoteResponse } from "@/hooks/useAnonBudget";
import { checkVoteGate } from "@/lib/voteGate";
import { voteHubSectionFromHash } from "@/lib/voteHubDeepLinks";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { navigateWithVoteList } from "@/lib/voteListNavigation";
import { isBudgetExhaustedVoteError, parseVoteError } from "@/lib/voteErrors";
import {
  getSentimentPollChoiceColor,
  getSentimentPollChoiceLabel,
} from "@/lib/sentimentPollVoteDisplay";
import { getClientWeekDeadlines } from "@/hooks/useMarketCycle";
import { SuggestCategorySelect } from "@/components/suggest/SuggestCategorySelect";
import { SuggestDurationPicker } from "@/components/suggest/SuggestDurationPicker";
import { HybridSubjectCombobox } from "@/components/suggest/HybridSubjectCombobox";
import { OpinionOptionRow, type OpinionOptionInput } from "@/components/suggest/OpinionOptionRow";
import { ContenderSelector, type ContenderSelection } from "@/components/suggest/ContenderSelector";

function formatInductionCountdown(deadline: Date): string {
  const diffMs = Math.max(0, deadline.getTime() - Date.now());
  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  return `${days}d ${hours}h ${minutes}m`;
}

const VOTE_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    icon: Swords,
    heading: "Make Your Voice Heard",
    description: "Choose a side, back your opinion, and weigh in on real-world topics.",
    gradient: "from-cyan-500 to-teal-600",
    glow: "shadow-cyan-500/25",
  },
  {
    icon: BarChart3,
    heading: "Shape The Rankings",
    description: "Your vote feeds the index and helps shape the final rankings.",
    gradient: "from-emerald-500 to-green-600",
    glow: "shadow-emerald-500/25",
  },
  {
    icon: Trophy,
    heading: "Earn as You Vote",
    description: "Rack up XP with every vote, climb the ranks, and build your reputation on VoxDex.",
    gradient: "from-amber-500 to-orange-600",
    glow: "shadow-amber-500/25",
  },
] as const;

interface InductionCandidate {
  id: string;
  name: string;
  initials: string;
  imageSlug: string | null;
  category: "Tech" | "Music" | "Creator" | "Sports" | "Business" | "Politics" | "Film & TV" | "Gaming" | "Food & Drink" | "Lifestyle" | "Comedy";
  votes: number;
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
  currentUserDirection?: 'up' | 'down' | null;
}

type CurateImageVoteResponse = Partial<CelebrityImage> & {
  alreadyVoted?: boolean;
  swapped?: boolean;
};

function applyCurateVoteToImages(
  currentImages: CelebrityImage[] | undefined,
  imageId: string,
  voteData: CurateImageVoteResponse,
): CelebrityImage[] | undefined {
  if (!currentImages) return currentImages;

  const previousSelectedId = currentImages.find((img) => img.currentUserDirection === "up")?.id ?? null;

  return currentImages.map((img) => {
    if (img.id === imageId) {
      const defaultVotesUp = previousSelectedId === imageId ? img.votesUp : img.votesUp + (voteData.alreadyVoted ? 0 : 1);
      return {
        ...img,
        personId: voteData.personId ?? img.personId,
        imageUrl: voteData.imageUrl ?? img.imageUrl,
        source: voteData.source ?? img.source,
        isPrimary: typeof voteData.isPrimary === "boolean" ? voteData.isPrimary : img.isPrimary,
        addedAt: voteData.addedAt ?? img.addedAt,
        votesUp: typeof voteData.votesUp === "number" ? voteData.votesUp : defaultVotesUp,
        votesDown: typeof voteData.votesDown === "number" ? voteData.votesDown : img.votesDown,
        currentUserDirection: "up",
      };
    }

    if (img.id === previousSelectedId && previousSelectedId !== imageId) {
      return {
        ...img,
        votesUp: voteData.swapped ? Math.max(img.votesUp - 1, 0) : img.votesUp,
        currentUserDirection: null,
      };
    }

    return img.currentUserDirection === "up"
      ? { ...img, currentUserDirection: null }
      : img;
  });
}

interface CurateProfilePoll {
  id: string;
  personId: string;
  personName: string;
  category: string;
}

const curateProfilePolls: CurateProfilePoll[] = [
  { 
    id: "pp1", 
    personId: "852662d2-2b12-437f-ada7-1553bd5569b7",
    personName: "Taylor Swift", 
    category: "Music",
  },
  { 
    id: "pp2", 
    personId: "4fdd8495-87ba-4808-a0c8-0034f7240813",
    personName: "Elon Musk", 
    category: "Tech",
  },
  { 
    id: "pp3", 
    personId: "670e5278-f359-4558-abb8-ea0caa371395",
    personName: "BeyoncÃ©", 
    category: "Music",
  },
  { 
    id: "pp4", 
    personId: "ee953fcf-3f7f-4ed7-a94f-6338d49a952f",
    personName: "Mark Zuckerberg", 
    category: "Tech",
  },
  { 
    id: "pp5", 
    personId: "3a5bbf27-b9c2-4315-a4dc-7944d9878d0d",
    personName: "Bad Bunny", 
    category: "Music",
  },
  { 
    id: "pp6", 
    personId: "aad572b3-c66a-4cad-bfa0-78b41eb41dfd",
    personName: "Cristiano Ronaldo", 
    category: "Sports",
  },
  { 
    id: "pp7", 
    personId: "3417182d-d51a-4ff2-ae60-c35781ad9aff",
    personName: "Drake", 
    category: "Music",
  },
  { 
    id: "pp8", 
    personId: "0b9bd1d6-0f66-4665-8cec-05d87908e3a1",
    personName: "Kendrick Lamar", 
    category: "Music",
  },
];


const SECTION_TOGGLES = ["All", "Sentiment Polls", "Matchups", "Opinion Polls", "Underrated/Overrated", "Induction Queue", "Curate Profile"] as const;
type SectionToggle = typeof SECTION_TOGGLES[number];

const isGovernanceSection = (section: SectionToggle) => 
  section === "Induction Queue" || section === "Curate Profile";

const isPublicOpinionSection = (section: SectionToggle) =>
  section === "Sentiment Polls" || section === "Matchups" || section === "Opinion Polls" || section === "Underrated/Overrated";

const SECTION_RULES = {
  induction: {
    title: "Induction Queue Rules",
    content: "Voted candidates with the most support at the end of the cycle are officially inducted into the VoxDex Main Leaderboard. Your vote helps shape who defines the future of fame."
  },
  curate: {
    title: "Curate Profile Rules",
    content: "Which image best represents this celebrity? The winning look becomes the primary profile image across the entire platform. Only the highest quality looks make it to the index."
  },
  matchups: {
    title: "Matchups Rules",
    content: "Pick your side in head-to-head matchups! Vote for your favorite in classic A vs B showdowns. Each vote earns XP and contributes to the community consensus."
  },
  voice: {
    title: "Sentiment Polls Rules",
    content: "The ultimate community pulse check. Weigh in on current events and controversies. Evergreen polls remain open; timed polls resolve at the specified deadline."
  },
  value: {
    title: "How It Works",
    content: "This vote is about public perception â€” not your personal like/dislike. Vote Underrated if you think they deserve more recognition than they currently get. Vote Overrated if you think they receive more attention or praise than they deserve. Compare your view with the community results. Your vote updates the Underrated/Overrated split in real time."
  }
};

// Map UI duration picker values → wire values expected by suggestionSchemas timeline enum.
// UI uses "none"/"1week"/"1month" for compactness; the schema uses the full underscore form.
function toTimelineWireValue(uiValue: string): "no_deadline" | "1_week" | "1_month" | "custom" {
  switch (uiValue) {
    case "1week":  return "1_week";
    case "1month": return "1_month";
    case "custom": return "custom";
    default:       return "no_deadline"; // covers "none" and any unexpected value
  }
}

function getRankBadgeStyle(rank: number) {
  if (rank === 1) return "bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-300";
  if (rank === 2) return "bg-slate-400/10 border-slate-400/20 text-slate-600 dark:text-slate-300";
  if (rank === 3) return "bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-300";
  return "bg-slate-500/10 border-slate-500/20 text-slate-500 dark:text-slate-400";
}

function InductionCandidateCard({ 
  candidate,
  rank,
  maxVotes,
  isVoted,
  onToggleVote,
  onXPGain,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onBrowseFullScreen,
}: { 
  candidate: InductionCandidate;
  rank: number;
  maxVotes: number;
  isVoted: boolean;
  onToggleVote: (id: string) => void;
  onXPGain: (event: React.MouseEvent) => void;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onBrowseFullScreen?: () => void;
}) {
  const [showVoteAnimation, setShowVoteAnimation] = useState(false);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPercent = rank === 1 ? 100 : (candidate.votes / maxVotes) * 100;

  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const handleVoteClick = (e: React.MouseEvent) => {
    if (!isVoted) {
      setShowVoteAnimation(true);
      animationTimeoutRef.current = setTimeout(() => setShowVoteAnimation(false), 800);
      onXPGain(e);
    }
    onToggleVote(candidate.id);
  };

  return (
    <div className="relative group h-full">
      <div className="absolute -inset-[1px] rounded-xl border border-[#EFEFEF]/50 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 hidden md:block" />
    <Card 
      className="relative p-4 sm:p-5 transition-all duration-200 h-full min-h-[390px] md:min-h-[300px] flex flex-col overflow-hidden border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl"
      data-testid={`card-induction-${candidate.id}`}
    >
      <AnimatePresence>
        {showVoteAnimation && (
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
              className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent skew-x-12"
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="absolute top-3 right-3">
        <InteractiveCategoryPill
          category={candidate.category}
          onFilter={() => onFilterCategory(candidate.category)}
          leaderboardCategories={leaderboardCategories}
          detailHref="/vote/induction"
          detailLabel="View Induction Queue"
          onBrowseFullScreen={onBrowseFullScreen}
          data-testid={`badge-category-${candidate.id}`}
        />
      </div>
      
      <div className="flex items-center mb-4">
        <div className={`rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1 border ${getRankBadgeStyle(rank)}`}>
          {rank === 1 && <Crown className="h-3 w-3" />}
          #{rank}
        </div>
      </div>

      <div className="flex flex-col items-center text-center mb-2 md:mb-4">
        <div className="relative">
          <PersonAvatar name={candidate.name} imageSlug={candidate.imageSlug} imageContext="induction" className="h-40 w-40 md:h-32 md:w-32" />
          {isVoted && (
            <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="h-3 w-3 text-white" />
            </div>
          )}
        </div>
        <h3 className="font-semibold text-[16px] leading-[1.4] mt-2 md:mt-3">{candidate.name}</h3>
      </div>
      
      <div className="mt-auto mb-4">
        <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          <span className="text-slate-400">
            {isVoted ? `${candidate.votes.toLocaleString('en-US')} votes` : "Votes"}
          </span>
        </div>
      </div>
      
      {isVoted ? (
        <Button 
          onClick={handleVoteClick}
          className="w-full bg-emerald-500/15 dark:bg-emerald-500/10 border border-emerald-500/30 dark:border-emerald-500/20 text-emerald-500 dark:text-emerald-300 hover:bg-emerald-500/25 dark:hover:bg-emerald-500/20"
          data-testid={`button-induct-${candidate.id}`}
        >
          <Check className="h-4 w-4 mr-2" />
          Voted
        </Button>
      ) : (
        <button
          onClick={handleVoteClick}
          className="group w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-muted/40 border border-border text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white text-sm font-medium transition-all duration-300 hover:border-cyan-500/80 hover:bg-cyan-500/25 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/20 hover:text-cyan-600 dark:hover:text-cyan-400"
          data-testid={`button-induct-${candidate.id}`}
        >
          <Vote className="h-4 w-4 shrink-0" />
          <span>Vote to Induct</span>
        </button>
      )}
    </Card>
    </div>
  );
}

function CurateProfileCard({ 
  poll, 
  onVote,
  onComplete,
  onViewResults,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: { 
  poll: CurateProfilePoll; 
  onVote: () => void;
  onComplete: () => void;
  onViewResults: (poll: CurateProfilePoll) => void;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const [selectedChoice, setSelectedChoice] = useState<'a' | 'b' | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timeoutRef2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setLocation] = useLocation();
  const imageQueryKey = useMemo(() => ['/api/people', poll.personId, 'images'] as const, [poll.personId]);

  // Fetch celebrity images for this person
  const { data: images = [], isLoading } = useQuery<CelebrityImage[]>({
    queryKey: imageQueryKey,
  });

  // Pick two random images deterministically based on poll id
  const [imageA, imageB] = useMemo(() => {
    if (images.length < 2) return [null, null];
    // Use poll id as seed for consistent random selection
    const seed = poll.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const shuffled = [...images].sort((a, b) => {
      const hashA = (a.id.charCodeAt(0) + seed) % 100;
      const hashB = (b.id.charCodeAt(0) + seed) % 100;
      return hashA - hashB;
    });
    return [shuffled[0], shuffled[1]];
  }, [images, poll.id]);

  // Vote mutation
  const { trigger: triggerXpBurst } = useXpBurst();
  const voteMutation = useMutation({
    mutationFn: async ({ imageId }: { imageId: string }) => {
      const response = await apiRequest('POST', `/api/people/${poll.personId}/images/${imageId}/vote`, { direction: 'up' });
      return response.json();
    },
    onSuccess: (data) => {
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
    },
    onError: (error: Error) => {
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      } else {
        const parsed = parseVoteError(error);
        toast.error("Couldn't record vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef2.current) clearTimeout(timeoutRef2.current);
    };
  }, []);

  const handlePick = async (choice: 'a' | 'b') => {
    if (!selectedChoice && imageA && imageB) {
      setSelectedChoice(choice);
      setShowShimmer(true);

      const selectedImage = choice === 'a' ? imageA : imageB;
      try {
        const voteData = await voteMutation.mutateAsync({ imageId: selectedImage.id }) as CurateImageVoteResponse;
        queryClient.setQueryData<CelebrityImage[]>(imageQueryKey, (currentImages) =>
          applyCurateVoteToImages(currentImages, selectedImage.id, voteData)
        );
        onVote();
        setShowShimmer(false);
        setShowResults(true);
        void queryClient.invalidateQueries({ queryKey: imageQueryKey });
      } catch {
        setSelectedChoice(null);
        setShowShimmer(false);
      }
    }
  };

  const handleContinue = () => {
    setIsExiting(true);
    timeoutRef2.current = setTimeout(onComplete, 300);
  };

  // Calculate total votes for this person's images
  const totalVotes = useMemo(() => {
    return images.reduce((sum, img) => sum + img.votesUp + img.votesDown, 0);
  }, [images]);

  return (
    <motion.div 
      className="px-1.5 md:px-0"
      initial={{ opacity: 1, x: 0 }}
      animate={{ opacity: isExiting ? 0 : 1, x: isExiting ? -100 : 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="relative group">
        <div className="absolute -inset-[1px] rounded-xl border border-[#EFEFEF]/50 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100" />
      <Card 
        className="relative p-4 transition-all duration-200 overflow-hidden border-slate-700/50 group-hover:shadow-lg group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl"
        data-testid={`card-curate-${poll.id}`}
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
        <div className="absolute top-3 right-3">
          <InteractiveCategoryPill
            category={poll.category}
            onFilter={() => onFilterCategory(poll.category)}
            leaderboardCategories={leaderboardCategories}
            data-testid={`badge-curate-${poll.id}`}
          />
        </div>
        <div className="mb-3">
          <h3 className="font-semibold text-sm">{poll.personName}</h3>
        </div>
        
        {isLoading ? (
          <CardGridSkeleton count={2} />
        ) : !imageA || !imageB ? (
          <div className="text-center py-8 text-muted-foreground">
            <Camera className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No images available</p>
          </div>
        ) : showResults ? (
          <div className="text-center py-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="h-12 w-12 rounded-full bg-green-500/25 dark:bg-green-500/20 flex items-center justify-center mx-auto mb-3"
            >
              <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
            </motion.div>
            <p className="font-medium text-green-600 dark:text-green-400 mb-1">Vote recorded!</p>
            <p className="text-xs text-muted-foreground mb-4">{totalVotes.toLocaleString('en-US')} total votes</p>
            <div className="flex gap-2 justify-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onViewResults(poll)}
                className="border-cyan-500/60 dark:border-cyan-500/50 text-cyan-600 dark:text-cyan-400"
                data-testid={`button-view-results-${poll.id}`}
              >
                View Results
              </Button>
              <Button
                size="sm"
                onClick={handleContinue}
                className="bg-cyan-500 hover:bg-cyan-600 text-white"
                data-testid={`button-next-${poll.id}`}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-center text-lg font-serif font-bold text-cyan-600 dark:text-cyan-400 mb-4">Which look defines them?</p>
            
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handlePick('a')}
                disabled={!!selectedChoice}
                className={`relative aspect-square rounded-lg overflow-hidden transition-all duration-300 group cursor-pointer ${
                  selectedChoice === 'a' 
                    ? 'border-green-500 ring-4 ring-green-500/30 scale-105' 
                    : selectedChoice === 'b'
                    ? 'border-muted opacity-40 scale-95'
                    : 'border border-slate-700/50 hover:border-slate-400/50 hover:scale-102'
                }`}
                data-testid={`button-photo-a-${poll.id}`}
              >
                <img 
                  src={imageA.imageUrl} 
                  alt={`${poll.personName} Look A`}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <span className="text-xs text-white font-medium">Look A</span>
                </div>
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
                className={`relative aspect-square rounded-lg overflow-hidden transition-all duration-300 group cursor-pointer ${
                  selectedChoice === 'b' 
                    ? 'border-green-500 ring-4 ring-green-500/30 scale-105' 
                    : selectedChoice === 'a'
                    ? 'border-muted opacity-40 scale-95'
                    : 'border border-slate-700/50 hover:border-slate-400/50 hover:scale-102'
                }`}
                data-testid={`button-photo-b-${poll.id}`}
              >
                <img 
                  src={imageB.imageUrl} 
                  alt={`${poll.personName} Look B`}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <span className="text-xs text-white font-medium">Look B</span>
                </div>
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
          </>
        )}
      </Card>
      </div>
    </motion.div>
  );
}

function DiscourseCard({
  topic,
  onVote,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onNavigateToPollDetail,
  onBrowseFullScreen,
}: {
  topic: any;
  onVote: (choice: 'support' | 'neutral' | 'oppose') => Promise<void>;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
  /** When set, detail links use history voteList + client navigation (Vote page). */
  onNavigateToPollDetail?: () => void;
  onBrowseFullScreen?: () => void;
}) {
  const [voted, setVoted] = useState<'support' | 'neutral' | 'oppose' | null>(topic.userVote || null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  useEffect(() => {
    setVoted(topic.userVote ?? null);
  }, [topic.userVote]);

  const imgSources = [topic.personAvatar, topic.imageUrl].filter(Boolean) as string[];
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    setImgIdx(0);
  }, [topic.id, topic.imageUrl, topic.personAvatar]);

  const currentImgSrc = imgSources[imgIdx] ?? null;

  const handleImgError = () => {
    if (imgIdx + 1 < imgSources.length) {
      setImgIdx(imgIdx + 1);
    } else {
      setImgIdx(imgSources.length);
    }
  };

  const handleVote = async (choice: 'support' | 'neutral' | 'oppose') => {
    if (voted) return;
    const prev = voted;
    setVoted(choice);
    try {
      await onVote(choice);
    } catch {
      setVoted(prev);
    }
  };

  const handleChangeVote = () => {
    setVoted(null);
  };

  return (
    <div className="relative group h-full">
      <div className="absolute -inset-[1px] rounded-xl border border-[#EFEFEF]/50 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 hidden md:block" />
    <Card 
      className="relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full min-h-[390px] md:min-h-[300px] flex flex-col border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl"
      data-testid={`card-discourse-${topic.id}`}
    >
      <div className="absolute top-3 right-3">
        <InteractiveCategoryPill
          category={topic.category}
          onFilter={() => onFilterCategory(topic.category)}
          leaderboardCategories={leaderboardCategories}
          detailHref={topic.slug ? `/polls/${topic.slug}` : undefined}
          detailOnNavigate={onNavigateToPollDetail}
          detailLabel="View Poll Details"
          onBrowseFullScreen={onBrowseFullScreen}
          data-testid={`badge-category-${topic.id}`}
        />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
        <span className={voted ? "" : "text-slate-600"}>
          {voted ? `${topic.totalVotes.toLocaleString('en-US')} votes` : "Votes"}
        </span>
      </div>
      <AvatarHeightHeadline
        className="mb-3"
        text={topic.headline}
        serif={false}
        href={onNavigateToPollDetail ? undefined : topic.slug ? `/polls/${topic.slug}` : undefined}
        onTitleNavigate={onNavigateToPollDetail}
        linkTestId={topic.slug ? `link-poll-detail-${topic.id}` : undefined}
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
                alt={topic.personName || topic.headline}
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
      {topic.subjectText && (
        topic.slug && onNavigateToPollDetail ? (
          <button type="button" onClick={onNavigateToPollDetail} className="block mb-4 w-full text-left">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.subjectText}</p>
          </button>
        ) : topic.slug ? (
          <Link href={`/polls/${topic.slug}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.subjectText}</p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{topic.subjectText}</p>
        )
      )}
      {!topic.subjectText && topic.description && (
        topic.slug && onNavigateToPollDetail ? (
          <button type="button" onClick={onNavigateToPollDetail} className="block mb-4 w-full text-left">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.description}</p>
          </button>
        ) : topic.slug ? (
          <Link href={`/polls/${topic.slug}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.description}</p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{topic.description}</p>
        )
      )}
      
      {!voted ? (
        <div className="flex flex-col gap-3 mt-auto">
          <button
            onClick={() => handleVote('support')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
            data-testid={`button-support-${topic.id}`}
          >
            <ThumbsUp className="h-4 w-4 shrink-0" />
            <span>Support</span>
          </button>
          <button
            onClick={() => handleVote('neutral')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-muted/40 border border-border text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white text-sm font-medium transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60 dark:hover:border-white/80 dark:hover:bg-white/15"
            data-testid={`button-neutral-${topic.id}`}
          >
            <Minus className="h-4 w-4 shrink-0" />
            <span>Neutral</span>
          </button>
          <button
            onClick={() => handleVote('oppose')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
            data-testid={`button-oppose-${topic.id}`}
          >
            <ThumbsDown className="h-4 w-4 shrink-0" />
            <span>Oppose</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mt-auto">
          <div className="flex items-center gap-3">
            <ThumbsUp className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("support") }} />
            <span
              className="text-sm w-16 shrink-0 font-medium"
              style={{ color: getSentimentPollChoiceColor("support") }}
            >
              {getSentimentPollChoiceLabel("support")}
            </span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                style={{ width: `${topic.approvePercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.approvePercent}%</span>
          </div>
          
          <div className="flex items-center gap-3">
            <Minus className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("neutral") }} />
            <span
              className="text-sm w-16 shrink-0 font-medium"
              style={{ color: getSentimentPollChoiceColor("neutral") }}
            >
              {getSentimentPollChoiceLabel("neutral")}
            </span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-slate-400 rounded-full transition-all duration-500"
                style={{ width: `${topic.neutralPercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.neutralPercent}%</span>
          </div>
          
          <div className="flex items-center gap-3">
            <ThumbsDown className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("oppose") }} />
            <span
              className="text-sm w-16 shrink-0 font-medium"
              style={{ color: getSentimentPollChoiceColor("oppose") }}
            >
              {getSentimentPollChoiceLabel("oppose")}
            </span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                style={{ width: `${topic.disapprovePercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.disapprovePercent}%</span>
          </div>
          
          <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/10">
            <div className="min-w-0">
              {topic.slug &&
                (onNavigateToPollDetail ? (
                  <button
                    type="button"
                    onClick={onNavigateToPollDetail}
                    className="text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors underline-offset-4 hover:underline text-left"
                    data-testid={`link-poll-view-more-${topic.id}`}
                  >
                    View more details
                  </button>
                ) : (
                  <Link
                    href={`/polls/${topic.slug}`}
                    className="text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors underline-offset-4 hover:underline inline-block"
                    data-testid={`link-poll-view-more-${topic.id}`}
                  >
                    View more details
                  </Link>
                ))}
            </div>
            <div
              className="px-2 py-0.5 rounded-full text-xs font-medium border bg-white/5 border-white/20"
              style={{ color: voted ? getSentimentPollChoiceColor(voted) : undefined }}
              data-testid={`badge-voted-${topic.id}`}
            >
              {voted ? getSentimentPollChoiceLabel(voted) : "You voted"}
            </div>
          </div>
          
          <button
            onClick={handleChangeVote}
            className="text-xs text-slate-400 hover:text-white transition-colors underline-offset-4 hover:underline text-center"
            data-testid={`button-change-vote-${topic.id}`}
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
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          onClick={() => setExpandedImage(null)}
        >
          <X className="h-6 w-6 text-white" />
        </button>
        <img
          src={expandedImage}
          alt={topic.personName || topic.headline}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}
    </div>
  );
}

// parseVoteError was extracted to client/src/lib/voteErrors.ts so other vote
// surfaces (PersonDetailPage, AnimatedSentimentVotingWidget) can share the
// same rate-limit-aware UX. Imported at the top of this file.

function CarouselSection({
  title,
  subtitle,
  children,
  icon: Icon
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  icon: typeof Vote;
}) {
  const slides = Children.toArray(children);
  const [activeIndex, setActiveIndex] = useState(0);
  const swiperRef = useRef<SwiperType | null>(null);

  useEffect(() => {
    setActiveIndex(0);
    swiperRef.current?.slideTo(0, 0);
  }, [slides.length]);

  return (
    <section className="mb-10">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-lg bg-cyan-500/15 dark:bg-cyan-500/10 hidden sm:flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-serif font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="predict-carousel w-screen relative left-1/2 -ml-[50vw] md:w-auto md:relative md:left-0 md:ml-0 md:-mx-2">
        <Swiper
          modules={[A11y]}
          spaceBetween={12}
          slidesPerView={3}
          threshold={10}
          touchAngle={45}
          resistanceRatio={0.85}
          speed={300}
          cssMode={false}
          breakpoints={{
            0: { spaceBetween: 0 },
            640: { slidesPerView: 1 },
            768: { spaceBetween: 12 },
            1024: { slidesPerView: 2 },
          }}
          pagination={false}
          onSwiper={(s) => {
            swiperRef.current = s;
          }}
          onSlideChange={(s) => setActiveIndex(s.activeIndex)}
          a11y={{ enabled: true, prevSlideMessage: "Previous slide", nextSlideMessage: "Next slide" }}
        >
          {slides.map((child, i) => (
            <SwiperSlide key={i}>
              {child}
            </SwiperSlide>
          ))}
        </Swiper>
        <div className="flex md:hidden justify-center">
          <WindowedDotIndicator
            totalSlides={slides.length}
            activeIndex={activeIndex}
            accent="cyan"
            testIdPrefix="carousel-section-dots"
            onDotClick={(idx) => swiperRef.current?.slideTo(idx)}
          />
        </div>
      </div>
    </section>
  );
}


const VOTE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  favorites: Star,
  trending: Flame,
  tech: Cpu,
  politics: Landmark,
  business: Briefcase,
  music: Music2,
  sports: Trophy,
  "film-tv": Clapperboard,
  gaming: Gamepad2,
  creator: Video,
  comedy: Laugh,
  "food-drink": UtensilsCrossed,
  lifestyle: Heart,
  misc: Sparkles,
};

function FilterChip({ 
  category, 
  isActive, 
  onClick, 
  testIdPrefix,
  user,
  onAuthRequired,
  isCustomTopic = false,
}: { 
  category: string; 
  isActive: boolean; 
  onClick: () => void; 
  testIdPrefix: string;
  user: any;
  onAuthRequired: () => void;
  isCustomTopic?: boolean;
}) {
  const isFavorites = category === "favorites";
  const IconComponent = VOTE_CATEGORY_ICONS[category] || LayoutGrid;

  const handleClick = () => {
    if (isFavorites && !user) {
      onAuthRequired();
      return;
    }
    onClick();
  };

  const getDisplayLabel = () => {
    if (category === "all") {
      return (
        <>
          <span className="hidden md:inline">All Categories</span>
          <span className="md:hidden">All</span>
        </>
      );
    }
    if (category === "favorites") return "Favorites";
    if (category === "trending") return "Trending";
    return getMarketCategoryLabel(category);
  };

  const getTestId = () => {
    if (isCustomTopic) return `${testIdPrefix}-custom-topic`;
    return `${testIdPrefix}-${category.toLowerCase()}`;
  };

  return (
    <button
      onClick={handleClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap ${
        isActive
          ? "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
          : "bg-muted/50 border-border/60 text-muted-foreground hover:border-foreground/30 dark:bg-slate-800/30 dark:border-slate-700/40 dark:text-slate-400 dark:hover:border-slate-600"
      }`}
      data-testid={getTestId()}
    >
      <IconComponent className="h-3.5 w-3.5" />
      {getDisplayLabel()}
    </button>
  );
}

const OVERLAY_SCROLL_PREFIX = "overlay_scroll_";
type SnapOpenSource = "card-tap" | "browse-button" | "header-icon";

function saveOverlayScroll(name: string, scrollTop: number) {
  sessionStorage.setItem(OVERLAY_SCROLL_PREFIX + name, String(Math.round(scrollTop)));
}
function restoreOverlayScroll(name: string, el: HTMLElement | null) {
  const saved = sessionStorage.getItem(OVERLAY_SCROLL_PREFIX + name);
  if (saved && el) {
    const pos = parseInt(saved, 10);
    requestAnimationFrame(() => { el.scrollTop = pos; });
  }
}
function clearOverlayScroll(name: string) {
  sessionStorage.removeItem(OVERLAY_SCROLL_PREFIX + name);
}

export default function VotePage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const voteOnboardingRef = useRef<OnboardingDrawerHandle>(null);
  const { favorites, favoriteIds, isAuthenticated } = useFavorites();
  const raceMap = useCategoryRaceMap();
  const leaderboardCats = useLeaderboardCategories();

  const [inductionSuggestOpen, setInductionSuggestOpen] = useState(false);
  const [matchupSuggestOpen, setMatchupSuggestOpen] = useState(false);
  const [curateSuggestOpen, setCurateSuggestOpen] = useState(false);
  const [curateCelebrity, setCurateCelebrity] = useState("");
  const [curateImageFile, setCurateImageFile] = useState<File | null>(null);
  const [curateImageSource, setCurateImageSource] = useState("");
  const [suggestName, setSuggestName] = useState("");
  const [suggestCategory, setSuggestCategory] = useState("");
  const [suggestReason, setSuggestReason] = useState("");
  const [suggestUrl, setSuggestUrl] = useState("");
  const [matchupHeadline, setMatchupHeadline] = useState("");
  const [matchupContenderA, setMatchupContenderA] = useState<ContenderSelection>({ type: null, name: '' });
  const [matchupContenderB, setMatchupContenderB] = useState<ContenderSelection>({ type: null, name: '' });
  const [matchupCategory, setMatchupCategory] = useState("");
  const [isSuggestSubmitting, setIsSuggestSubmitting] = useState(false);
  const [inductionCountdown, setInductionCountdown] = useState(() => formatInductionCountdown(getClientWeekDeadlines().sunday));

  const { data: userStats } = useUserStats(!!user);
  const xp = userStats?.xpPoints ?? 0;
  const rank = userStats?.rank?.name ?? "Citizen";
  const { trigger: triggerXpBurst } = useXpBurst();
  const { vote: voteOnOpinionPoll, removeVote: removeOpinionPollVote } = useOpinionPollVoteMutation();

  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

  /**
   * Current Vote hub UI state as a serializable snapshot. Read synchronously at click time
   * (via .current) to stash into the auth-return payload before navigating to /login.
   * Kept in sync with React state by the overlay/snap sync effect further below.
   */
  const voteLoginSnapshotRef = useRef<VoteResumePayload>({
    inductionOverlayOpen: false,
    topicsOverlayOpen: false,
    matchupsOverlayOpen: false,
    opinionPollsOverlayOpen: false,
    valuePerceptionOverlayOpen: false,
    snapScrollOpen: false,
  });

  interface InductionAPIResponse {
    data: Array<{
      id: string;
      displayName: string;
      category: string;
      imageSlug: string | null;
      seedVotes: number;
      wikiSlug: string | null;
      isActive: boolean;
    }>;
  }
  
  const { data: inductionData, isLoading: inductionLoading } = useQuery<InductionAPIResponse>({
    queryKey: ['/api/vote/induction'],
    staleTime: 60 * 1000,
  });

  const { data: myInductionVoteIds } = useQuery<string[]>({
    queryKey: ["/api/me/induction-votes"],
    enabled: !!user,
  });

  useEffect(() => {
    if (!user) {
      setVotedIds(new Set());
      return;
    }
    if (Array.isArray(myInductionVoteIds)) {
      setVotedIds(new Set(myInductionVoteIds));
    }
  }, [user, myInductionVoteIds]);

  const budget = useAnonBudget();

  const inductionVoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/vote/induction/${id}/vote`);
      return res.json();
    },
    onSuccess: (data) => {
      // Phase 4 — sync the anon-budget cache from the server-authoritative
      // snapshot in the response.
      applyBudgetFromVoteResponse(queryClient, data);
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/me/induction-votes'] });
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
    },
    onError: (err, candidateId) => {
      hapticError();
      setVotedIds((prev) => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
      if (isUnauthorizedApiError(err)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation, { voteUi: voteLoginSnapshotRef.current })));
      } else if (isBudgetExhaustedVoteError(err)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          voteUi: voteLoginSnapshotRef.current,
          resumeAction: {
            surfaceType: "induction",
            targetId: candidateId,
            cardRoute: window.location.pathname,
            pendingVote: { intent: "induct" },
          },
        });
      } else {
        const parsed = parseVoteError(err);
        toast.error("Couldn't record vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    },
  });

  const dbInductionCandidates: InductionCandidate[] = (inductionData?.data || []).map(c => ({
    id: c.id,
    name: c.displayName,
    initials: c.displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
    imageSlug: c.imageSlug,
    category: c.category as InductionCandidate['category'],
    votes: c.seedVotes,
  }));

  const [inductionCategoryFilter, setInductionCategoryFilter] = useState<FilterCategory>("all");
  const [inductionSearchQuery, setInductionSearchQuery] = useState("");
  const [inductionOverlayOpen, setInductionOverlayOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("section") === "induction") return true;
    return window.history.state?.overlay === "induction";
  });
  const prevInductionOverlayOpenRef = useRef(inductionOverlayOpen);

  const [topicsCategoryFilter, setTopicsCategoryFilter] = useState<FilterCategory>("all");
  const [topicsSearchQuery, setTopicsSearchQuery] = useState("");
  const [topicsOverlayOpen, setTopicsOverlayOpen] = useState(() => window.history.state?.overlay === "topics");
  const prevTopicsOverlayOpenRef = useRef(topicsOverlayOpen);
  const [startPollModalOpen, setStartPollModalOpen] = useState(false);
  
  const [matchupsCategoryFilter, setMatchupsCategoryFilter] = useState<FilterCategory>("all");
  const [matchupsSearchQuery, setMatchupsSearchQuery] = useState("");
  const [matchupsOverlayOpen, setMatchupsOverlayOpen] = useState(() => window.history.state?.overlay === "matchups");
  const prevMatchupsOverlayOpenRef = useRef(matchupsOverlayOpen);
  const [pollHeadline, setPollHeadline] = useState("");
  const [sentimentCategory, setSentimentCategory] = useState("misc");
  const [pollDescription, setPollDescription] = useState("");
  const [pollEntitySearch, setPollEntitySearch] = useState("");
  const [pollSubjectType, setPollSubjectType] = useState<'celebrity' | 'custom' | null>(null);
  const [pollSubjectImage, setPollSubjectImage] = useState<File | null>(null);
  const [pollSubjectImagePreview, setPollSubjectImagePreview] = useState<string | null>(null);
  const pollFileInputRef = useRef<HTMLInputElement>(null);
  const [curateLeaderboardOpen, setCurateLeaderboardOpen] = useState(false);
  const [selectedCuratePerson, setSelectedCuratePerson] = useState<CurateProfilePoll | null>(null);
  const [pollDuration, setPollDuration] = useState<string>("none");
  const [pollCustomDate, setPollCustomDate] = useState("");
  
  const [activeSection, setActiveSection] = useState<SectionToggle>("All");
  const [myVotesFilter, setMyVotesFilter] = useState<"all" | "show-mine" | "hide-mine">("all");
  const cycleMyVotesFilter = useCallback(() => {
    setMyVotesFilter((prev) =>
      prev === "all" ? "show-mine" : prev === "show-mine" ? "hide-mine" : "all",
    );
  }, []);
  const [rulesModalOpen, setRulesModalOpen] = useState<string | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState<"governance" | null>(null);
  const [curateCategoryFilter, setCurateCategoryFilter] = useState<FilterCategory>("all");
  const [curateSearchQuery, setCurateSearchQuery] = useState("");
  const [globalCategoryFilter, setGlobalCategoryFilter] = useState<FilterCategory>("all");

  const handleCategoryPillFilter = useCallback((category: string) => {
    setGlobalCategoryFilter(normalizeMarketCategory(category) as FilterCategory);
  }, []);
  
  const [valuePerceptionOverlayOpen, setValuePerceptionOverlayOpen] = useState(() => window.history.state?.overlay === "value-perception");
  const prevValuePerceptionOverlayOpenRef = useRef(valuePerceptionOverlayOpen);
  const [valuePerceptionCategoryFilter, setValuePerceptionCategoryFilter] = useState<FilterCategory>("all");
  const [valuePerceptionSearchQuery, setValuePerceptionSearchQuery] = useState("");


  const [opinionPollsCategoryFilter, setOpinionPollsCategoryFilter] = useState<FilterCategory>("all");
  const [opinionPollsSearchQuery, setOpinionPollsSearchQuery] = useState("");
  const [opinionPollsOverlayOpen, setOpinionPollsOverlayOpen] = useState(() => window.history.state?.overlay === "opinion-polls");
  const prevOpinionPollsOverlayOpenRef = useRef(opinionPollsOverlayOpen);
  const [opinionSuggestOpen, setOpinionSuggestOpen] = useState(false);
  const [opinionSuggestTitle, setOpinionSuggestTitle] = useState("");
  const [opinionSuggestDescription, setOpinionSuggestDescription] = useState("");
  const [opinionSuggestCategory, setOpinionSuggestCategory] = useState("misc");
  const [opinionSuggestDuration, setOpinionSuggestDuration] = useState<string>("none");
  const [opinionSuggestCustomDate, setOpinionSuggestCustomDate] = useState("");
  const [opinionSuggestOptions, setOpinionSuggestOptions] = useState<OpinionOptionInput[]>(
    Array.from({ length: OPINION_POLL_MIN_OPTIONS }, () => ({ name: "" }))
  );

  const inductionScrollRef = useRef<HTMLDivElement>(null);
  const topicsScrollRef = useRef<HTMLDivElement>(null);
  const matchupsScrollRef = useRef<HTMLDivElement>(null);
  const opinionPollsScrollRef = useRef<HTMLDivElement>(null);
  const valuePerceptionScrollRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();
  const [snapScrollOpen, setSnapScrollOpen] = useState(false);
  const [snapScrollSection, setSnapScrollSection] = useState<SnapSectionType>("matchups");
  const [snapScrollInitialId, setSnapScrollInitialId] = useState<string | undefined>();
  // Hoisted so handleAuthRequired / snapshot sync below can read the saved scroll Y.
  const savedSnapWindowScrollRef = useRef<number | null>(null);

  useEffect(() => {
    const syncSectionFromHash = () => {
      const sec = voteHubSectionFromHash(window.location.hash);
      if (sec) setActiveSection(sec as SectionToggle);
    };
    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    return () => window.removeEventListener("hashchange", syncSectionFromHash);
  }, []);

  useScrollToHash([activeSection]);

  const enrichedCandidates = dbInductionCandidates;
  
  const filteredCandidates = enrichedCandidates.filter(c => {
    const matchesCategory =
      inductionCategoryFilter === "all" ||
      inductionCategoryFilter === "trending" ||
      (inductionCategoryFilter === "favorites" && favoriteIds.has(c.id)) ||
      normalizeMarketCategory(c.category) === inductionCategoryFilter;
    const matchesSearch = c.name.toLowerCase().includes(inductionSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a, b) => b.votes - a.votes);
  
  const sortedCandidates = [...enrichedCandidates].sort((a, b) => b.votes - a.votes);
  const candidateRankById = useMemo(
    () => new Map(sortedCandidates.map((candidate, index) => [candidate.id, index + 1])),
    [sortedCandidates],
  );
  const maxVotes = sortedCandidates[0]?.votes || 1;

  const { data: dbPolls = [], isLoading: pollsLoading } = useQuery<any[]>({
    queryKey: ['/api/trending-polls'],
    staleTime: 60 * 1000,
  });

  const { data: opinionPolls = [], isLoading: opinionPollsLoading } = useQuery<any[]>({
    queryKey: ['/api/opinion-polls'],
    staleTime: 60 * 1000,
  });

  const filteredTopics = dbPolls.filter((t: any) => {
    const matchesCategory =
      topicsCategoryFilter === "all" ||
      topicsCategoryFilter === "trending" ||
      normalizeMarketCategory(t.category) === topicsCategoryFilter;
    const matchesSearch = (t.headline ?? '').toLowerCase().includes(topicsSearchQuery.toLowerCase()) ||
                         (t.description || '').toLowerCase().includes(topicsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a: any, b: any) => topicsCategoryFilter === "trending" ? (b.totalVotes ?? 0) - (a.totalVotes ?? 0) : 0);

  const filteredOpinionPolls = opinionPolls.filter((p: any) => {
    const matchesCategory =
      opinionPollsCategoryFilter === "all" ||
      opinionPollsCategoryFilter === "trending" ||
      normalizeMarketCategory(p.category) === opinionPollsCategoryFilter;
    const matchesSearch = (p.title || '').toLowerCase().includes(opinionPollsSearchQuery.toLowerCase()) ||
                         (p.description || '').toLowerCase().includes(opinionPollsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a: any, b: any) => opinionPollsCategoryFilter === "trending" ? ((b.totalVotes ?? 0) - (a.totalVotes ?? 0)) : 0);

  const { data: detailImages = [] } = useQuery<CelebrityImage[]>({
    queryKey: ['/api/people', selectedCuratePerson?.personId, 'images'],
    enabled: !!selectedCuratePerson,
  });

  const detailTotalVotes = useMemo(() => {
    return detailImages.reduce((sum, img) => sum + img.votesUp + img.votesDown, 0);
  }, [detailImages]);

  const { data: matchups = [], isLoading: matchupsLoading } = useQuery<VersusCardMatchup[]>({
    queryKey: ['/api/matchups'],
    staleTime: 60 * 1000,
  });
  
  const { data: existingMatchupVotes = {} } = useQuery<Record<string, string>>({
    queryKey: ['/api/matchups/user-votes'],
    staleTime: 60 * 1000,
  });
  
  interface ValueLeaderboardResponse {
    data: Array<{
      id: string;
      name: string;
      avatar: string | null;
      category: string | null;
      fameIndex: number | null;
      trendScore: number;
      approvalPct: number | null;
      underratedPct: number | null;
      overratedPct: number | null;
      fairlyRatedPct: number | null;
      underratedCount?: number | null;
      overratedCount?: number | null;
      fairlyRatedCount?: number | null;
      userValueVote: 'underrated' | 'overrated' | 'fairly_rated' | null;
    }>;
  }
  
  const { data: valueCelebritiesData, isLoading: valueLoading } = useQuery<ValueLeaderboardResponse>({
    queryKey: ['/api/leaderboard?tab=value&limit=100'],
    staleTime: 60 * 1000,
  });
  
  const valueCelebrities = valueCelebritiesData?.data || [];
  
  const filteredValueCelebrities = valueCelebrities.filter(c => {
    const matchesCategory =
      valuePerceptionCategoryFilter === "all" ||
      valuePerceptionCategoryFilter === "trending" ||
      (valuePerceptionCategoryFilter === "favorites" && favoriteIds.has(c.id)) ||
      normalizeMarketCategory(c.category) === valuePerceptionCategoryFilter;
    const matchesSearch = !valuePerceptionSearchQuery || c.name.toLowerCase().includes(valuePerceptionSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a: any, b: any) => {
    if (valuePerceptionCategoryFilter !== "trending") return 0;
    // Most-voted-on first; fall back to fameIndex so the Trending tab is still
    // meaningful when nobody has rated anyone yet.
    const votesDiff = (b.approvalVotesCount ?? 0) - (a.approvalVotesCount ?? 0);
    if (votesDiff !== 0) return votesDiff;
    return (Number(b.fameIndex ?? 0)) - (Number(a.fameIndex ?? 0));
  });
  
  const [localMatchupVotes, setLocalMatchupVotes] = useState<Record<string, string>>({});
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  useEffect(() => {
    if (!rateLimitedUntil) return;
    const ms = rateLimitedUntil - Date.now();
    if (ms <= 0) { setRateLimitedUntil(null); return; }
    const id = setTimeout(() => setRateLimitedUntil(null), ms);
    return () => clearTimeout(id);
  }, [rateLimitedUntil]);
  
  const matchupUserVotesMerged = { ...existingMatchupVotes, ...localMatchupVotes };
  const matchupUserVotes = Object.fromEntries(
    Object.entries(matchupUserVotesMerged).filter(([_, v]) => v !== '__removed__')
  );
  
  const matchupVoteMutation = useMutation({
    mutationFn: async ({ matchupId, option }: { matchupId: string; option: 'option_a' | 'option_b' | 'neutral'; previousVote?: string | null }) => {
      const response = await apiRequest('POST', `/api/matchups/${matchupId}/vote`, { option });
      return response.json();
    },
    onSuccess: (data, variables) => {
      // Phase 4 — sync the anon-budget cache from the server-authoritative
      // snapshot in the response.
      applyBudgetFromVoteResponse(queryClient, data);
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['/api/matchups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/matchups/user-votes'] });
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      const isChange = !!variables.previousVote;
      toast(isChange ? "Vote changed!" : "Vote recorded!", { description: isChange ? "Your Matchup vote has been updated." : "Your Matchup vote has been counted." });
    },
    onError: (error: any, variables) => {
      if (variables.previousVote) {
        setLocalMatchupVotes((prev: Record<string, string>) => ({ ...prev, [variables.matchupId]: variables.previousVote! }));
      } else {
        setLocalMatchupVotes((prev: Record<string, string>) => {
          const next = { ...prev };
          delete next[variables.matchupId];
          return next;
        });
      }
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation, { voteUi: voteLoginSnapshotRef.current })));
      } else if (isBudgetExhaustedVoteError(error)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          voteUi: voteLoginSnapshotRef.current,
          resumeAction: {
            surfaceType: "matchup_poll",
            targetId: variables.matchupId,
            cardRoute: window.location.pathname,
            pendingVote: { matchupId: variables.matchupId, option: variables.option },
          },
        });
      } else {
        const parsed = parseVoteError(error);
        if (parsed.retryAfter) {
          setRateLimitedUntil(Date.now() + parsed.retryAfter * 1000);
        }
        toast.error("Couldn't record vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    },
  });
  
  const matchupRemoveVoteMutation = useMutation({
    mutationFn: async ({ matchupId }: { matchupId: string; previousVote: string }) => {
      const response = await apiRequest('POST', `/api/matchups/${matchupId}/vote`, { remove: true });
      return response.json();
    },
    onSuccess: (data) => {
      // Phase 4 — sync budget cache. Remove paths return budget: null
      // server-side (no budget delta) but the helper handles that correctly.
      applyBudgetFromVoteResponse(queryClient, data);
      queryClient.invalidateQueries({ queryKey: ['/api/matchups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/matchups/user-votes'] });
      toast("Vote removed", { description: "Your Matchup vote has been removed." });
    },
    onError: (error: any, variables) => {
      setLocalMatchupVotes((prev: Record<string, string>) => ({ ...prev, [variables.matchupId]: variables.previousVote }));
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation, { voteUi: voteLoginSnapshotRef.current })));
      } else if (isBudgetExhaustedVoteError(error)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          voteUi: voteLoginSnapshotRef.current,
          resumeAction: {
            surfaceType: "matchup_poll",
            targetId: variables.matchupId,
            cardRoute: window.location.pathname,
            pendingVote: { remove: true },
          },
        });
      } else {
        const parsed = parseVoteError(error);
        if (parsed.retryAfter) {
          setRateLimitedUntil(Date.now() + parsed.retryAfter * 1000);
        }
        toast.error("Couldn't record vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    },
  });

  const matchupRateLimited = !!(rateLimitedUntil && Date.now() < rateLimitedUntil);

  const handleMatchupVote = (matchupId: string, option: 'option_a' | 'option_b' | 'neutral') => {
    if (matchupRateLimited) return;
    const previousVote = matchupUserVotes[matchupId] || null;
    // Phase 4 — anon-budget gate. Authed users always proceed; anon users
    // proceed if they have remaining budget. Upsert path (re-vote on same
    // target) proceeds even at exhaustion.
    const isUpsert = previousVote !== null;
    const decision = checkVoteGate(budget, "matchup_poll", matchupId, isUpsert);
    if (!decision.proceed) {
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        voteUi: voteLoginSnapshotRef.current,
        resumeAction: {
          ...decision.resumeAction,
          cardRoute: window.location.pathname,
          pendingVote: { matchupId, option },
        },
      });
      return;
    }
    setLocalMatchupVotes((prev: Record<string, string>) => ({ ...prev, [matchupId]: option }));
    matchupVoteMutation.mutate({ matchupId, option, previousVote });
  };
  
  const handleMatchupRemoveVote = (matchupId: string) => {
    const previousVote = matchupUserVotes[matchupId];
    if (!previousVote) return;
    setLocalMatchupVotes((prev: Record<string, string>) => {
      const next = { ...prev };
      next[matchupId] = '__removed__';
      return next;
    });
    matchupRemoveVoteMutation.mutate({ matchupId, previousVote });
  };
  
  const filteredMatchups = matchups.filter(f => {
    const matchesCategory =
      matchupsCategoryFilter === "all" ||
      matchupsCategoryFilter === "trending" ||
      normalizeMarketCategory(f.category) === matchupsCategoryFilter;
    const matchesSearch = (f.title ?? '').toLowerCase().includes(matchupsSearchQuery.toLowerCase()) ||
                         (f.optionAText ?? '').toLowerCase().includes(matchupsSearchQuery.toLowerCase()) ||
                         (f.optionBText ?? '').toLowerCase().includes(matchupsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch && f.isActive;
  }).sort((a: any, b: any) => matchupsCategoryFilter === "trending" ? ((b.totalVotes ?? 0) - (a.totalVotes ?? 0)) : 0);

  const myVotesCount = useMemo(() => {
    const matchupVoted = filteredMatchups.filter((m) => !!matchupUserVotes[m.id]).length;
    const sentimentVoted = filteredTopics.filter((t: any) => !!t.userVote).length;
    const opinionVoted = filteredOpinionPolls.filter((p: any) => !!p.userVote).length;
    return matchupVoted + sentimentVoted + opinionVoted;
  }, [filteredMatchups, filteredTopics, filteredOpinionPolls, matchupUserVotes]);

  const displayMatchups = useMemo(
    () =>
      myVotesFilter === "all"
        ? filteredMatchups
        : myVotesFilter === "show-mine"
          ? filteredMatchups.filter((m) => !!matchupUserVotes[m.id])
          : filteredMatchups.filter((m) => !matchupUserVotes[m.id]),
    [filteredMatchups, matchupUserVotes, myVotesFilter],
  );

  const displayTopics = useMemo(
    () =>
      myVotesFilter === "all"
        ? filteredTopics
        : myVotesFilter === "show-mine"
          ? filteredTopics.filter((t: any) => !!t.userVote)
          : filteredTopics.filter((t: any) => !t.userVote),
    [filteredTopics, myVotesFilter],
  );

  const displayOpinionPolls = useMemo(
    () =>
      myVotesFilter === "all"
        ? filteredOpinionPolls
        : myVotesFilter === "show-mine"
          ? filteredOpinionPolls.filter((p: any) => !!p.userVote)
          : filteredOpinionPolls.filter((p: any) => !p.userVote),
    [filteredOpinionPolls, myVotesFilter],
  );

  useEffect(() => {
    if (myVotesCount === 0 && myVotesFilter === "show-mine") {
      setMyVotesFilter("all");
    }
  }, [myVotesCount, myVotesFilter]);

  const sentimentSlugList = useMemo(
    () => displayTopics.map((t: any) => t.slug).filter(Boolean) as string[],
    [displayTopics],
  );
  const matchupSlugList = useMemo(
    () => displayMatchups.map((m) => m.slug).filter((s): s is string => !!s),
    [displayMatchups],
  );
  const opinionSlugList = useMemo(
    () => displayOpinionPolls.map((p: any) => p.slug).filter(Boolean) as string[],
    [displayOpinionPolls],
  );

  const goSentimentDetail = useCallback(
    (slug: string) => {
      navigateWithVoteList(
        setLocation,
        { type: "sentiment", slugs: sentimentSlugList, currentSlug: slug, historyDepth: 1 },
        `/polls/${encodeURIComponent(slug)}`,
      );
    },
    [sentimentSlugList, setLocation],
  );
  const goMatchupDetail = useCallback(
    (slug: string) => {
      navigateWithVoteList(
        setLocation,
        { type: "matchup", slugs: matchupSlugList, currentSlug: slug, historyDepth: 1 },
        `/vote/matchups/${encodeURIComponent(slug)}`,
      );
    },
    [matchupSlugList, setLocation],
  );
  const goOpinionDetail = useCallback(
    (slug: string) => {
      navigateWithVoteList(
        setLocation,
        { type: "opinion", slugs: opinionSlugList, currentSlug: slug, historyDepth: 1 },
        `/vote/opinion-polls/${encodeURIComponent(slug)}`,
      );
    },
    [opinionSlugList, setLocation],
  );

  const matchupSnapItems: SnapItem[] = useMemo(
    () =>
      displayMatchups
        .filter((m) => m.isActive)
        .map((m) => ({
          id: m.id,
          slug: m.slug || m.id,
          category: m.category,
          title: m.title,
        })),
    [displayMatchups],
  );

  const sentimentSnapItems: SnapItem[] = useMemo(
    () =>
      displayTopics.map((t: any) => ({
        id: t.id,
        slug: t.slug || t.id,
        category: t.category || "misc",
        title: t.headline || t.title || "",
      })),
    [displayTopics],
  );

  const opinionSnapItems: SnapItem[] = useMemo(
    () =>
      displayOpinionPolls.map((p: any) => ({
        id: p.id,
        slug: p.slug || p.id,
        category: p.category || "misc",
        title: p.title || "",
      })),
    [displayOpinionPolls],
  );

  const valueSnapItems: SnapItem[] = useMemo(
    () =>
      filteredValueCelebrities.map((person: any) => ({
        id: person.id,
        slug: person.id,
        category: person.category || "misc",
        title: person.name || "",
        personId: person.id,
        personName: person.name,
      })),
    [filteredValueCelebrities],
  );

  const inductionSnapItems: SnapItem[] = useMemo(
    () =>
      filteredCandidates.map((c: any) => ({
        id: c.id,
        slug: c.id,
        category: c.category || "misc",
        title: c.name || "",
      })),
    [filteredCandidates],
  );

  const { data: curateTrendingData } = useQuery<{ data: Array<{ id: string; name: string; category: string }> } | Array<{ id: string; name: string; category: string }>>({
    queryKey: ['/api/trending?sort=rank&limit=100'],
    staleTime: 60 * 1000,
  });

  const curateTrendingCelebrities = useMemo(() => {
    if (!curateTrendingData) return [];
    const raw = Array.isArray(curateTrendingData) ? curateTrendingData : (curateTrendingData as any).data;
    return (Array.isArray(raw) ? raw : []).filter((p: any) => !!p?.id);
  }, [curateTrendingData]);

  const filteredCurateCelebrities = useMemo(() => {
    const search = curateSearchQuery.trim().toLowerCase();
    return curateTrendingCelebrities.filter((p: any) => {
      const matchesCategory =
        curateCategoryFilter === "all" ||
        curateCategoryFilter === "trending" ||
        normalizeMarketCategory(p.category) === curateCategoryFilter;
      const matchesSearch = !search || p.name.toLowerCase().includes(search);
      return matchesCategory && matchesSearch;
    });
  }, [curateTrendingCelebrities, curateCategoryFilter, curateSearchQuery]);

  const topicsCategoryOptions = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: dbPolls.map((t: any) => t.category),
        includeFavorites: false,
        includeTrending: true,
        selectedCategory: topicsCategoryFilter,
      }),
    [dbPolls, topicsCategoryFilter],
  );

  const matchupsCategoryOptions = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: matchups.filter((m) => m.isActive).map((m) => m.category),
        includeFavorites: false,
        includeTrending: true,
        selectedCategory: matchupsCategoryFilter,
      }),
    [matchups, matchupsCategoryFilter],
  );

  const opinionCategoryOptions = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: opinionPolls.map((p: any) => p.category),
        includeFavorites: false,
        includeTrending: true,
        selectedCategory: opinionPollsCategoryFilter,
      }),
    [opinionPolls, opinionPollsCategoryFilter],
  );

  const valueCategoryOptions = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: valueCelebrities.map((c) => c.category),
        includeFavorites: true,
        includeTrending: true,
        selectedCategory: valuePerceptionCategoryFilter,
      }),
    [valueCelebrities, valuePerceptionCategoryFilter],
  );

  const inductionCategoryOptions = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: enrichedCandidates.map((c) => c.category),
        includeFavorites: true,
        includeTrending: true,
        selectedCategory: inductionCategoryFilter,
      }),
    [enrichedCandidates, inductionCategoryFilter],
  );

  const curateCategoryOptions = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: curateTrendingCelebrities.map((p: any) => p.category),
        includeFavorites: false,
        includeTrending: true,
        selectedCategory: curateCategoryFilter,
      }),
    [curateTrendingCelebrities, curateCategoryFilter],
  );

  useEffect(() => {
    if (!topicsCategoryOptions.some((c) => c.value === topicsCategoryFilter)) setTopicsCategoryFilter("all");
  }, [topicsCategoryFilter, topicsCategoryOptions]);

  useEffect(() => {
    if (!matchupsCategoryOptions.some((c) => c.value === matchupsCategoryFilter)) setMatchupsCategoryFilter("all");
  }, [matchupsCategoryFilter, matchupsCategoryOptions]);

  useEffect(() => {
    if (!opinionCategoryOptions.some((c) => c.value === opinionPollsCategoryFilter)) setOpinionPollsCategoryFilter("all");
  }, [opinionPollsCategoryFilter, opinionCategoryOptions]);

  useEffect(() => {
    if (!valueCategoryOptions.some((c) => c.value === valuePerceptionCategoryFilter)) setValuePerceptionCategoryFilter("all");
  }, [valuePerceptionCategoryFilter, valueCategoryOptions]);

  useEffect(() => {
    if (!inductionCategoryOptions.some((c) => c.value === inductionCategoryFilter)) setInductionCategoryFilter("all");
  }, [inductionCategoryFilter, inductionCategoryOptions]);

  useEffect(() => {
    if (!curateCategoryOptions.some((c) => c.value === curateCategoryFilter)) setCurateCategoryFilter("all");
  }, [curateCategoryFilter, curateCategoryOptions]);

  const curateSnapItems: SnapItem[] = useMemo(
    () =>
      filteredCurateCelebrities.map((person: any) => ({
        id: person.id,
        slug: person.id,
        category: person.category || "misc",
        title: person.name || "",
        personId: person.id,
        personName: person.name,
      })),
    [filteredCurateCelebrities],
  );

  const openSnapScroll = useCallback((section: SnapSectionType, itemId?: string, source: SnapOpenSource = "card-tap") => {
    if (!isMobile) return;
    if (source === "browse-button") {
      if (!consumeCategoryPillBrowseIntent()) return;
    } else if (source !== "header-icon" && isCategoryPillDrawerDismissSuppressed()) {
      return;
    }
    savedSnapWindowScrollRef.current = window.scrollY;
    setSnapScrollSection(section);
    setSnapScrollInitialId(itemId);
    setSnapScrollOpen(true);
    window.history.pushState({ overlay: `snap-${section}` }, "");
  }, [isMobile]);

  const closeSnapScroll = useCallback(() => {
    setSnapScrollOpen(false);
    window.history.back();
  }, []);

  // Restore the main-page scroll position after snap view closes. Covers both
  // the in-snap back button (closeSnapScroll) and OS/browser back (popstate →
  // applyOverlayState). body.overflow hidden → '' can drop the browser's
  // scroll-restoration on some mobile browsers, especially when the tap
  // originated from deep in the page (e.g. Opinion Polls section).
  useEffect(() => {
    if (!snapScrollOpen && savedSnapWindowScrollRef.current !== null) {
      const y = savedSnapWindowScrollRef.current;
      savedSnapWindowScrollRef.current = null;
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "auto" });
      });
    }
  }, [snapScrollOpen]);

  const handleCardEmptyTap = useCallback((e: React.MouseEvent, section: SnapSectionType, itemId: string) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    const wrapper = e.currentTarget as HTMLElement;
    // Walk up from target but stop at the wrapper — excludes interactive descendants
    // without matching the wrapper's own role="button" attribute.
    let node: HTMLElement | null = target;
    while (node && node !== wrapper) {
      if (
        node.matches(
          'button, a, input, textarea, select, [role="button"], [data-interactive], [data-vaul-overlay]',
        )
      ) {
        return;
      }
      node = node.parentElement;
    }
    e.stopPropagation();
    openSnapScroll(section, itemId, "card-tap");
  }, [isMobile, openSnapScroll]);

  useEffect(() => {
    if (prevInductionOverlayOpenRef.current && !inductionOverlayOpen) {
      setInductionSearchQuery("");
    }
    prevInductionOverlayOpenRef.current = inductionOverlayOpen;
  }, [inductionOverlayOpen]);

  useEffect(() => {
    if (prevTopicsOverlayOpenRef.current && !topicsOverlayOpen) {
      setTopicsSearchQuery("");
    }
    prevTopicsOverlayOpenRef.current = topicsOverlayOpen;
  }, [topicsOverlayOpen]);

  useEffect(() => {
    if (prevMatchupsOverlayOpenRef.current && !matchupsOverlayOpen) {
      setMatchupsSearchQuery("");
    }
    prevMatchupsOverlayOpenRef.current = matchupsOverlayOpen;
  }, [matchupsOverlayOpen]);

  useEffect(() => {
    if (prevOpinionPollsOverlayOpenRef.current && !opinionPollsOverlayOpen) {
      setOpinionPollsSearchQuery("");
    }
    prevOpinionPollsOverlayOpenRef.current = opinionPollsOverlayOpen;
  }, [opinionPollsOverlayOpen]);

  useEffect(() => {
    if (prevValuePerceptionOverlayOpenRef.current && !valuePerceptionOverlayOpen) {
      setValuePerceptionSearchQuery("");
    }
    prevValuePerceptionOverlayOpenRef.current = valuePerceptionOverlayOpen;
  }, [valuePerceptionOverlayOpen]);

  useEffect(() => {
    if (inductionOverlayOpen || topicsOverlayOpen || startPollModalOpen || matchupsOverlayOpen || inductionSuggestOpen || matchupSuggestOpen || curateSuggestOpen || opinionSuggestOpen || valuePerceptionOverlayOpen || opinionPollsOverlayOpen || snapScrollOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [inductionOverlayOpen, topicsOverlayOpen, startPollModalOpen, matchupsOverlayOpen, inductionSuggestOpen, matchupSuggestOpen, curateSuggestOpen, opinionSuggestOpen, valuePerceptionOverlayOpen, opinionPollsOverlayOpen, snapScrollOpen]);

  const applyOverlayState = useCallback((name: string | undefined) => {
    setInductionOverlayOpen(name === "induction");
    setTopicsOverlayOpen(name === "topics");
    setMatchupsOverlayOpen(name === "matchups");
    setOpinionPollsOverlayOpen(name === "opinion-polls");
    setValuePerceptionOverlayOpen(name === "value-perception");
    const isSnap = name?.startsWith("snap-") ?? false;
    setSnapScrollOpen(isSnap);
    if (isSnap && name) setSnapScrollSection(name.replace("snap-", "") as SnapSectionType);
  }, []);

  const openOverlay = useCallback((name: string) => {
    window.history.pushState({ overlay: name }, "");
    applyOverlayState(name);
  }, [applyOverlayState]);

  // Keep the auth-return snapshot in lockstep with the current Vote hub UI. Reading the
  // ref synchronously inside a click handler will reflect the most recently flushed state,
  // so overlays/snap that were open just before "Sign In" are restored on return.
  useEffect(() => {
    voteLoginSnapshotRef.current = {
      inductionOverlayOpen,
      topicsOverlayOpen,
      matchupsOverlayOpen,
      opinionPollsOverlayOpen,
      valuePerceptionOverlayOpen,
      snapScrollOpen,
      ...(snapScrollOpen ? { snapScrollSection } : {}),
      ...(snapScrollOpen && snapScrollInitialId ? { snapScrollInitialId } : {}),
      ...(savedSnapWindowScrollRef.current != null
        ? { savedWindowScrollY: savedSnapWindowScrollRef.current }
        : {}),
    };
  }, [
    inductionOverlayOpen,
    topicsOverlayOpen,
    matchupsOverlayOpen,
    opinionPollsOverlayOpen,
    valuePerceptionOverlayOpen,
    snapScrollOpen,
    snapScrollSection,
    snapScrollInitialId,
  ]);

  const handleAuthRequired = useCallback(() => {
    navigateToLogin(setLocation, { voteUi: voteLoginSnapshotRef.current });
  }, [setLocation]);

  // One-shot restoration of Vote hub UI after a successful sign-in return. The key is
  // seeded by redirectAfterLogin() when the snapshot target was /vote, and removed here
  // so subsequent mounts (manual nav to /vote) do not re-open overlays.
  useEffect(() => {
    if (!user) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(AUTH_APPLY_VOTE_UI_ONCE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      sessionStorage.removeItem(AUTH_APPLY_VOTE_UI_ONCE_KEY);
    } catch {
      /* ignore */
    }
    let payload: VoteResumePayload;
    try {
      payload = JSON.parse(raw) as VoteResumePayload;
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;

    // Prefer the snap-scroll restoration (mobile) since overlays + snap are mutually
    // exclusive by construction. Fall back to a single overlay (first-truthy wins).
    if (payload.snapScrollOpen && payload.snapScrollSection) {
      if (typeof payload.savedWindowScrollY === "number") {
        savedSnapWindowScrollRef.current = payload.savedWindowScrollY;
      }
      setSnapScrollSection(payload.snapScrollSection);
      setSnapScrollInitialId(payload.snapScrollInitialId);
      setSnapScrollOpen(true);
      window.history.pushState({ overlay: `snap-${payload.snapScrollSection}` }, "");
      return;
    }
    const overlayName = payload.inductionOverlayOpen
      ? "induction"
      : payload.topicsOverlayOpen
      ? "topics"
      : payload.matchupsOverlayOpen
      ? "matchups"
      : payload.opinionPollsOverlayOpen
      ? "opinion-polls"
      : payload.valuePerceptionOverlayOpen
      ? "value-perception"
      : null;
    if (overlayName) {
      window.history.pushState({ overlay: overlayName }, "");
      applyOverlayState(overlayName);
    }
  }, [user, applyOverlayState]);

  const closeOverlay = useCallback(() => {
    ["induction", "topics", "matchups", "opinion-polls", "value-perception"].forEach(clearOverlayScroll);
    applyOverlayState(undefined);
    window.history.back();
  }, [applyOverlayState]);

  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      applyOverlayState(e.state?.overlay);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyOverlayState]);

  useEffect(() => {
    if (inductionOverlayOpen) restoreOverlayScroll("induction", inductionScrollRef.current);
  }, [inductionOverlayOpen]);
  useEffect(() => {
    if (topicsOverlayOpen) restoreOverlayScroll("topics", topicsScrollRef.current);
  }, [topicsOverlayOpen]);
  useEffect(() => {
    if (matchupsOverlayOpen) restoreOverlayScroll("matchups", matchupsScrollRef.current);
  }, [matchupsOverlayOpen]);
  useEffect(() => {
    if (opinionPollsOverlayOpen) restoreOverlayScroll("opinion-polls", opinionPollsScrollRef.current);
  }, [opinionPollsOverlayOpen]);
  useEffect(() => {
    if (valuePerceptionOverlayOpen) restoreOverlayScroll("value-perception", valuePerceptionScrollRef.current);
  }, [valuePerceptionOverlayOpen]);

  useEffect(() => {
    const updateInductionCountdown = () => {
      setInductionCountdown(formatInductionCountdown(getClientWeekDeadlines().sunday));
    };

    updateInductionCountdown();
    const interval = setInterval(updateInductionCountdown, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync global category filter to all section filters
  useEffect(() => {
    setMatchupsCategoryFilter(globalCategoryFilter);
    setTopicsCategoryFilter(globalCategoryFilter);
    setInductionCategoryFilter(globalCategoryFilter);
    setCurateCategoryFilter(globalCategoryFilter);
    setOpinionPollsCategoryFilter(globalCategoryFilter);
    setValuePerceptionCategoryFilter(globalCategoryFilter);
  }, [globalCategoryFilter]);

  // Deep-link support: read ?category= from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get("category");
    if (cat) setGlobalCategoryFilter(cat as FilterCategory);
  }, []);

  const handleToggleVote = (candidateId: string) => {
    if (votedIds.has(candidateId)) return;
    // Phase 4 — anon-budget gate. The pre-Stage-7 anon-block has been
    // removed; anon users with remaining budget now hit the server,
    // exhausted users redirect via the gate. isUpsert hardcoded false:
    // votedIds.has() filter above catches re-votes for authed users; anon
    // users start with empty votedIds (server-side anon induction history
    // not surfaced to client until signup).
    const decision = checkVoteGate(budget, "induction", candidateId, false);
    if (!decision.proceed) {
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        voteUi: voteLoginSnapshotRef.current,
        resumeAction: {
          ...decision.resumeAction,
          cardRoute: window.location.pathname,
          pendingVote: { intent: "induct" },
        },
      });
      return;
    }
    setVotedIds(prev => {
      const newSet = new Set(prev);
      newSet.add(candidateId);
      return newSet;
    });
    inductionVoteMutation.mutate(candidateId);
  };

  const discourseVoteMutation = useMutation({
    mutationFn: async ({
      slug,
      choice,
      topicId: _topicId,
    }: {
      slug: string;
      choice: string;
      topicId: string;
    }) => {
      const res = await apiRequest('POST', `/api/polls/${encodeURIComponent(slug)}/vote`, { choice });
      return res.json();
    },
    onSuccess: (data) => {
      // Phase 4 — sync the anon-budget cache from the server-authoritative
      // snapshot in the response.
      applyBudgetFromVoteResponse(queryClient, data);
      queryClient.invalidateQueries({ queryKey: ['/api/trending-polls'] });
      queryClient.invalidateQueries({ queryKey: ['/api/gamification/stats'] });
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
    },
    onError: (error: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/trending-polls'] });
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation, { voteUi: voteLoginSnapshotRef.current })));
      } else if (isBudgetExhaustedVoteError(error)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          voteUi: voteLoginSnapshotRef.current,
          resumeAction: {
            surfaceType: "trending_poll",
            targetId: variables.topicId,
            cardRoute: window.location.pathname,
            pendingVote: { choice: variables.choice },
          },
        });
      } else {
        const parsed = parseVoteError(error);
        toast.error("Couldn't record vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    },
  });

  const handleDiscourseVote = async (
    topicId: string,
    choice: 'support' | 'neutral' | 'oppose',
  ): Promise<void> => {
    // Phase 4 — anon-budget gate. The pre-Stage-7 anon-block has been
    // removed; anon users with remaining budget now hit the server.
    // isUpsert defaults to false — the user's prior vote on this poll is
    // not immediately surfaced from existing queries on this page.
    const decision = checkVoteGate(budget, "trending_poll", topicId, false);
    if (!decision.proceed) {
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        voteUi: voteLoginSnapshotRef.current,
        resumeAction: {
          ...decision.resumeAction,
          cardRoute: window.location.pathname,
          pendingVote: { choice },
        },
      });
      throw new Error("Vote gate redirect");
    }
    const topic = dbPolls.find((t: any) => t.id === topicId);
    if (!topic?.slug) {
      throw new Error("Topic not found");
    }
    await discourseVoteMutation.mutateAsync({ slug: topic.slug, choice, topicId });
  };

  const openSuggestModal = (open: () => void) => {
    if (!user) {
      toast.error("Sign in required", { description: "Please sign in to suggest content." });
      return;
    }
    open();
  };

  const handlePollSubmit = async () => {
    if (!pollHeadline || !pollEntitySearch) return;
    setIsSuggestSubmitting(true);
    try {
      let pollImageUrl: string | undefined;
      if (pollSubjectImage) {
        const formData = new FormData();
        formData.append("file", pollSubjectImage);
        const res = await fetch("/api/suggestions/upload-image", {
          method: "POST",
          body: formData,
          headers: { ...(await getAuthHeaders()) },
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "Image upload failed");
        }
        const { url } = await res.json();
        pollImageUrl = url as string;
      }

      const suggestRes = await apiRequest("POST", "/api/suggestions", {
        type: "sentiment_poll",
        payload: {
          headline: pollHeadline,
          subjectText: pollEntitySearch,
          subjectType: pollSubjectType ?? undefined,
          category: sentimentCategory,
          imageUrl: pollImageUrl,
          description: pollDescription || undefined,
          timeline: toTimelineWireValue(pollDuration),
          deadlineAt: pollDuration === "custom" ? pollCustomDate || undefined : undefined,
        },
      });
      const suggestData = await suggestRes.json();
      if (suggestData?.xp?.xpAwarded) {
        triggerXpBurst(suggestData.xp.xpAwarded, undefined, suggestData.xp.reason);
      }
      setStartPollModalOpen(false);
      setPollHeadline("");
      setSentimentCategory("misc");
      setPollDescription("");
      setPollEntitySearch("");
      setPollSubjectType(null);
      setPollSubjectImage(null);
      setPollSubjectImagePreview(null);
      setPollDuration("none");
      setPollCustomDate("");
      toast("Poll suggested!", { description: "We'll review it shortly. You earned 5 XP!" });
    } catch (err: any) {
      toast.error("Submission failed", { description: err?.message ?? "Something went wrong. Please try again." });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handleMatchupSuggestSubmit = async () => {
    setIsSuggestSubmitting(true);
    try {
      // Resolve images: celebrities use imageUrl directly; custom contenders upload their file first.
      const resolveContenderImage = async (contender: typeof matchupContenderA): Promise<string | undefined> => {
        if (contender.imageUrl) return contender.imageUrl;
        if (contender.uploadedFile) {
          const formData = new FormData();
          formData.append("file", contender.uploadedFile);
          const res = await fetch("/api/suggestions/upload-image", {
            method: "POST",
            body: formData,
            headers: { ...(await getAuthHeaders()) },
            credentials: "include",
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `Upload failed for contender: ${contender.name}`);
          }
          const { url } = await res.json();
          return url as string;
        }
        return undefined;
      };
      const optionAImage = await resolveContenderImage(matchupContenderA);
      const optionBImage = await resolveContenderImage(matchupContenderB);

      const suggestRes = await apiRequest("POST", "/api/suggestions", {
        type: "matchup",
        payload: {
          title: matchupHeadline,
          category: matchupCategory,
          optionAText: matchupContenderA.name,
          optionBText: matchupContenderB.name,
          personAId: matchupContenderA.type === "celebrity" ? matchupContenderA.celebrityId : undefined,
          personBId: matchupContenderB.type === "celebrity" ? matchupContenderB.celebrityId : undefined,
          optionAImage,
          optionBImage,
        },
      });
      const suggestData = await suggestRes.json();
      if (suggestData?.xp?.xpAwarded) {
        triggerXpBurst(suggestData.xp.xpAwarded, undefined, suggestData.xp.reason);
      }
      setMatchupHeadline("");
      setMatchupContenderA({ type: null, name: "" });
      setMatchupContenderB({ type: null, name: "" });
      setMatchupCategory("");
      setMatchupSuggestOpen(false);
      toast("Matchup suggested!", { description: "We'll review it shortly. You earned 5 XP!" });
    } catch (err: any) {
      toast.error("Submission failed", { description: err?.message ?? "Something went wrong. Please try again." });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handleInductionSuggestSubmit = async () => {
    setIsSuggestSubmitting(true);
    try {
      const suggestRes = await apiRequest("POST", "/api/suggestions", {
        type: "induction",
        payload: {
          displayName: suggestName,
          socialUrl: suggestUrl,
          category: suggestCategory || undefined,
          reason: suggestReason || undefined,
        },
      });
      const suggestData = await suggestRes.json();
      if (suggestData?.xp?.xpAwarded) {
        triggerXpBurst(suggestData.xp.xpAwarded, undefined, suggestData.xp.reason);
      }
      setSuggestName("");
      setSuggestUrl("");
      setSuggestCategory("");
      setSuggestReason("");
      setInductionSuggestOpen(false);
      toast("Candidate suggested!", { description: "We'll review it shortly. You earned 5 XP!" });
    } catch (err: any) {
      toast.error("Submission failed", { description: err?.message ?? "Something went wrong. Please try again." });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handleCurateSuggestSubmit = async () => {
    if (!curateImageFile) return;
    setIsSuggestSubmitting(true);
    try {
      // Step 1: upload the image, get a persistent URL.
      const formData = new FormData();
      formData.append("file", curateImageFile);
      const uploadRes = await fetch("/api/suggestions/upload-image", {
        method: "POST",
        body: formData,
        headers: { ...(await getAuthHeaders()) },
        credentials: "include",
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "Image upload failed");
      }
      const { url: imageUrl } = await uploadRes.json();

      // Step 2: submit the suggestion with the uploaded URL.
      const suggestRes = await apiRequest("POST", "/api/suggestions", {
        type: "profile_image",
        payload: {
          personName: curateCelebrity,
          imageUrl,
          sourceCredit: curateImageSource || undefined,
        },
      });
      const suggestData = await suggestRes.json();
      if (suggestData?.xp?.xpAwarded) {
        triggerXpBurst(suggestData.xp.xpAwarded, undefined, suggestData.xp.reason);
      }
      setCurateCelebrity("");
      setCurateImageFile(null);
      setCurateImageSource("");
      setCurateSuggestOpen(false);
      toast("Image suggested!", { description: "We'll review it shortly. You earned 5 XP!" });
    } catch (err: any) {
      toast.error("Submission failed", { description: err?.message ?? "Something went wrong. Please try again." });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handleOpinionSuggestSubmit = async () => {
    const filledOptions = opinionSuggestOptions.filter((o) => o.name.trim());
    if (filledOptions.length < OPINION_POLL_MIN_OPTIONS) {
      toast.error("Not enough options", { description: `Please provide at least ${OPINION_POLL_MIN_OPTIONS} options.` });
      return;
    }
    setIsSuggestSubmitting(true);
    try {
      // Upload any pending custom image files sequentially
      const resolvedOptions: Array<{ name: string; imageUrl?: string; personId?: string }> = [];
      for (const opt of filledOptions) {
        let imageUrl = opt.imageUrl;
        if (opt.uploadedFile && !imageUrl) {
          const formData = new FormData();
          formData.append("file", opt.uploadedFile);
          const res = await fetch("/api/suggestions/upload-image", {
            method: "POST",
            body: formData,
            headers: { ...(await getAuthHeaders()) },
            credentials: "include",
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `Upload failed for option: ${opt.name}`);
          }
          const { url } = await res.json();
          imageUrl = url;
        }
        resolvedOptions.push({
          name: opt.name.trim(),
          ...(imageUrl ? { imageUrl } : {}),
          ...(opt.personId ? { personId: opt.personId } : {}),
        });
      }

      const suggestRes = await apiRequest("POST", "/api/suggestions", {
        type: "opinion_poll",
        payload: {
          title: opinionSuggestTitle,
          description: opinionSuggestDescription || undefined,
          category: opinionSuggestCategory,
          timeline: toTimelineWireValue(opinionSuggestDuration),
          deadlineAt: opinionSuggestDuration === "custom" ? opinionSuggestCustomDate || undefined : undefined,
          options: resolvedOptions,
        },
      });
      const suggestData = await suggestRes.json();
      if (suggestData?.xp?.xpAwarded) {
        triggerXpBurst(suggestData.xp.xpAwarded, undefined, suggestData.xp.reason);
      }
      setOpinionSuggestTitle("");
      setOpinionSuggestDescription("");
      setOpinionSuggestOptions(Array.from({ length: OPINION_POLL_MIN_OPTIONS }, () => ({ name: "" })));
      setOpinionSuggestCategory("misc");
      setOpinionSuggestDuration("none");
      setOpinionSuggestCustomDate("");
      setOpinionSuggestOpen(false);
      toast("Poll suggested!", { description: "We'll review it shortly. You earned 5 XP!" });
    } catch (err: any) {
      toast.error("Submission failed", { description: err?.message ?? "Something went wrong. Please try again." });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handlePollImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPollSubjectImage(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setPollSubjectImagePreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
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
              className="md:hidden"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <button 
              onClick={() => {
                setLocation("/");
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="button-logo-home"
            >
              <VoxDexLogo size={32} variant="vote" />
              <span className="font-serif font-bold text-xl">VoxDex</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Link href="/#leaderboard">
                <Button variant="ghost" size="sm" className="md:text-sm" data-testid="link-nav-leaderboard">Leaderboard</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm" className="text-cyan-700 dark:text-cyan-400 md:text-sm" data-testid="link-nav-vote">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm" className="md:text-sm" data-testid="link-nav-predict">Predict</Button>
              </Link>
            </div>
            <HeaderUserActions />
          </div>
        </div>
      </header>
      <div 
        className="sticky top-16 z-40 bg-background/80 backdrop-blur-xl border-b"
        data-testid="section-toggles-container"
      >
            <div className="container mx-auto px-2 sm:px-4 py-3 max-w-7xl flex items-center gap-3">
          <ScrollMaskedChipRow className="pb-1 relative flex-1 min-w-0">
            {user && (
              <button
                type="button"
                onClick={cycleMyVotesFilter}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  myVotesFilter === "show-mine"
                    ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20"
                    : myVotesFilter === "hide-mine"
                      ? "bg-amber-500/15 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/50 dark:border-amber-500/40"
                      : "bg-background text-muted-foreground hover:bg-muted/40 dark:hover:bg-white/5 border border-input"
                }`}
                data-testid="toggle-my-votes-pill"
              >
                {myVotesFilter === "hide-mine" ? (
                  <EyeOff className="h-4 w-4 shrink-0" />
                ) : (
                  <Vote className="h-4 w-4 shrink-0" />
                )}
                {myVotesFilter === "hide-mine" ? `Hidden (${myVotesCount})` : `Votes (${myVotesCount})`}
              </button>
            )}
            {SECTION_TOGGLES.map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  activeSection === section
                    ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted border border-border"
                }`}
                data-testid={`toggle-section-${section.toLowerCase().replace(/['\s]/g, '-')}`}
              >
                {section === "All" && <Sparkles className="h-4 w-4" />}
                {section === "Matchups" && <Swords className="h-4 w-4" />}
                {section === "Sentiment Polls" && <MessageSquare className="h-4 w-4" />}
                {section === "Opinion Polls" && <Vote className="h-4 w-4" />}
                {section === "Underrated/Overrated" && <BarChart3 className="h-4 w-4" />}
                {section === "Induction Queue" && <UserPlus className="h-4 w-4" />}
                {section === "Curate Profile" && <ImageIcon className="h-4 w-4" />}
                {section === "All" ? (
                  <>
                    <span className="sm:hidden">All</span>
                    <span className="hidden sm:inline">All Votes</span>
                  </>
                ) : (
                  section
                )}
              </button>
            ))}
          </ScrollMaskedChipRow>
        </div>
      </div>
      <div className="container mx-auto px-2 sm:px-4 py-8 max-w-7xl pt-[5px] pb-[5px]">
        {/* ZONE 1: Public Opinion - Sentiment Polls Section (First) */}
        {(activeSection === "All" || activeSection === "Sentiment Polls") && (
        <section id="vote-sentiment" data-hash-anchor className="mb-10 mt-[5px] scroll-mt-28">
          <UnifiedSectionHeader
            title="Sentiment Polls"
            subtitle="Weigh in on current topics"
            icon={<MessageSquare className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            accent="cyan"
            testId="section-header-sentiment"
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("voice")}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                      data-testid="button-rules-voice"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => openSuggestModal(() => setStartPollModalOpen(true))}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-poll"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <button
                  type="button"
                  onClick={() => openSnapScroll("sentiment", displayTopics[0]?.id, "header-icon")}
                  className="md:hidden inline-flex shrink-0 items-center justify-center rounded-md p-1 text-cyan-600 dark:text-cyan-400 transition-colors hover:text-cyan-500 dark:hover:text-cyan-300 hover:bg-muted/40 active:opacity-80"
                  aria-label="Open immersive browse"
                  data-testid="button-snap-sentiment"
                >
                  <Maximize2 className="h-5 w-5" aria-hidden />
                </button>
              </>
            }
          >
            <CategoryRowWithSearch
              searchValue={topicsSearchQuery}
              onSearchChange={setTopicsSearchQuery}
              placeholder="Search topics..."
              testId="filter-topics-search"
            >
              {topicsCategoryOptions.map((opt) => (
                <FilterChip
                  key={opt.value}
                  category={opt.value}
                  isActive={topicsCategoryFilter === opt.value}
                  onClick={() => setTopicsCategoryFilter(opt.value as FilterCategory)}
                  testIdPrefix="filter-topics"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </CategoryRowWithSearch>
          </UnifiedSectionHeader>
          
          {pollsLoading ? (
            <CardGridSkeleton count={3} />
          ) : displayTopics.length > 0 ? (
            <CardSection desktopLimit={9} gap="gap-5" testIdPrefix="section-topics">
              {displayTopics.map((topic) => (
                <div key={topic.id} role="button" tabIndex={0} onClick={(e) => handleCardEmptyTap(e, "sentiment", topic.id)} onKeyDown={(e) => { if (e.key === "Enter") handleCardEmptyTap(e as any, "sentiment", topic.id); }} className="h-full">
                  <DiscourseCard
                    topic={topic}
                    onVote={(choice) => handleDiscourseVote(topic.id, choice)}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToPollDetail={topic.slug ? () => goSentimentDetail(topic.slug) : undefined}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("sentiment", topic.id, "browse-button") : undefined}
                  />
                </div>
              ))}
            </CardSection>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No topics match your filter criteria.
            </div>
          )}

          <div className="text-center mt-2 md:mt-6">
            <Button
              variant="ghost"
              onClick={() => openOverlay("topics")}
              className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
              data-testid="button-view-all-topics"
            >
              View all topics
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* ZONE 1: Public Opinion - Matchups Section (Second) */}
        {(activeSection === "All" || activeSection === "Matchups") && (
        <section id="vote-matchups" data-hash-anchor className="mb-10 scroll-mt-28">
          <UnifiedSectionHeader
            title="Matchups"
            subtitle="Vote on A vs B"
            icon={<Swords className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            accent="cyan"
            testId="section-header-matchups"
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("matchups")}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                      data-testid="button-rules-matchups"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => openSuggestModal(() => setMatchupSuggestOpen(true))}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-matchup"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <button
                  type="button"
                  onClick={() => openSnapScroll("matchups", displayMatchups[0]?.id, "header-icon")}
                  className="md:hidden inline-flex shrink-0 items-center justify-center rounded-md p-1 text-cyan-600 dark:text-cyan-400 transition-colors hover:text-cyan-500 dark:hover:text-cyan-300 hover:bg-muted/40 active:opacity-80"
                  aria-label="Open immersive browse"
                  data-testid="button-snap-matchups"
                >
                  <Maximize2 className="h-5 w-5" aria-hidden />
                </button>
              </>
            }
          >
            <CategoryRowWithSearch
              searchValue={matchupsSearchQuery}
              onSearchChange={setMatchupsSearchQuery}
              placeholder="Search matchups..."
              testId="filter-matchups-search"
            >
              {matchupsCategoryOptions.map((opt) => (
                <FilterChip
                  key={opt.value}
                  category={opt.value}
                  isActive={matchupsCategoryFilter === opt.value}
                  onClick={() => setMatchupsCategoryFilter(opt.value as FilterCategory)}
                  testIdPrefix="filter-matchups"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </CategoryRowWithSearch>
          </UnifiedSectionHeader>
          
          {matchupsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3].map(i => (
                <Card key={i} className="rounded-[12px] bg-slate-800/30 animate-pulse" style={{ minHeight: '380px' }} />
              ))}
            </div>
          ) : (
            <CardSection desktopLimit={9} gap="gap-5" testIdPrefix="section-matchups">
              {displayMatchups.map((matchup) => (
                <div key={matchup.id} role="button" tabIndex={0} onClick={(e) => handleCardEmptyTap(e, "matchups", matchup.id)} onKeyDown={(e) => { if (e.key === "Enter") handleCardEmptyTap(e as any, "matchups", matchup.id); }} className="h-full">
                  <VersusCard
                    matchup={matchup}
                    userVote={matchupUserVotes[matchup.id] || null}
                    onVote={handleMatchupVote}
                    onRemoveVote={handleMatchupRemoveVote}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToDetail={matchup.slug ? () => goMatchupDetail(matchup.slug!) : undefined}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("matchups", matchup.id, "browse-button") : undefined}
                  />
                </div>
              ))}
            </CardSection>
          )}

          {displayMatchups.length === 0 && !matchupsLoading && (
            <div className="text-center py-8 text-muted-foreground">
              No matchups match your filter criteria.
            </div>
          )}

          <div className="text-center mt-2 md:mt-6">
            <Button
              variant="ghost"
              onClick={() => openOverlay("matchups")}
              className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
              data-testid="button-view-all-matchups"
            >
              View all matchups
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* ZONE 1.5: Opinion Polls - Multi-option community polls */}
        {(activeSection === "All" || activeSection === "Opinion Polls") && (
        <section id="vote-opinion" data-hash-anchor className="mb-10 scroll-mt-28">
          <UnifiedSectionHeader
            title="Opinion Polls"
            subtitle="Your preference. The world's verdict."
            icon={<ListChecks className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            accent="cyan"
            testId="section-header-opinion"
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("opinion")}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                      data-testid="button-rules-opinion"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => openSuggestModal(() => setOpinionSuggestOpen(true))}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-opinion"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <button
                  type="button"
                  onClick={() => openSnapScroll("opinion", displayOpinionPolls[0]?.id, "header-icon")}
                  className="md:hidden inline-flex shrink-0 items-center justify-center rounded-md p-1 text-cyan-600 dark:text-cyan-400 transition-colors hover:text-cyan-500 dark:hover:text-cyan-300 hover:bg-muted/40 active:opacity-80"
                  aria-label="Open immersive browse"
                  data-testid="button-snap-opinion"
                >
                  <Maximize2 className="h-5 w-5" aria-hidden />
                </button>
              </>
            }
          >
            <CategoryRowWithSearch
              searchValue={opinionPollsSearchQuery}
              onSearchChange={setOpinionPollsSearchQuery}
              placeholder="Search opinion polls..."
              testId="filter-opinion-search"
            >
              {opinionCategoryOptions.map((opt) => (
                <FilterChip
                  key={opt.value}
                  category={opt.value}
                  isActive={opinionPollsCategoryFilter === opt.value}
                  onClick={() => setOpinionPollsCategoryFilter(opt.value as FilterCategory)}
                  testIdPrefix="filter-opinion"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </CategoryRowWithSearch>
          </UnifiedSectionHeader>

          {opinionPollsLoading ? (
            <CardGridSkeleton count={3} />
          ) : displayOpinionPolls.length > 0 ? (
            <CardSection desktopLimit={6} gap="gap-5" testIdPrefix="section-opinion-polls">
              {displayOpinionPolls.map((poll: any) => (
                <div key={poll.id} role="button" tabIndex={0} onClick={(e) => handleCardEmptyTap(e, "opinion", poll.id)} onKeyDown={(e) => { if (e.key === "Enter") handleCardEmptyTap(e as any, "opinion", poll.id); }} className="h-full">
                  <OpinionPollCard
                    poll={poll}
                    onVote={voteOnOpinionPoll}
                    onRemoveVote={removeOpinionPollVote}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToDetail={poll.slug ? () => goOpinionDetail(poll.slug) : undefined}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("opinion", poll.id, "browse-button") : undefined}
                  />
                </div>
              ))}
            </CardSection>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <ListChecks className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No opinion polls available yet</p>
            </div>
          )}

          <div className="text-center mt-2 md:mt-6">
            <Button
              variant="ghost"
              onClick={() => openOverlay("opinion-polls")}
              className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
              data-testid="button-view-all-opinion-polls"
            >
              View all opinion polls
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* ZONE 2: Value Perception - Underrated/Overrated Section */}
        {(activeSection === "All" || activeSection === "Underrated/Overrated") && (
        <section id="vote-value" data-hash-anchor className="mb-10 scroll-mt-28">
          <UnifiedSectionHeader
            title="Overrated / Underrated "
            subtitle="overhyped or underappreciated?"
            icon={<BarChart3 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            accent="cyan"
            testId="section-header-value"
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("value")}
                      className="text-cyan-600 dark:text-cyan-400"
                      data-testid="button-rules-value"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => openSnapScroll("value", filteredValueCelebrities[0]?.id, "header-icon")}
                  className="md:hidden inline-flex shrink-0 items-center justify-center rounded-md p-1 text-cyan-600 dark:text-cyan-400 transition-colors hover:text-cyan-500 dark:hover:text-cyan-300 hover:bg-muted/40 active:opacity-80"
                  aria-label="Open immersive browse"
                  data-testid="button-snap-value"
                >
                  <Maximize2 className="h-5 w-5" aria-hidden />
                </button>
              </>
            }
          >
            <CategoryRowWithSearch
              searchValue={valuePerceptionSearchQuery}
              onSearchChange={setValuePerceptionSearchQuery}
              placeholder="Search celebrities..."
              testId="filter-value-search"
            >
              {valueCategoryOptions.map((opt) => (
                <FilterChip
                  key={opt.value}
                  category={opt.value}
                  isActive={valuePerceptionCategoryFilter === opt.value}
                  onClick={() => setValuePerceptionCategoryFilter(opt.value as FilterCategory)}
                  testIdPrefix="filter-value"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </CategoryRowWithSearch>
          </UnifiedSectionHeader>
          
          {valueLoading ? (
            <CardGridSkeleton count={3} />
          ) : filteredValueCelebrities.length > 0 ? (
            <CardSection desktopLimit={9} gap="gap-5" testIdPrefix="section-value">
              {filteredValueCelebrities.map((person) => (
                <div key={person.id} onClick={(e) => handleCardEmptyTap(e, "value", person.id)}>
                  <UnderratedOverratedCard 
                    person={person}
                    onVisitProfile={() => setLocation(`/person/${person.id}`)}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("value", person.id, "browse-button") : undefined}
                  />
                </div>
              ))}
            </CardSection>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No celebrities match your filter criteria.
            </div>
          )}

          <div className="text-center mt-2 md:mt-6">
            <Button
              variant="ghost"
              onClick={() => setLocation("/vote/value-ratings")}
              className="text-cyan-600 dark:text-cyan-400"
              data-testid="button-view-all-value"
            >
              View all rankings
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* GOVERNANCE HEADER DIVIDER - Shows between Zone 1 and Zone 3 */}
        {/* Show when: All, Induction Queue, or Curate Profile is selected */}
        {/* Hide when: Matchups or Sentiment Polls is selected */}
        {(activeSection === "All" || isGovernanceSection(activeSection)) && (
        <div className="relative overflow-hidden mb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent" />
          <div className="relative py-4">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2" data-testid="text-governance-title">
                Shape the VoxDex
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto mb-3">Vote on new inductees and curate profile images</p>
              <button
                onClick={() => setInfoModalOpen("governance")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hover:border-cyan-500/30 transition-all cursor-pointer"
                data-testid="button-governance-info"
              >
                <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                <span className="text-sm text-cyan-600 dark:text-cyan-400 font-medium">Community Governance</span>
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ZONE 3: Governance - Induction Queue Section */}
        {(activeSection === "All" || activeSection === "Induction Queue") && (
        <section id="vote-induction" data-hash-anchor className="mb-10 scroll-mt-28">
          <UnifiedSectionHeader
            title="The Induction Queue"
            subtitle="Who joins the leaderboard next"
            icon={<Vote className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            accent="cyan"
            testId="section-header-induction"
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("induction")}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                      data-testid="button-rules-induction"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => openSuggestModal(() => setInductionSuggestOpen(true))}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-induction"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <button
                  type="button"
                  onClick={() => openSnapScroll("induction", filteredCandidates[0]?.id, "header-icon")}
                  className="md:hidden inline-flex shrink-0 items-center justify-center rounded-md p-1 text-cyan-600 dark:text-cyan-400 transition-colors hover:text-cyan-500 dark:hover:text-cyan-300 hover:bg-muted/40 active:opacity-80"
                  aria-label="Open immersive browse"
                  data-testid="button-snap-induction"
                >
                  <Maximize2 className="h-5 w-5" aria-hidden />
                </button>
              </>
            }
            meta={
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border bg-slate-800/50 border-slate-700/60">
                  <Clock className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
                  <span className="text-slate-300">Ends in: {inductionCountdown}</span>
                </div>
                <div className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border bg-slate-800/50 border-slate-700/60">
                  <Star className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  <span className="text-slate-300">Top 1 will be inducted</span>
                </div>
              </div>
            }
          >
            <CategoryRowWithSearch
              searchValue={inductionSearchQuery}
              onSearchChange={setInductionSearchQuery}
              placeholder="Search candidates..."
              testId="filter-induction-search"
            >
              {inductionCategoryOptions.map((opt) => (
                <FilterChip
                  key={opt.value}
                  category={opt.value}
                  isActive={inductionCategoryFilter === opt.value}
                  onClick={() => setInductionCategoryFilter(opt.value as FilterCategory)}
                  testIdPrefix="filter-induction"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </CategoryRowWithSearch>
          </UnifiedSectionHeader>

          {inductionLoading ? (
            <CardGridSkeleton count={3} />
          ) : filteredCandidates.length > 0 ? (
            <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-induction">
              {filteredCandidates.map((candidate, index) => (
                <div key={candidate.id} onClick={(e) => handleCardEmptyTap(e, "induction", candidate.id)}>
                  <InductionCandidateCard
                    candidate={candidate}
                    rank={candidateRankById.get(candidate.id) ?? index + 1}
                    maxVotes={maxVotes}
                    isVoted={votedIds.has(candidate.id)}
                    onToggleVote={handleToggleVote}
                    onXPGain={() => { /* bursts now fire from vote mutation onSuccess */ }}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("induction", candidate.id, "browse-button") : undefined}
                  />
                </div>
              ))}
            </CardSection>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No candidates match your filter criteria.
            </div>
          )}

          <div className="text-center mt-2 md:mt-6 mb-6">
            <Button
              variant="ghost"
              onClick={() => openOverlay("induction")}
              className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
              data-testid="button-view-full-candidate-list"
            >
              View full candidate list
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* ZONE 3: Governance - Curate Profile Section */}
        {(activeSection === "All" || activeSection === "Curate Profile") && (
        <section id="vote-curate" data-hash-anchor className="mb-10 scroll-mt-28">
          <UnifiedSectionHeader
            title="Curate the Profile"
            subtitle="Help select their profile photo"
            icon={<Camera className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            accent="cyan"
            testId="section-header-curate"
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("curate")}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
                      data-testid="button-rules-curate"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => openSuggestModal(() => setCurateSuggestOpen(true))}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-curate"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <button
                  type="button"
                  onClick={() => openSnapScroll("curate", undefined, "header-icon")}
                  className="md:hidden inline-flex shrink-0 items-center justify-center rounded-md p-1 text-cyan-600 dark:text-cyan-400 transition-colors hover:text-cyan-500 dark:hover:text-cyan-300 hover:bg-muted/40 active:opacity-80"
                  aria-label="Open immersive browse"
                  data-testid="button-snap-curate"
                >
                  <Maximize2 className="h-5 w-5" aria-hidden />
                </button>
              </>
            }
          >
            <CategoryRowWithSearch
              searchValue={curateSearchQuery}
              onSearchChange={setCurateSearchQuery}
              placeholder="Search profiles..."
              testId="filter-curate-search"
            >
              {curateCategoryOptions.map((opt) => (
                <FilterChip
                  key={opt.value}
                  category={opt.value}
                  isActive={curateCategoryFilter === opt.value}
                  onClick={() => setCurateCategoryFilter(opt.value as FilterCategory)}
                  testIdPrefix="filter-curate"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </CategoryRowWithSearch>
          </UnifiedSectionHeader>

          <CurateSection
            categoryFilter={curateCategoryFilter}
            searchQuery={curateSearchQuery}
            onFilterCategory={handleCategoryPillFilter}
            categoryRaceMap={raceMap}
            leaderboardCategories={leaderboardCats}
            onBrowseFullScreen={isMobile ? (personId) => openSnapScroll("curate", personId, "browse-button") : undefined}
            onCardEmptyTap={isMobile ? (personId, e) => handleCardEmptyTap(e, "curate", personId) : undefined}
          />
        </section>
        )}

        <div className="text-center pb-8">
          <button
            type="button"
            onClick={() => voteOnboardingRef.current?.open()}
            className="text-sm text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
            data-testid="button-footer-how-it-works-vote"
          >
            <HelpCircle className="h-4 w-4 inline mr-1 align-text-bottom" />
            How it works
          </button>
        </div>
      </div>
      <Drawer.Root open={startPollModalOpen} onOpenChange={setStartPollModalOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]">
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="flex items-center justify-between px-4 pb-2">
              <div>
                <Drawer.Title className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  Suggest a Poll
                </Drawer.Title>
                <Drawer.Description className="text-xs text-muted-foreground mt-0.5">
                  Suggest a topic for the community to vote on.
                </Drawer.Description>
              </div>
              <button type="button" onClick={() => setStartPollModalOpen(false)} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors" aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Headline *</label>
                  <span className={`text-xs ${pollHeadline.length > 80 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                    {pollHeadline.length}/80
                  </span>
                </div>
                <Input
                  value={pollHeadline}
                  onChange={(e) => setPollHeadline(e.target.value.slice(0, 80))}
                  placeholder="e.g. Should AI be regulated?"
                  data-testid="input-poll-headline"
                />
              </div>
              <SuggestCategorySelect value={sentimentCategory} onChange={setSentimentCategory} data-testid="select-poll-category" />
              <div>
                <label className="text-sm font-medium mb-1 block">Subject (Entity) *</label>
                <HybridSubjectCombobox
                  value={pollEntitySearch}
                  onChange={setPollEntitySearch}
                  onSelect={(selection) => {
                    setPollEntitySearch(selection.value);
                    setPollSubjectType(selection.type);
                  }}
                  placeholder="Search celebrity or create custom topic..."
                  showCustomTopicOption={true}
                />
                {pollSubjectType && (
                  <div className={`mt-2 text-xs flex items-center gap-1.5 ${pollSubjectType === 'custom' ? 'text-violet-600 dark:text-violet-400' : 'text-cyan-600 dark:text-cyan-400'}`}>
                    {pollSubjectType === 'custom' ? (
                      <>
                        <Sparkles className="h-3 w-3" />
                        {CATEGORIES_OPEN.find(c => c.id === sentimentCategory)?.label ?? "Misc"}
                      </>
                    ) : (
                      <>
                        <User className="h-3 w-3" />
                        Celebrity
                      </>
                    )}
                  </div>
                )}
                {pollSubjectType === 'custom' && (
                  <div className="mt-3 p-3 rounded-lg border border-dashed border-amber-500/40 dark:border-amber-500/30 bg-amber-500/5">
                    <label className="text-sm font-medium mb-2 block text-amber-600 dark:text-amber-400">Topic Image (Optional)</label>
                    {pollSubjectImagePreview ? (
                      <div className="flex items-center gap-3">
                        <div className="h-16 w-16 rounded-md overflow-hidden border border-amber-500/40 dark:border-amber-500/30 bg-muted dark:bg-slate-800">
                          <img 
                            src={pollSubjectImagePreview} 
                            alt="Topic preview"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-muted-foreground truncate">{pollSubjectImage?.name}</p>
                          <button
                            onClick={() => {
                              setPollSubjectImage(null);
                              setPollSubjectImagePreview(null);
                            }}
                            className="text-xs text-red-600 dark:text-red-400 hover:underline mt-1"
                            data-testid="button-remove-poll-image"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <div 
                          onClick={() => pollFileInputRef.current?.click()}
                          className="flex items-center justify-center w-full h-20 rounded-md border border-dashed border-slate-600 bg-slate-800/30 cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/5 transition-all"
                          data-testid="button-upload-poll-image"
                        >
                          <div className="flex flex-col items-center gap-1 text-muted-foreground">
                            <ImageIcon className="h-6 w-6" />
                            <span className="text-xs">Click to upload image</span>
                          </div>
                        </div>
                        <input
                          ref={pollFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handlePollImageUpload}
                          className="hidden"
                          data-testid="input-poll-image"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <SuggestDurationPicker value={pollDuration} onChange={setPollDuration} customDate={pollCustomDate} onCustomDateChange={setPollCustomDate} testIdPrefix="poll" />
              <div>
                <label className="text-sm font-medium mb-1 block">Short description (max 140 characters)</label>
                <Input
                  value={pollDescription}
                  onChange={(e) => setPollDescription(e.target.value.slice(0, 140))}
                  placeholder="Brief context for voters..."
                  data-testid="input-poll-description"
                />
                <p className="text-xs text-muted-foreground mt-1">{pollDescription.length}/140</p>
              </div>
            </div>
            <div className="border-t border-border/40 px-4 py-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStartPollModalOpen(false)} data-testid="button-cancel-poll">Cancel</Button>
              <Button
                onClick={handlePollSubmit}
                disabled={isSuggestSubmitting || !pollHeadline || !pollEntitySearch}
                className="bg-cyan-500 text-white"
                data-testid="button-submit-poll"
              >
                {isSuggestSubmitting ? "Submitting…" : "Submit Poll"}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <Drawer.Root open={matchupSuggestOpen} onOpenChange={setMatchupSuggestOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]">
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="flex items-center justify-between px-4 pb-2">
              <div>
                <Drawer.Title className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Swords className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  Suggest a Matchup
                </Drawer.Title>
                <Drawer.Description className="text-xs text-muted-foreground mt-0.5">
                  Create an A vs B matchup for the community to vote on.
                </Drawer.Description>
              </div>
              <button type="button" onClick={() => setMatchupSuggestOpen(false)} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors" aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Headline *</label>
                  <span className={`text-xs ${matchupHeadline.length > 60 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                    {matchupHeadline.length}/60
                  </span>
                </div>
                <Input
                  value={matchupHeadline}
                  onChange={(e) => setMatchupHeadline(e.target.value.slice(0, 60))}
                  placeholder="e.g. Battle of the Brands"
                  data-testid="input-matchup-headline"
                />
              </div>
              <ContenderSelector
                value={matchupContenderA}
                onChange={setMatchupContenderA}
                label="Contender A *"
                placeholder="Search celebrity or enter name..."
                testIdPrefix="matchup-contender-a"
              />
              <ContenderSelector
                value={matchupContenderB}
                onChange={setMatchupContenderB}
                label="Contender B *"
                placeholder="Search celebrity or enter name..."
                testIdPrefix="matchup-contender-b"
              />
              <SuggestCategorySelect value={matchupCategory} onChange={setMatchupCategory} data-testid="select-matchup-category" />
            </div>
            <div className="border-t border-border/40 px-4 py-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMatchupSuggestOpen(false)} data-testid="button-cancel-matchup">Cancel</Button>
              <Button
                onClick={handleMatchupSuggestSubmit}
                disabled={
                  isSuggestSubmitting ||
                  !matchupHeadline ||
                  !matchupCategory ||
                  !matchupContenderA.type ||
                  !matchupContenderB.type ||
                  (matchupContenderA.type === 'custom' && !matchupContenderA.uploadedPreview) ||
                  (matchupContenderB.type === 'custom' && !matchupContenderB.uploadedPreview)
                }
                className="bg-cyan-500 text-white"
                data-testid="button-submit-matchup"
              >
                {isSuggestSubmitting ? "Submitting…" : "Submit Matchup"}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <Drawer.Root open={inductionSuggestOpen} onOpenChange={setInductionSuggestOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]">
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="flex items-center justify-between px-4 pb-2">
              <div>
                <Drawer.Title className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  Suggest a Candidate
                </Drawer.Title>
                <Drawer.Description className="text-xs text-muted-foreground mt-0.5">
                  Who are we missing? Suggest someone NEW to be added to VoxDex.
                </Drawer.Description>
              </div>
              <button type="button" onClick={() => setInductionSuggestOpen(false)} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors" aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Candidate Name *</label>
                <Input
                  value={suggestName}
                  onChange={(e) => setSuggestName(e.target.value)}
                  placeholder="Enter the person's name"
                  data-testid="input-induction-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Social/Profile URL *</label>
                <Input
                  value={suggestUrl}
                  onChange={(e) => setSuggestUrl(e.target.value)}
                  placeholder="https://twitter.com/... or https://instagram.com/..."
                  data-testid="input-induction-url"
                  className={suggestUrl && !suggestUrl.startsWith('http') ? 'border-red-500' : ''}
                />
                {suggestUrl && !suggestUrl.startsWith('http') ? (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">Please enter a valid URL starting with http:// or https://</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Required for verification</p>
                )}
              </div>
              <SuggestCategorySelect value={suggestCategory} onChange={setSuggestCategory} categories={CATEGORIES_LEADERBOARD} label="Category (optional)" data-testid="select-induction-category" />
              <div>
                <label className="text-sm font-medium mb-1 block">Why should they be on VoxDex? (optional)</label>
                <Input
                  value={suggestReason}
                  onChange={(e) => setSuggestReason(e.target.value)}
                  placeholder="Brief reason..."
                  data-testid="input-induction-reason"
                />
              </div>
            </div>
            <div className="border-t border-border/40 px-4 py-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setInductionSuggestOpen(false)} data-testid="button-cancel-induction">Cancel</Button>
              <Button
                onClick={handleInductionSuggestSubmit}
                disabled={isSuggestSubmitting || !suggestName || !suggestUrl || !suggestUrl.startsWith('http')}
                className="bg-cyan-500 text-white"
                data-testid="button-submit-induction"
              >
                {isSuggestSubmitting ? "Submitting…" : "Submit Suggestion"}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      {/* Curate Profile Suggest Drawer */}
      <Drawer.Root open={curateSuggestOpen} onOpenChange={setCurateSuggestOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]">
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="flex items-center justify-between px-4 pb-2">
              <div>
                <Drawer.Title className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Upload className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  Suggest a Profile Image
                </Drawer.Title>
                <Drawer.Description className="text-xs text-muted-foreground mt-0.5">
                  Upload a high-quality photo for a celebrity's profile.
                </Drawer.Description>
              </div>
              <button type="button" onClick={() => setCurateSuggestOpen(false)} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors" aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Who is this for? *</label>
                <HybridSubjectCombobox
                  value={curateCelebrity}
                  onChange={setCurateCelebrity}
                  onSelect={(selection) => {
                    setCurateCelebrity(selection.value);
                  }}
                  placeholder="Search celebrity..."
                  showCustomTopicOption={false}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Upload Image *</label>
                <div className="border-2 border-dashed border-slate-700 rounded-lg p-4 text-center hover:border-cyan-500/50 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCurateImageFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="curate-image-upload"
                    data-testid="input-curate-image-file"
                  />
                  <label htmlFor="curate-image-upload" className="cursor-pointer">
                    {curateImageFile ? (
                      <div className="flex items-center justify-center gap-2 text-cyan-600 dark:text-cyan-400">
                        <Check className="h-4 w-4" />
                        <span className="text-sm">{curateImageFile.name}</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Click to upload an image</p>
                        <p className="text-xs text-muted-foreground">PNG, JPG up to 5MB</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Source/Credit (optional)</label>
                <Input
                  value={curateImageSource}
                  onChange={(e) => setCurateImageSource(e.target.value)}
                  placeholder="Photographer name or source URL..."
                  data-testid="input-curate-image-source"
                />
                <p className="text-xs text-muted-foreground mt-1">Help us give proper attribution</p>
              </div>
            </div>
            <div className="border-t border-border/40 px-4 py-3 flex justify-end gap-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  setCurateSuggestOpen(false);
                  setCurateCelebrity("");
                  setCurateImageFile(null);
                  setCurateImageSource("");
                }}
                data-testid="button-cancel-curate"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCurateSuggestSubmit}
                disabled={isSuggestSubmitting || !curateCelebrity || !curateImageFile}
                className="bg-cyan-500 text-white"
                data-testid="button-submit-curate"
              >
                {isSuggestSubmitting ? "Uploading…" : "Submit Image"}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      {/* Suggest Opinion Poll Drawer */}
      <Drawer.Root open={opinionSuggestOpen} onOpenChange={setOpinionSuggestOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]">
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="flex items-center justify-between px-4 pb-2">
              <div>
                <Drawer.Title className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ListChecks className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  Suggest an Opinion Poll
                </Drawer.Title>
                <Drawer.Description className="text-xs text-muted-foreground mt-0.5">
                  Create a multi-option poll for the community to vote on.
                </Drawer.Description>
              </div>
              <button type="button" onClick={() => setOpinionSuggestOpen(false)} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors" aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Question / Title *</label>
                  <span className={`text-xs ${opinionSuggestTitle.length > 100 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                    {opinionSuggestTitle.length}/100
                  </span>
                </div>
                <Input
                  value={opinionSuggestTitle}
                  onChange={(e) => setOpinionSuggestTitle(e.target.value.slice(0, 100))}
                  placeholder="e.g. Who will win Album of the Year?"
                  data-testid="input-opinion-title"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Options * (min {OPINION_POLL_MIN_OPTIONS}, max {OPINION_POLL_MAX_OPTIONS})</label>
                  <span className="text-xs text-muted-foreground">{opinionSuggestOptions.length} options</span>
                </div>
                <div className="space-y-2">
                  {opinionSuggestOptions.map((opt, idx) => (
                    <OpinionOptionRow
                      key={idx}
                      value={opt}
                      onChange={(next) => {
                        const arr = [...opinionSuggestOptions];
                        arr[idx] = next;
                        setOpinionSuggestOptions(arr);
                      }}
                      onRemove={
                        opinionSuggestOptions.length > OPINION_POLL_MIN_OPTIONS
                          ? () => setOpinionSuggestOptions(opinionSuggestOptions.filter((_, i) => i !== idx))
                          : undefined
                      }
                      testIdPrefix="opinion"
                      index={idx}
                    />
                  ))}
                </div>
                {opinionSuggestOptions.length < OPINION_POLL_MAX_OPTIONS && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpinionSuggestOptions([...opinionSuggestOptions, { name: "" }])}
                    className="mt-2 text-cyan-600 dark:text-cyan-400"
                    data-testid="button-add-opinion-option"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Option
                  </Button>
                )}
              </div>
              <SuggestCategorySelect value={opinionSuggestCategory} onChange={setOpinionSuggestCategory} label="Category" data-testid="select-opinion-category" />
              <SuggestDurationPicker value={opinionSuggestDuration} onChange={setOpinionSuggestDuration} customDate={opinionSuggestCustomDate} onCustomDateChange={setOpinionSuggestCustomDate} testIdPrefix="opinion" />
              <div>
                <label className="text-sm font-medium mb-1 block">Short description (max 140 characters)</label>
                <Input
                  value={opinionSuggestDescription}
                  onChange={(e) => setOpinionSuggestDescription(e.target.value.slice(0, 140))}
                  placeholder="Brief context for voters..."
                  data-testid="input-opinion-description"
                />
                <p className="text-xs text-muted-foreground mt-1">{opinionSuggestDescription.length}/140</p>
              </div>
            </div>
            <div className="border-t border-border/40 px-4 py-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpinionSuggestOpen(false)} data-testid="button-cancel-opinion-suggest">Cancel</Button>
              <Button
                onClick={handleOpinionSuggestSubmit}
                disabled={isSuggestSubmitting || !opinionSuggestTitle || opinionSuggestOptions.filter(o => o.name.trim()).length < OPINION_POLL_MIN_OPTIONS}
                className="bg-cyan-500 text-white"
                data-testid="button-submit-opinion-suggest"
              >
                {isSuggestSubmitting ? "Submitting…" : "Submit Poll"}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      {(["voice", "matchups", "opinion", "value", "induction", "curate"] as const).map((key) => {
        const cfg = VOTE_RULES_STEPS[key];
        return (
          <StepModal
            key={key}
            open={rulesModalOpen === key}
            onClose={() => setRulesModalOpen(null)}
            steps={cfg.steps}
            ctaLabel={cfg.ctaLabel}
            accent={cfg.accent}
          />
        );
      })}
      <OnboardingDrawer
        ref={voteOnboardingRef}
        storageKey="authoridex_vote_welcome_seen"
        steps={VOTE_ONBOARDING_STEPS}
        toastLabel="New to voting?"
        lastStepCta="Cast Your First Vote"
        disableAutoToast={!!user}
      />
      <StepModal
        open={infoModalOpen === "governance"}
        onClose={() => setInfoModalOpen(null)}
        steps={VOTE_RULES_STEPS.governance.steps}
        ctaLabel={VOTE_RULES_STEPS.governance.ctaLabel}
        accent={VOTE_RULES_STEPS.governance.accent}
      />
      <AnimatePresence>
        {inductionOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
          >
            <ViewAllOverlayHeader
              onClose={closeOverlay}
              closeTestId="button-close-candidates-overlay"
              backTestId="button-back-candidates-overlay"
              className="flex items-center justify-between gap-2 p-4 border-b"
            >
              <h2 className="text-xl font-serif font-bold">All candidates</h2>
            </ViewAllOverlayHeader>
            
            <OverlayFilterBar
              value={inductionCategoryFilter}
              onChange={(v) => setInductionCategoryFilter(v as FilterCategory)}
              searchValue={inductionSearchQuery}
              onSearchChange={setInductionSearchQuery}
              categories={inductionCategoryOptions}
              allValue="all"
              placeholder="Search..."
              testIdPrefix="overlay-induction"
              variant="vote"
              user={user}
              onAuthRequired={handleAuthRequired}
            />
            
            <div ref={inductionScrollRef} onScroll={(e) => saveOverlayScroll("induction", e.currentTarget.scrollTop)} className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-7xl mx-auto">
                {filteredCandidates.map((candidate, index) => (
                  <InductionCandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    rank={candidateRankById.get(candidate.id) ?? index + 1}
                    maxVotes={maxVotes}
                    isVoted={votedIds.has(candidate.id)}
                    onToggleVote={handleToggleVote}
                    onXPGain={() => { /* bursts now fire from vote mutation onSuccess */ }}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("induction", candidate.id, "browse-button") : undefined}
                  />
                ))}
              </div>
              {filteredCandidates.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No candidates match your filter criteria.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {topicsOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
          >
            <ViewAllOverlayHeader
              onClose={closeOverlay}
              closeTestId="button-close-topics-overlay"
              backTestId="button-back-topics-overlay"
              className="flex items-center justify-between gap-2 p-4 border-b"
            >
              <h2 className="text-xl font-serif font-bold">All topics</h2>
            </ViewAllOverlayHeader>
            
            <OverlayFilterBar
              value={topicsCategoryFilter}
              onChange={(v) => setTopicsCategoryFilter(v as FilterCategory)}
              searchValue={topicsSearchQuery}
              onSearchChange={setTopicsSearchQuery}
              categories={topicsCategoryOptions}
              allValue="all"
              placeholder="Search..."
              testIdPrefix="overlay-topics"
              variant="vote"
              user={user}
              onAuthRequired={handleAuthRequired}
            />
            
            <div ref={topicsScrollRef} onScroll={(e) => saveOverlayScroll("topics", e.currentTarget.scrollTop)} className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
                {displayTopics.map((topic) => (
                  <DiscourseCard
                    key={topic.id}
                    topic={topic}
                    onVote={(choice) => handleDiscourseVote(topic.id, choice)}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToPollDetail={topic.slug ? () => goSentimentDetail(topic.slug) : undefined}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("sentiment", topic.id, "browse-button") : undefined}
                  />
                ))}
              </div>
              {displayTopics.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No topics match your filter criteria.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {matchupsOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
          >
            <ViewAllOverlayHeader
              onClose={closeOverlay}
              closeTestId="button-close-matchups-overlay"
              backTestId="button-back-matchups-overlay"
              className="flex items-center justify-between gap-2 p-4 border-b border-cyan-500/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-cyan-500/15 dark:bg-cyan-500/10 flex shrink-0 items-center justify-center">
                  <Swords className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                <h2 className="text-xl font-serif font-bold truncate">All Matchups</h2>
              </div>
            </ViewAllOverlayHeader>
            
            <OverlayFilterBar
              value={matchupsCategoryFilter}
              onChange={(v) => setMatchupsCategoryFilter(v as FilterCategory)}
              searchValue={matchupsSearchQuery}
              onSearchChange={setMatchupsSearchQuery}
              categories={matchupsCategoryOptions}
              allValue="all"
              placeholder="Search..."
              testIdPrefix="overlay-matchups"
              variant="vote"
              user={user}
              onAuthRequired={handleAuthRequired}
            />
            
            <div ref={matchupsScrollRef} onScroll={(e) => saveOverlayScroll("matchups", e.currentTarget.scrollTop)} className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
                {displayMatchups.map((matchup) => (
                  <VersusCard
                    key={matchup.id}
                    matchup={matchup}
                    userVote={matchupUserVotes[matchup.id] || null}
                    onVote={handleMatchupVote}
                    onRemoveVote={handleMatchupRemoveVote}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToDetail={matchup.slug ? () => goMatchupDetail(matchup.slug!) : undefined}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("matchups", matchup.id, "browse-button") : undefined}
                  />
                ))}
              </div>
              {displayMatchups.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No matchups match your filter criteria.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {opinionPollsOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
          >
            <ViewAllOverlayHeader
              onClose={closeOverlay}
              closeTestId="button-close-opinion-polls-overlay"
              backTestId="button-back-opinion-polls-overlay"
              className="flex items-center justify-between gap-2 p-4 border-b border-cyan-500/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-cyan-500/15 dark:bg-cyan-500/10 flex shrink-0 items-center justify-center">
                  <ListChecks className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                <h2 className="text-xl font-serif font-bold truncate">All Opinion Polls</h2>
              </div>
            </ViewAllOverlayHeader>
            
            <OverlayFilterBar
              value={opinionPollsCategoryFilter}
              onChange={(v) => setOpinionPollsCategoryFilter(v as FilterCategory)}
              searchValue={opinionPollsSearchQuery}
              onSearchChange={setOpinionPollsSearchQuery}
              categories={opinionCategoryOptions}
              allValue="all"
              placeholder="Search..."
              testIdPrefix="overlay-opinion"
              variant="vote"
              user={user}
              onAuthRequired={handleAuthRequired}
            />
            
            <div ref={opinionPollsScrollRef} onScroll={(e) => saveOverlayScroll("opinion-polls", e.currentTarget.scrollTop)} className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
                {displayOpinionPolls.map((poll: any) => (
                  <OpinionPollCard
                    key={poll.id}
                    poll={poll}
                    onVote={voteOnOpinionPoll}
                    onRemoveVote={removeOpinionPollVote}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToDetail={poll.slug ? () => goOpinionDetail(poll.slug) : undefined}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("opinion", poll.id, "browse-button") : undefined}
                  />
                ))}
              </div>
              {displayOpinionPolls.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No opinion polls match your filter criteria.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {valuePerceptionOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
          >
            <ViewAllOverlayHeader
              onClose={closeOverlay}
              closeTestId="button-close-value-overlay"
              backTestId="button-back-value-overlay"
              className="flex items-center justify-between gap-2 p-4 border-b border-amber-500/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-amber-500/15 dark:bg-amber-500/10 flex shrink-0 items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <h2 className="text-xl font-serif font-bold truncate">Underrated / Overrated</h2>
              </div>
            </ViewAllOverlayHeader>
            
            <OverlayFilterBar
              value={valuePerceptionCategoryFilter}
              onChange={(v) => setValuePerceptionCategoryFilter(v as FilterCategory)}
              searchValue={valuePerceptionSearchQuery}
              onSearchChange={setValuePerceptionSearchQuery}
              categories={valueCategoryOptions}
              allValue="all"
              placeholder="Search..."
              testIdPrefix="overlay-value"
              variant="vote"
              user={user}
              onAuthRequired={handleAuthRequired}
            />
            
            <div ref={valuePerceptionScrollRef} onScroll={(e) => saveOverlayScroll("value-perception", e.currentTarget.scrollTop)} className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
                {filteredValueCelebrities.map((person) => (
                  <UnderratedOverratedCard 
                    key={person.id} 
                    person={person}
                    onVisitProfile={() => {
                      applyOverlayState(undefined);
                      window.history.replaceState({}, "");
                      setLocation(`/person/${person.id}`);
                    }}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onBrowseFullScreen={isMobile ? () => openSnapScroll("value", person.id, "browse-button") : undefined}
                  />
                ))}
              </div>
              {filteredValueCelebrities.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No celebrities match your filter criteria.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Snap Scroll Overlays (mobile only) */}
      {isMobile && (
        <>
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "matchups"}
            onClose={closeSnapScroll}
            sectionType="matchups"
            items={matchupSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setMatchupSuggestOpen(true))}
            renderCard={(item) => {
              const m = matchups.find(x => x.id === item.id);
              if (!m) return null;
              return (
                <VersusCard
                  matchup={m}
                  userVote={matchupUserVotes[m.id] || null}
                  onVote={handleMatchupVote}
                  onRemoveVote={handleMatchupRemoveVote}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                  onNavigateToDetail={m.slug ? () => goMatchupDetail(m.slug!) : undefined}
                />
              );
            }}
          />
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "sentiment"}
            onClose={closeSnapScroll}
            sectionType="sentiment"
            items={sentimentSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setStartPollModalOpen(true))}
            renderCard={(item) => {
              const t = dbPolls.find((x: any) => x.id === item.id);
              if (!t) return null;
              return (
                <DiscourseCard
                  topic={t}
                  onVote={(choice) => handleDiscourseVote(t.id, choice)}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                  onNavigateToPollDetail={t.slug ? () => goSentimentDetail(t.slug) : undefined}
                />
              );
            }}
          />
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "opinion"}
            onClose={closeSnapScroll}
            sectionType="opinion"
            items={opinionSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setOpinionSuggestOpen(true))}
            renderCard={(item) => {
              const p = opinionPolls.find((x: any) => x.id === item.id);
              if (!p) return null;
              return (
                <OpinionPollCard
                  poll={p}
                  onVote={voteOnOpinionPoll}
                  onRemoveVote={removeOpinionPollVote}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                  onNavigateToDetail={p.slug ? () => goOpinionDetail(p.slug) : undefined}
                />
              );
            }}
          />
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "value"}
            onClose={closeSnapScroll}
            sectionType="value"
            commentMode="person"
            items={valueSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setCurateSuggestOpen(true))}
            renderCard={(item) => {
              const person = filteredValueCelebrities.find((p: any) => p.id === item.id);
              if (!person) return null;
              return (
                <UnderratedOverratedCard
                  person={person}
                  onVisitProfile={() => setLocation(`/person/${person.id}`)}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                />
              );
            }}
          />
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "induction"}
            onClose={closeSnapScroll}
            sectionType="induction"
            commentMode="none"
            items={inductionSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setInductionSuggestOpen(true))}
            renderCard={(item) => {
              const idx = filteredCandidates.findIndex((c: any) => c.id === item.id);
              const candidate = idx >= 0 ? filteredCandidates[idx] : null;
              if (!candidate) return null;
              return (
                <InductionCandidateCard
                  candidate={candidate}
                  rank={candidateRankById.get(candidate.id) ?? idx + 1}
                  maxVotes={maxVotes}
                  isVoted={votedIds.has(candidate.id)}
                  onToggleVote={handleToggleVote}
                  onXPGain={() => {}}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                />
              );
            }}
          />
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "curate"}
            onClose={closeSnapScroll}
            sectionType="curate"
            commentMode="person"
            items={curateSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setCurateSuggestOpen(true))}
            renderCard={(item) => {
              const person: CuratePerson = { id: item.id, name: item.title, category: item.category, imageUrl: null };
              return (
                <CurateProfileCardComponent
                  person={person}
                  onVote={() => {}}
                  onComplete={() => {}}
                  onViewResults={() => {}}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                />
              );
            }}
          />
        </>
      )}
    </div>
  );
}
