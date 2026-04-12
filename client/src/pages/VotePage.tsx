import { useState, useEffect, useRef, useMemo, useCallback, Children } from "react";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { handleImageError } from "@/lib/imageResolver";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardGridSkeleton } from "@/components/ui/card-skeletons";
import { Badge } from "@/components/ui/badge";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { UserMenu } from "@/components/UserMenu";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useUserStats } from "@/hooks/useGamification";
import { 
  ArrowLeft, 
  ArrowUp,
  ArrowDown,
  Plus, 
  Vote,
  Users,
  User,
  Clock,
  Sparkles,
  Camera,
  Zap,
  Crown,
  MessageSquare,
  Search,
  ThumbsDown,
  ThumbsUp,
  Minus,
  ChevronDown,
  Star,
  Check,
  X,
  ChevronRight,
  HelpCircle,
  Calendar,
  Swords,
  UserPlus,
  ImageIcon,
  Globe,
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
  type LucideIcon
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions } from "@/lib/signInToVoteToast";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import { motion, AnimatePresence } from "framer-motion";
import { getFilterCategories, getMarketCategoryLabel, normalizeMarketCategory, type FilterCategory } from "@shared/constants";
import type { TrendingPerson } from "@shared/schema";
import { CurateSection } from "@/components/curate";
import { UnderratedOverratedCard } from "@/components/UnderratedOverratedCard";
import { CardSection } from "@/components/CardSection";
import { VersusCard, type VersusCardMatchup } from "@/components/matchups/VersusCard";
import { OpinionPollCard } from "@/components/opinion-polls/OpinionPollCard";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { FilterDropdown } from "@/components/FilterDropdown";
import { OverlayFilterBar } from "@/components/OverlayFilterBar";
import { ViewAllOverlayHeader } from "@/components/ViewAllOverlayHeader";
import { OnboardingDrawer, type OnboardingStep, type OnboardingDrawerHandle } from "@/components/OnboardingDrawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { UnifiedSectionHeader } from "@/components/UnifiedSectionHeader";
import { WindowedDotIndicator } from "@/components/WindowedDotIndicator";
import { ScrollMaskedChipRow } from "@/components/ScrollMaskedChipRow";
import { VoteSnapScrollView, type SnapItem, type SnapSectionType } from "@/components/snap-scroll/VoteSnapScrollView";
import { navigateWithVoteList } from "@/lib/voteListNavigation";

const VOTE_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    icon: Swords,
    heading: "Pick Your Side",
    description: "Head-to-head matchups, trending topics, and opinion polls \u2014 your vote decides who rises.",
    gradient: "from-cyan-500 to-teal-600",
    glow: "shadow-cyan-500/25",
  },
  {
    icon: BarChart3,
    heading: "Shape the Rankings",
    description: "Every vote feeds real data into the index. Your opinion directly moves the needle.",
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

const VOTE_CATEGORIES = [
  { value: "All", label: "All Categories" },
  { value: "Favorites", label: "Favorites" },
  { value: "Trending", label: "Trending" },
  { value: "Tech", label: "Tech" },
  { value: "Business", label: "Business" },
  { value: "Politics", label: "Politics" },
  { value: "Music", label: "Music" },
  { value: "Sports", label: "Sports" },
  { value: "Film & TV", label: "Film & TV" },
  { value: "Gaming", label: "Gaming" },
  { value: "Creator", label: "Creator" },
  { value: "Comedy", label: "Comedy" },
  { value: "Food & Drink", label: "Food & Drink" },
  { value: "Lifestyle", label: "Lifestyle" },
];

const VOTE_CATEGORIES_WITH_CUSTOM = [
  ...VOTE_CATEGORIES,
  { value: "misc", label: "Misc" },
];

const mockCelebrityList = [
  "Taylor Swift", "Elon Musk", "Keanu Reeves", "BeyoncÃ©", "Dwayne Johnson",
  "Rihanna", "LeBron James", "Kim Kardashian", "Justin Bieber", "Ariana Grande",
  "Cristiano Ronaldo", "Lionel Messi", "Drake", "Selena Gomez", "Kylie Jenner",
  "Billie Eilish", "Bad Bunny", "Post Malone", "The Weeknd", "Zendaya",
  "Tom Holland", "TimothÃ©e Chalamet", "Margot Robbie", "Ryan Reynolds", "Dua Lipa",
  "Harry Styles", "Olivia Rodrigo", "Ice Spice", "Travis Scott", "SZA"
];

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

const DURATION_PRESETS = [
  { label: "No Deadline", value: "none" },
  { label: "1 Week", value: "1week" },
  { label: "1 Month", value: "1month" },
  { label: "Custom", value: "custom" }
] as const;

interface XPFloater {
  id: number;
  x: number;
  y: number;
  amount: number;
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
      className="relative p-5 transition-all duration-200 h-full min-h-[390px] md:min-h-[300px] flex flex-col overflow-hidden border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl"
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
          <span className="text-slate-400">{candidate.votes.toLocaleString('en-US')} votes</span>
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
  const timeoutRef1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Fetch celebrity images for this person
  const { data: images = [], isLoading } = useQuery<CelebrityImage[]>({
    queryKey: ['/api/people', poll.personId, 'images'],
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
  const voteMutation = useMutation({
    mutationFn: async ({ imageId, direction }: { imageId: string; direction: 'up' | 'down' }) => {
      const response = await apiRequest('POST', `/api/people/${poll.personId}/images/${imageId}/vote`, { direction });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/people', poll.personId, 'images'] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedApiError(error)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        const parsed = parseVoteError(error);
        toast({
          title: "Couldn't record vote",
          description: parsed.message,
          variant: "destructive",
          countdown: parsed.retryAfter,
        });
      }
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef1.current) clearTimeout(timeoutRef1.current);
      if (timeoutRef2.current) clearTimeout(timeoutRef2.current);
    };
  }, []);

  const handlePick = async (choice: 'a' | 'b') => {
    if (!selectedChoice && imageA && imageB) {
      setSelectedChoice(choice);
      setShowShimmer(true);

      const selectedImage = choice === 'a' ? imageA : imageB;
      const otherImage = choice === 'a' ? imageB : imageA;
      try {
        await voteMutation.mutateAsync({ imageId: selectedImage.id, direction: "up" });
        await voteMutation.mutateAsync({ imageId: otherImage.id, direction: "down" });
        onVote();
        timeoutRef1.current = setTimeout(() => {
          setShowShimmer(false);
          setShowResults(true);
        }, 600);
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
}: {
  topic: any;
  onVote: (choice: 'support' | 'neutral' | 'oppose') => void;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
  /** When set, detail links use history voteList + client navigation (Vote page). */
  onNavigateToPollDetail?: () => void;
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

  const handleVote = (choice: 'support' | 'neutral' | 'oppose') => {
    if (!voted) {
      setVoted(choice);
      onVote(choice);
    }
  };

  const handleChangeVote = () => {
    setVoted(null);
  };

  return (
    <div className="relative group h-full">
      <div className="absolute -inset-[1px] rounded-xl border border-[#EFEFEF]/50 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 hidden md:block" />
    <Card 
      className="relative pt-6 px-5 pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full min-h-[390px] md:min-h-[300px] flex flex-col border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl"
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
          data-testid={`badge-category-${topic.id}`}
        />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
        <span>{topic.totalVotes.toLocaleString('en-US')} votes</span>
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
            <ThumbsUp className="h-4 w-4 text-[#00C853] shrink-0" />
            <span className="text-sm text-[#00C853] w-16 shrink-0">Support</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                style={{ width: `${topic.approvePercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.approvePercent}%</span>
          </div>
          
          <div className="flex items-center gap-3">
            <Minus className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="text-sm text-slate-400 w-16 shrink-0">Neutral</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-slate-400 rounded-full transition-all duration-500"
                style={{ width: `${topic.neutralPercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.neutralPercent}%</span>
          </div>
          
          <div className="flex items-center gap-3">
            <ThumbsDown className="h-4 w-4 text-[#FF0000] shrink-0" />
            <span className="text-sm text-[#FF0000] w-16 shrink-0">Oppose</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                style={{ width: `${topic.disapprovePercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.disapprovePercent}%</span>
          </div>
          
          <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/10">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              <span>{topic.totalVotes.toLocaleString('en-US')} total votes</span>
            </div>
            <div 
              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                voted === 'support' 
                  ? 'bg-[#00C853]/10 border-[#00C853]/40 text-[#00C853]' 
                  : voted === 'oppose'
                  ? 'bg-[#FF0000]/10 border-[#FF0000]/40 text-[#FF0000]'
                  : 'bg-slate-500/10 border-slate-500/40 text-slate-500 dark:text-slate-400'
              }`}
              data-testid={`badge-voted-${topic.id}`}
            >
              You voted
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

function parseVoteError(err: unknown): { message: string; retryAfter?: number } {
  const retryAfter = (err as any)?.retryAfter as number | undefined;
  if (err instanceof Error && err.message) {
    const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
    if (jsonMatch) {
      try {
        const j = JSON.parse(jsonMatch[1]) as { error?: string };
        if (j.error) return { message: j.error, retryAfter };
      } catch {
        /* ignore */
      }
    }
    if (err.message.startsWith("429")) return { message: "Too many votes. Please slow down.", retryAfter: retryAfter ?? 60 };
    return { message: err.message, retryAfter };
  }
  return { message: "Something went wrong. Please try again." };
}

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

function XPFloaterAnimation({ floater, onComplete }: { floater: XPFloater; onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      className="fixed z-[100] pointer-events-none font-bold text-lg"
      initial={{ opacity: 1, y: 0, scale: 1 }}
      animate={{ opacity: 0, y: -60, scale: 1.2 }}
      transition={{ duration: 1, ease: "easeOut" }}
      style={{ left: floater.x, top: floater.y }}
    >
      <span className="text-cyan-600 dark:text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
        +{floater.amount} XP
      </span>
    </motion.div>
  );
}

type SubjectSelection = {
  type: 'celebrity' | 'custom';
  value: string;
};

function HybridSubjectCombobox({ 
  value, 
  onChange,
  onSelect,
  placeholder = "Search celebrity or create custom topic...",
  showCustomTopicOption = true
}: { 
  value: string; 
  onChange: (value: string) => void;
  onSelect: (selection: SubjectSelection) => void;
  placeholder?: string;
  showCustomTopicOption?: boolean;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const filtered = mockCelebrityList.filter(name => 
      name.toLowerCase().includes(value.toLowerCase())
    ).slice(0, 6);
    setFilteredSuggestions(filtered);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current && 
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectCelebrity = (name: string) => {
    onSelect({ type: 'celebrity', value: name });
    setShowSuggestions(false);
  };

  const handleSelectCustomTopic = (topic: string) => {
    onSelect({ type: 'custom', value: topic });
    setShowSuggestions(false);
  };

  const hasMatchingCelebrities = filteredSuggestions.length > 0;
  const showFallbackCustom = value.length >= 2 && !hasMatchingCelebrities;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          className="pl-10"
          data-testid="input-subject-search"
        />
      </div>
      
      <AnimatePresence>
        {showSuggestions && (
          <motion.div 
            ref={suggestionsRef}
            className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {showCustomTopicOption && (
              <button
                onClick={() => handleSelectCustomTopic(value || "Custom Topic")}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-cyan-500/15 dark:hover:bg-cyan-500/10 transition-colors flex items-center gap-2 border-b border-border bg-gradient-to-r from-cyan-500/5 to-transparent"
                data-testid="option-create-custom-topic"
              >
                <div className="h-7 w-7 rounded-md bg-cyan-500/25 dark:bg-cyan-500/20 border border-cyan-500/40 dark:border-cyan-500/30 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">Create Custom Topic</span>
                  <span className="text-xs text-muted-foreground">Not about a specific celebrity</span>
                </div>
              </button>
            )}

            {hasMatchingCelebrities ? (
              <>
                <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border">
                  Celebrities
                </div>
                {filteredSuggestions.map((name, index) => (
                  <button
                    key={name}
                    onClick={() => handleSelectCelebrity(name)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    data-testid={`suggestion-celebrity-${index}`}
                  >
                    <PersonAvatar name={name} avatar="" size="sm" />
                    <span>{name}</span>
                  </button>
                ))}
              </>
            ) : showFallbackCustom ? (
              <button
                onClick={() => handleSelectCustomTopic(value)}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                data-testid="option-use-as-custom"
              >
                <div className="h-7 w-7 rounded-md bg-violet-500/25 dark:bg-violet-500/20 border border-violet-500/40 dark:border-violet-500/30 flex items-center justify-center">
                  <Plus className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex flex-col">
                  <span>Use "<span className="font-medium text-violet-600 dark:text-violet-400">{value}</span>" as Custom Topic</span>
                  <span className="text-xs text-muted-foreground">No matching celebrities found</span>
                </div>
              </button>
            ) : value.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                Type to search celebrities or create a custom topic
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CelebrityAutocomplete({ 
  value, 
  onChange,
  onSelect 
}: { 
  value: string; 
  onChange: (value: string) => void;
  onSelect: (name: string) => void;
}) {
  const handleSelect = (selection: SubjectSelection) => {
    onSelect(selection.value);
  };

  return (
    <HybridSubjectCombobox
      value={value}
      onChange={onChange}
      onSelect={handleSelect}
      placeholder="Search celebrity name..."
      showCustomTopicOption={false}
    />
  );
}

// Contender Selection for Matchup modal - supports celebrities with auto-images and custom entries with uploads
type ContenderSelection = {
  type: 'celebrity' | 'custom' | null;
  name: string;
  celebrityId?: string;
  imageUrl?: string;
  uploadedFile?: File;
  uploadedPreview?: string;
};

function ContenderSelector({ 
  value, 
  onChange,
  label,
  placeholder = "Search celebrity or enter custom...",
  testIdPrefix
}: { 
  value: ContenderSelection;
  onChange: (selection: ContenderSelection) => void;
  label: string;
  placeholder?: string;
  testIdPrefix: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch trending people for suggestions
  const { data: trendingResponse } = useQuery<{ data: TrendingPerson[], totalCount: number, hasMore: boolean }>({
    queryKey: ['/api/trending?sort=rank&limit=100'],
  });
  const celebrities = trendingResponse?.data || [];

  // Filter celebrities based on search query
  const filteredCelebrities = useMemo(() => {
    if (!searchQuery) return celebrities.slice(0, 6);
    return celebrities
      .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .slice(0, 6);
  }, [celebrities, searchQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current && 
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectCelebrity = (celebrity: TrendingPerson) => {
    onChange({
      type: 'celebrity',
      name: celebrity.name,
      celebrityId: celebrity.id,
      imageUrl: celebrity.avatar || undefined,
      uploadedFile: undefined,
      uploadedPreview: undefined
    });
    setSearchQuery("");
    setShowSuggestions(false);
  };

  const handleSelectCustom = () => {
    if (searchQuery.length >= 2) {
      onChange({
        type: 'custom',
        name: searchQuery,
        celebrityId: undefined,
        imageUrl: undefined,
        uploadedFile: undefined,
        uploadedPreview: undefined
      });
      setShowSuggestions(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        onChange({
          ...value,
          uploadedFile: file,
          uploadedPreview: event.target?.result as string
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClear = () => {
    onChange({
      type: null,
      name: '',
      celebrityId: undefined,
      imageUrl: undefined,
      uploadedFile: undefined,
      uploadedPreview: undefined
    });
    setSearchQuery("");
  };

  const hasMatchingCelebrities = filteredCelebrities.length > 0;
  const showCustomOption = searchQuery.length >= 2 && !filteredCelebrities.some(c => c.name.toLowerCase() === searchQuery.toLowerCase());

  // If a selection is made, show the selected state
  if (value.type) {
    const displayImage = value.type === 'celebrity' ? value.imageUrl : value.uploadedPreview;
    const needsUpload = value.type === 'custom' && !value.uploadedPreview;

    return (
      <div className="space-y-2">
        <label className="text-sm font-medium mb-1 block">{label}</label>
        <div className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30">
          {displayImage ? (
            <div className="h-10 w-10 rounded-md overflow-hidden shrink-0 border border-border">
              <img src={displayImage} alt={value.name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-md bg-slate-700/50 flex items-center justify-center shrink-0 border border-border">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{value.name}</p>
            <p className="text-xs text-muted-foreground">
              {value.type === 'celebrity' ? (
                <span className="text-cyan-600 dark:text-cyan-400">VoxDex Celebrity</span>
              ) : (
                <span className="text-violet-600 dark:text-violet-400">Custom Contender</span>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="shrink-0 h-8 w-8"
            data-testid={`${testIdPrefix}-clear`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Upload button for custom contenders */}
        {needsUpload && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-amber-500/60 dark:border-amber-500/50 bg-amber-500/5">
            <Upload className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-600 dark:text-amber-400">Image required for custom contenders</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="ml-auto border-amber-500/60 dark:border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 dark:hover:bg-amber-500/10"
              data-testid={`${testIdPrefix}-upload-btn`}
            >
              Upload Image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileUpload}
              className="hidden"
              data-testid={`${testIdPrefix}-file-input`}
            />
          </div>
        )}
      </div>
    );
  }

  // Show search input
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium mb-1 block">{label}</label>
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            ref={inputRef}
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            className="pl-10"
            data-testid={`${testIdPrefix}-search`}
          />
        </div>
        
        <AnimatePresence>
          {showSuggestions && (
            <motion.div 
              ref={suggestionsRef}
              className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              {/* Custom contender option */}
              {showCustomOption && (
                <button
                  onClick={handleSelectCustom}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-violet-500/15 dark:hover:bg-violet-500/10 transition-colors flex items-center gap-2 border-b border-border bg-gradient-to-r from-violet-500/5 to-transparent"
                  data-testid={`${testIdPrefix}-custom-option`}
                >
                  <div className="h-8 w-8 rounded-md bg-violet-500/25 dark:bg-violet-500/20 border border-violet-500/40 dark:border-violet-500/30 flex items-center justify-center">
                    <Plus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex flex-col">
                    <span>Use "<span className="font-medium text-violet-600 dark:text-violet-400">{searchQuery}</span>" as Custom Contender</span>
                    <span className="text-xs text-muted-foreground">Image upload required</span>
                  </div>
                </button>
              )}

              {/* Celebrity suggestions */}
              {hasMatchingCelebrities ? (
                <>
                  <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border">
                    VoxDex Celebrities
                  </div>
                  {filteredCelebrities.map((celebrity, index) => (
                    <button
                      key={celebrity.id}
                      onClick={() => handleSelectCelebrity(celebrity)}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-3"
                      data-testid={`${testIdPrefix}-celebrity-${index}`}
                    >
                      {celebrity.avatar ? (
                        <div className="h-8 w-8 rounded-md overflow-hidden shrink-0 border border-border">
                          <img src={celebrity.avatar} alt={celebrity.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <PersonAvatar name={celebrity.name} avatar="" size="sm" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{celebrity.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {celebrity.category} â€¢ Auto-image
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs bg-cyan-500/15 dark:bg-cyan-500/10 text-cyan-500 dark:text-cyan-300 border-cyan-500/40 dark:border-cyan-400/30">
                        <Check className="h-3 w-3 mr-1" />
                        Auto
                      </Badge>
                    </button>
                  ))}
                </>
              ) : searchQuery.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                  Type to search VoxDex celebrities or enter a custom name
                </div>
              ) : searchQuery.length < 2 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                  Keep typing to search...
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const VOTE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  All: LayoutGrid,
  Favorites: Star,
  Trending: Flame,
  Tech: Cpu,
  Politics: Landmark,
  Business: Briefcase,
  Music: Music2,
  Sports: Trophy,
  "Film & TV": Clapperboard,
  Gaming: Gamepad2,
  Creator: Video,
  Comedy: Laugh,
  "Food & Drink": UtensilsCrossed,
  Lifestyle: Heart,
  misc: Sparkles,
};

function FilterChip({ 
  category, 
  isActive, 
  onClick, 
  testIdPrefix,
  user,
  onAuthRequired
}: { 
  category: string; 
  isActive: boolean; 
  onClick: () => void; 
  testIdPrefix: string;
  user: any;
  onAuthRequired: () => void;
}) {
  const isFavorites = category === "Favorites";
  const isCustomTopic = category === "misc";
  const isIconOnly = isFavorites;
  const IconComponent = VOTE_CATEGORY_ICONS[category] || LayoutGrid;
  
  const handleClick = () => {
    if (isFavorites && !user) {
      onAuthRequired();
      return;
    }
    onClick();
  };

  const getDisplayLabel = () => {
    if (isFavorites) return "Favorites";
    if (isCustomTopic) return "Misc";
    return category;
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
      aria-label={isIconOnly ? getDisplayLabel() : undefined}
    >
      <IconComponent className="h-3.5 w-3.5" />
      {isIconOnly ? (
        <span className="hidden md:inline">{getDisplayLabel()}</span>
      ) : (
        getDisplayLabel()
      )}
    </button>
  );
}

const OVERLAY_SCROLL_PREFIX = "overlay_scroll_";
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
  const { toast } = useToast();
  const { user } = useAuth();
  const voteOnboardingRef = useRef<OnboardingDrawerHandle>(null);
  const { favorites, favoriteIds, isAuthenticated } = useFavorites();
  const raceMap = useCategoryRaceMap();
  const leaderboardCats = useLeaderboardCategories();

  const handleAuthRequired = () => {
    setLocation("/login");
  };
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
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
  const [countdown, setCountdown] = useState("2d 14h 32m");

  const { data: userStats } = useUserStats(!!user);
  const xp = userStats?.xpPoints ?? 0;
  const rank = userStats?.rank?.name ?? "Citizen";
  const [xpFloaters, setXpFloaters] = useState<XPFloater[]>([]);
  const floaterIdRef = useRef(0);
  
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

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

  const inductionVoteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/vote/induction/${id}/vote`),
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/me/induction-votes'] });
    },
    onError: (err, candidateId) => {
      hapticError();
      setVotedIds((prev) => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
      if (isUnauthorizedApiError(err)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        const parsed = parseVoteError(err);
        toast({
          title: "Couldn't record vote",
          description: parsed.message,
          variant: "destructive",
          countdown: parsed.retryAfter,
        });
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

  const [inductionCategoryFilter, setInductionCategoryFilter] = useState<FilterCategory>("All");
  const [inductionSearchQuery, setInductionSearchQuery] = useState("");
  const [inductionOverlayOpen, setInductionOverlayOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("section") === "induction") return true;
    return window.history.state?.overlay === "induction";
  });
  const prevInductionOverlayOpenRef = useRef(inductionOverlayOpen);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [topicsCategoryFilter, setTopicsCategoryFilter] = useState<FilterCategory>("All");
  const [topicsSearchQuery, setTopicsSearchQuery] = useState("");
  const [topicsOverlayOpen, setTopicsOverlayOpen] = useState(() => window.history.state?.overlay === "topics");
  const [startPollModalOpen, setStartPollModalOpen] = useState(false);
  
  const [matchupsCategoryFilter, setMatchupsCategoryFilter] = useState<FilterCategory>("All");
  const [matchupsSearchQuery, setMatchupsSearchQuery] = useState("");
  const [matchupsOverlayOpen, setMatchupsOverlayOpen] = useState(() => window.history.state?.overlay === "matchups");
  const [pollHeadline, setPollHeadline] = useState("");
  const [pollCategory, setPollCategory] = useState("");
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
  const [curateCategoryFilter, setCurateCategoryFilter] = useState<FilterCategory>("All");
  const [globalVoteSearchQuery, setGlobalVoteSearchQuery] = useState("");
  const [globalCategoryFilter, setGlobalCategoryFilter] = useState<FilterCategory>("All");

  const handleCategoryPillFilter = useCallback((category: string) => {
    setGlobalCategoryFilter(getMarketCategoryLabel(category) as FilterCategory);
  }, []);
  
  const [valuePerceptionOverlayOpen, setValuePerceptionOverlayOpen] = useState(() => window.history.state?.overlay === "value-perception");
  const [valuePerceptionCategoryFilter, setValuePerceptionCategoryFilter] = useState<FilterCategory>("All");
  const [valuePerceptionSearchQuery, setValuePerceptionSearchQuery] = useState("");


  const [opinionPollsCategoryFilter, setOpinionPollsCategoryFilter] = useState<FilterCategory>("All");
  const [opinionPollsSearchQuery, setOpinionPollsSearchQuery] = useState("");
  const [opinionPollsOverlayOpen, setOpinionPollsOverlayOpen] = useState(() => window.history.state?.overlay === "opinion-polls");
  const [opinionSuggestOpen, setOpinionSuggestOpen] = useState(false);
  const [opinionSuggestTitle, setOpinionSuggestTitle] = useState("");
  const [opinionSuggestDescription, setOpinionSuggestDescription] = useState("");
  const [opinionSuggestCategory, setOpinionSuggestCategory] = useState("misc");
  const [opinionSuggestDuration, setOpinionSuggestDuration] = useState<string>("none");
  const [opinionSuggestCustomDate, setOpinionSuggestCustomDate] = useState("");
  const [opinionSuggestOptions, setOpinionSuggestOptions] = useState<string[]>(["", "", ""]);

  const inductionScrollRef = useRef<HTMLDivElement>(null);
  const topicsScrollRef = useRef<HTMLDivElement>(null);
  const matchupsScrollRef = useRef<HTMLDivElement>(null);
  const opinionPollsScrollRef = useRef<HTMLDivElement>(null);
  const valuePerceptionScrollRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();
  const [snapScrollOpen, setSnapScrollOpen] = useState(false);
  const [snapScrollSection, setSnapScrollSection] = useState<SnapSectionType>("matchups");
  const [snapScrollInitialId, setSnapScrollInitialId] = useState<string | undefined>();

  const enrichedCandidates = dbInductionCandidates;
  
  const filteredCandidates = enrichedCandidates.filter(c => {
    const matchesCategory = inductionCategoryFilter === "All" || inductionCategoryFilter === "Trending" || c.category === inductionCategoryFilter;
    const matchesSearch = c.name.toLowerCase().includes(inductionSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a, b) => b.votes - a.votes);
  
  const sortedCandidates = [...enrichedCandidates].sort((a, b) => b.votes - a.votes);
  const maxVotes = sortedCandidates[0]?.votes || 1;
  const filteredMaxVotes = filteredCandidates[0]?.votes || 1;

  const { data: dbPolls = [], isLoading: pollsLoading } = useQuery<any[]>({
    queryKey: ['/api/trending-polls'],
    staleTime: 60 * 1000,
  });

  const { data: opinionPolls = [], isLoading: opinionPollsLoading } = useQuery<any[]>({
    queryKey: ['/api/opinion-polls'],
    staleTime: 60 * 1000,
  });

  const filteredTopics = dbPolls.filter((t: any) => {
    const matchesCategory = topicsCategoryFilter === "All" || topicsCategoryFilter === "Trending" || t.category === topicsCategoryFilter;
    const matchesSearch = (t.headline ?? '').toLowerCase().includes(topicsSearchQuery.toLowerCase()) ||
                         (t.description || '').toLowerCase().includes(topicsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a: any, b: any) => topicsCategoryFilter === "Trending" ? (b.totalVotes ?? 0) - (a.totalVotes ?? 0) : 0);

  const filteredOpinionPolls = opinionPolls.filter((p: any) => {
    const matchesCategory = opinionPollsCategoryFilter === "All" || opinionPollsCategoryFilter === "Trending" || (p.category || '').toLowerCase() === opinionPollsCategoryFilter.toLowerCase();
    const matchesSearch = (p.title || '').toLowerCase().includes(opinionPollsSearchQuery.toLowerCase()) ||
                         (p.description || '').toLowerCase().includes(opinionPollsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

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
      userValueVote: 'underrated' | 'overrated' | 'fairly_rated' | null;
    }>;
  }
  
  const { data: valueCelebritiesData, isLoading: valueLoading } = useQuery<ValueLeaderboardResponse>({
    queryKey: ['/api/leaderboard?tab=value&limit=100'],
    staleTime: 60 * 1000,
  });
  
  const valueCelebrities = valueCelebritiesData?.data || [];
  
  const filteredValueCelebrities = valueCelebrities.filter(c => {
    const matchesCategory = valuePerceptionCategoryFilter === "All" || valuePerceptionCategoryFilter === "Trending" || c.category === valuePerceptionCategoryFilter;
    const matchesSearch = !valuePerceptionSearchQuery || c.name.toLowerCase().includes(valuePerceptionSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a: any, b: any) => valuePerceptionCategoryFilter === "Trending" ? ((b.totalVotes ?? 0) - (a.totalVotes ?? 0)) : 0);
  
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
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['/api/matchups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/matchups/user-votes'] });
      const isChange = !!variables.previousVote;
      toast({
        title: isChange ? "Vote changed!" : "Vote recorded!",
        description: isChange ? "Your Matchup vote has been updated." : "Your Matchup vote has been counted.",
      });
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
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        const parsed = parseVoteError(error);
        if (parsed.retryAfter) {
          setRateLimitedUntil(Date.now() + parsed.retryAfter * 1000);
        }
        toast({
          title: "Couldn't record vote",
          description: parsed.message,
          variant: "destructive",
          countdown: parsed.retryAfter,
        });
      }
    },
  });
  
  const matchupRemoveVoteMutation = useMutation({
    mutationFn: async ({ matchupId }: { matchupId: string; previousVote: string }) => {
      const response = await apiRequest('POST', `/api/matchups/${matchupId}/vote`, { remove: true });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/matchups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/matchups/user-votes'] });
      toast({
        title: "Vote removed",
        description: "Your Matchup vote has been removed.",
      });
    },
    onError: (error: any, variables) => {
      setLocalMatchupVotes((prev: Record<string, string>) => ({ ...prev, [variables.matchupId]: variables.previousVote }));
      if (isUnauthorizedApiError(error)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        const parsed = parseVoteError(error);
        if (parsed.retryAfter) {
          setRateLimitedUntil(Date.now() + parsed.retryAfter * 1000);
        }
        toast({
          title: "Couldn't record vote",
          description: parsed.message,
          variant: "destructive",
          countdown: parsed.retryAfter,
        });
      }
    },
  });

  const matchupRateLimited = !!(rateLimitedUntil && Date.now() < rateLimitedUntil);

  const handleMatchupVote = (matchupId: string, option: 'option_a' | 'option_b' | 'neutral', event?: React.MouseEvent) => {
    if (matchupRateLimited) return;
    const previousVote = matchupUserVotes[matchupId] || null;
    setLocalMatchupVotes((prev: Record<string, string>) => ({ ...prev, [matchupId]: option }));
    matchupVoteMutation.mutate({ matchupId, option, previousVote });
    if (event && !previousVote) {
      addXP(15, event);
    }
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
    const matchesCategory = matchupsCategoryFilter === "All" || matchupsCategoryFilter === "Trending" || f.category === matchupsCategoryFilter;
    const matchesSearch = (f.title ?? '').toLowerCase().includes(matchupsSearchQuery.toLowerCase()) ||
                         (f.optionAText ?? '').toLowerCase().includes(matchupsSearchQuery.toLowerCase()) ||
                         (f.optionBText ?? '').toLowerCase().includes(matchupsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch && f.isActive;
  }).sort((a: any, b: any) => matchupsCategoryFilter === "Trending" ? ((b.totalVotes ?? 0) - (a.totalVotes ?? 0)) : 0);

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

  const openSnapScroll = useCallback((section: SnapSectionType, itemId?: string) => {
    if (!isMobile) return;
    setSnapScrollSection(section);
    setSnapScrollInitialId(itemId);
    setSnapScrollOpen(true);
    window.history.pushState({ overlay: `snap-${section}` }, "");
  }, [isMobile]);

  const closeSnapScroll = useCallback(() => {
    setSnapScrollOpen(false);
    window.history.back();
  }, []);

  const handleCardEmptyTap = useCallback((e: React.MouseEvent, section: SnapSectionType, itemId: string) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    const wrapper = e.currentTarget as HTMLElement;
    // Walk up from target but stop at the wrapper — excludes interactive descendants
    // without matching the wrapper's own role="button" attribute.
    let node: HTMLElement | null = target;
    while (node && node !== wrapper) {
      if (node.matches('button, a, input, textarea, select, [role="button"], [data-interactive]')) {
        return;
      }
      node = node.parentElement;
    }
    e.stopPropagation();
    openSnapScroll(section, itemId);
  }, [isMobile, openSnapScroll]);

  useEffect(() => {
    if (prevInductionOverlayOpenRef.current && !inductionOverlayOpen) {
      setInductionSearchQuery("");
    }
    prevInductionOverlayOpenRef.current = inductionOverlayOpen;
  }, [inductionOverlayOpen]);

  useEffect(() => {
    if (inductionOverlayOpen || topicsOverlayOpen || suggestModalOpen || startPollModalOpen || matchupsOverlayOpen || inductionSuggestOpen || matchupSuggestOpen || valuePerceptionOverlayOpen || opinionPollsOverlayOpen || snapScrollOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [inductionOverlayOpen, topicsOverlayOpen, suggestModalOpen, startPollModalOpen, matchupsOverlayOpen, inductionSuggestOpen, matchupSuggestOpen, valuePerceptionOverlayOpen, opinionPollsOverlayOpen, snapScrollOpen]);

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

  const addXP = (amount: number, event?: React.MouseEvent) => {
    const x = event ? event.clientX - 40 : window.innerWidth / 2;
    const y = event ? event.clientY - 20 : 100;
    
    const newFloater: XPFloater = {
      id: floaterIdRef.current++,
      x,
      y,
      amount
    };
    
    setXpFloaters(prev => [...prev, newFloater]);
    queryClient.invalidateQueries({ queryKey: ['/api/gamification/stats'] });
  };

  const removeFloater = (id: number) => {
    setXpFloaters(prev => prev.filter(f => f.id !== id));
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        const parts = prev.match(/(\d+)d (\d+)h (\d+)m/);
        if (parts) {
          let days = parseInt(parts[1]);
          let hours = parseInt(parts[2]);
          let mins = parseInt(parts[3]);
          mins--;
          if (mins < 0) { mins = 59; hours--; }
          if (hours < 0) { hours = 23; days--; }
          if (days < 0) return "0d 0h 0m";
          return `${days}d ${hours}h ${mins}m`;
        }
        return prev;
      });
    }, 60000);
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
    if (!user) {
      toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      return;
    }
    if (votedIds.has(candidateId)) return;
    setVotedIds(prev => {
      const newSet = new Set(prev);
      newSet.add(candidateId);
      return newSet;
    });
    inductionVoteMutation.mutate(candidateId);
  };

  const handleInductionXP = (event: React.MouseEvent) => {
    addXP(30, event);
  };


  const discourseVoteMutation = useMutation({
    mutationFn: async ({ slug, choice }: { slug: string; choice: string }) => {
      const res = await apiRequest('POST', `/api/polls/${slug}/vote`, { choice });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trending-polls'] });
      queryClient.invalidateQueries({ queryKey: ['/api/gamification/stats'] });
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/trending-polls'] });
      if (isUnauthorizedApiError(error)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        const parsed = parseVoteError(error);
        toast({
          title: "Couldn't record vote",
          description: parsed.message,
          variant: "destructive",
          countdown: parsed.retryAfter,
        });
      }
    },
  });

  const handleDiscourseVote = (topicId: string, choice: 'support' | 'neutral' | 'oppose', event?: React.MouseEvent) => {
    if (!user) {
      toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      return;
    }
    const topic = dbPolls.find((t: any) => t.id === topicId);
    if (topic?.slug) {
      discourseVoteMutation.mutate({ slug: topic.slug, choice });
    }
    addXP(25, event as React.MouseEvent);
  };

  const handleSuggestSubmit = () => {
    if (suggestName && suggestCategory) {
      setSuggestModalOpen(false);
      setSuggestName("");
      setSuggestCategory("");
      setSuggestReason("");
      setSuggestUrl("");
      toast({
        title: "Suggestion submitted",
        description: "Thanks - your suggestion was submitted for review.",
      });
    }
  };

  const handlePollSubmit = async () => {
    if (!pollHeadline || !pollEntitySearch) return;
    setIsSuggestSubmitting(true);
    try {
      await apiRequest("POST", "/api/suggestions", {
        type: "sentiment_poll",
        payload: {
          headline: pollHeadline,
          subjectText: pollEntitySearch,
          subjectType: pollSubjectType ?? undefined,
          // TODO: replace with user-selected category in Phase 1 when the Suggest a
          // Poll modal gets a category picker. Hardcoded to 'misc' for now.
          category: "misc",
          description: pollDescription || undefined,
          timeline: (pollDuration as "no_deadline" | "1_week" | "1_month" | "custom") || "no_deadline",
          deadlineAt: pollDuration === "custom" ? pollCustomDate || undefined : undefined,
        },
      });
      setStartPollModalOpen(false);
      setPollHeadline("");
      setPollCategory("");
      setPollDescription("");
      setPollEntitySearch("");
      setPollSubjectType(null);
      setPollSubjectImage(null);
      setPollSubjectImagePreview(null);
      setPollDuration("none");
      setPollCustomDate("");
      toast({
        title: "Poll suggested!",
        description: "We'll review it shortly. You earned 5 XP!",
      });
    } catch (err: any) {
      toast({
        title: "Submission failed",
        description: err?.message ?? "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handleMatchupSuggestSubmit = async () => {
    setIsSuggestSubmitting(true);
    try {
      await apiRequest("POST", "/api/suggestions", {
        type: "matchup",
        payload: {
          title: matchupHeadline,
          category: matchupCategory,
          optionAText: matchupContenderA.name,
          optionBText: matchupContenderB.name,
          personAId: matchupContenderA.type === "celebrity" ? matchupContenderA.celebrityId : undefined,
          personBId: matchupContenderB.type === "celebrity" ? matchupContenderB.celebrityId : undefined,
          optionAImage: matchupContenderA.type === "celebrity" ? matchupContenderA.imageUrl : undefined,
          optionBImage: matchupContenderB.type === "celebrity" ? matchupContenderB.imageUrl : undefined,
        },
      });
      setMatchupHeadline("");
      setMatchupContenderA({ type: null, name: "" });
      setMatchupContenderB({ type: null, name: "" });
      setMatchupCategory("");
      setMatchupSuggestOpen(false);
      toast({
        title: "Matchup suggested!",
        description: "We'll review it shortly. You earned 5 XP!",
      });
    } catch (err: any) {
      toast({
        title: "Submission failed",
        description: err?.message ?? "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handleInductionSuggestSubmit = async () => {
    setIsSuggestSubmitting(true);
    try {
      await apiRequest("POST", "/api/suggestions", {
        type: "induction",
        payload: {
          displayName: suggestName,
          socialUrl: suggestUrl,
          category: suggestCategory || undefined,
          reason: suggestReason || undefined,
        },
      });
      setSuggestName("");
      setSuggestUrl("");
      setSuggestCategory("");
      setSuggestReason("");
      setInductionSuggestOpen(false);
      toast({
        title: "Candidate suggested!",
        description: "We'll review it shortly. You earned 5 XP!",
      });
    } catch (err: any) {
      toast({
        title: "Submission failed",
        description: err?.message ?? "Something went wrong. Please try again.",
        variant: "destructive",
      });
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
      await apiRequest("POST", "/api/suggestions", {
        type: "profile_image",
        payload: {
          personName: curateCelebrity,
          imageUrl,
          sourceCredit: curateImageSource || undefined,
        },
      });
      setCurateCelebrity("");
      setCurateImageFile(null);
      setCurateImageSource("");
      setCurateSuggestOpen(false);
      toast({
        title: "Image suggested!",
        description: "We'll review it shortly. You earned 5 XP!",
      });
    } catch (err: any) {
      toast({
        title: "Submission failed",
        description: err?.message ?? "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSuggestSubmitting(false);
    }
  };

  const handleOpinionSuggestSubmit = async () => {
    const filledOptions = opinionSuggestOptions.filter((o) => o.trim());
    if (filledOptions.length < 3) {
      toast({
        title: "Not enough options",
        description: "Please provide at least 3 options.",
        variant: "destructive",
      });
      return;
    }
    setIsSuggestSubmitting(true);
    try {
      await apiRequest("POST", "/api/suggestions", {
        type: "opinion_poll",
        payload: {
          title: opinionSuggestTitle,
          description: opinionSuggestDescription || undefined,
          category: opinionSuggestCategory,
          timeline: (opinionSuggestDuration as "no_deadline" | "1_week" | "1_month" | "custom") || "no_deadline",
          deadlineAt: opinionSuggestDuration === "custom" ? opinionSuggestCustomDate || undefined : undefined,
          options: filledOptions.map((name) => ({ name })),
        },
      });
      setOpinionSuggestTitle("");
      setOpinionSuggestDescription("");
      setOpinionSuggestOptions(["", "", ""]);
      setOpinionSuggestCategory("misc");
      setOpinionSuggestDuration("none");
      setOpinionSuggestCustomDate("");
      setOpinionSuggestOpen(false);
      toast({
        title: "Poll suggested!",
        description: "We'll review it shortly. You earned 5 XP!",
      });
    } catch (err: any) {
      toast({
        title: "Submission failed",
        description: err?.message ?? "Something went wrong. Please try again.",
        variant: "destructive",
      });
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
      <AnimatePresence>
        {xpFloaters.map(floater => (
          <XPFloaterAnimation 
            key={floater.id} 
            floater={floater} 
            onComplete={() => removeFloater(floater.id)} 
          />
        ))}
      </AnimatePresence>
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
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
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
            {user && (
              <button
                type="button"
                onClick={cycleMyVotesFilter}
                className={`flex items-center gap-1.5 md:hidden ${
                  myVotesFilter === "show-mine"
                    ? "text-cyan-600 dark:text-cyan-400"
                    : myVotesFilter === "hide-mine"
                      ? "text-amber-500"
                      : "text-muted-foreground"
                }`}
                aria-label="Cycle votes filter"
              >
                {myVotesFilter === "hide-mine" ? (
                  <EyeOff className="h-[14px] w-[14px]" />
                ) : (
                  <Vote className="h-[14px] w-[14px]" />
                )}
                <span className="text-sm">{myVotesCount}</span>
              </button>
            )}
            <UserMenu />
          </div>
        </div>
      </header>
      <div 
        className="sticky top-16 z-40 bg-background/80 backdrop-blur-xl border-b"
        data-testid="section-toggles-container"
      >
            <div className="container mx-auto px-4 py-3 max-w-7xl flex items-center gap-3">
          <ScrollMaskedChipRow className="pb-1 relative flex-1 min-w-0">
            {SECTION_TOGGLES.map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit ${
                  activeSection === section
                    ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
                }`}
                data-testid={`toggle-section-${section.toLowerCase().replace(/['\s]/g, '-')}`}
              >
                {section === "Matchups" && <Swords className="h-4 w-4" />}
                {section === "Sentiment Polls" && <MessageSquare className="h-4 w-4" />}
                {section === "Opinion Polls" && <Vote className="h-4 w-4" />}
                {section === "Underrated/Overrated" && <BarChart3 className="h-4 w-4" />}
                {section === "Induction Queue" && <UserPlus className="h-4 w-4" />}
                {section === "Curate Profile" && <ImageIcon className="h-4 w-4" />}
                {section}
              </button>
            ))}
            {user && (
              <button
                type="button"
                onClick={cycleMyVotesFilter}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit md:hidden ${
                  myVotesFilter === "show-mine"
                    ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20"
                    : myVotesFilter === "hide-mine"
                      ? "bg-amber-500/15 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/50 dark:border-amber-500/40"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
                }`}
                data-testid="toggle-my-votes-pill"
              >
                {myVotesFilter === "hide-mine" ? (
                  <EyeOff className="h-4 w-4 shrink-0" />
                ) : (
                  <Vote className="h-4 w-4 shrink-0" />
                )}
                {myVotesFilter === "hide-mine" ? `Hide (${myVotesCount})` : `Votes (${myVotesCount})`}
              </button>
            )}
          </ScrollMaskedChipRow>
          {user && (
            <Button
              variant={myVotesFilter === "show-mine" ? "default" : "outline"}
              size="sm"
              onClick={cycleMyVotesFilter}
              className={`whitespace-nowrap shrink-0 hidden md:inline-flex ${
                myVotesFilter === "show-mine"
                  ? "bg-cyan-600 hover:bg-cyan-700 text-white dark:bg-cyan-600 dark:hover:bg-cyan-500"
                  : myVotesFilter === "hide-mine"
                    ? "border-amber-500/60 text-amber-600 dark:text-amber-500 hover:bg-amber-500/10"
                    : ""
              }`}
              data-testid="toggle-my-votes"
            >
              {myVotesFilter === "hide-mine" ? (
                <EyeOff className="h-3.5 w-3.5 mr-1.5" />
              ) : (
                <Vote className="h-3.5 w-3.5 mr-1.5" />
              )}
              {myVotesFilter === "hide-mine"
                ? `Hide Votes (${myVotesCount})`
                : `My Votes (${myVotesCount})`}
            </Button>
          )}
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 max-w-7xl pt-[5px] pb-[5px]">
        {/* ZONE 1: Public Opinion - Sentiment Polls Section (First) */}
        {(activeSection === "All" || activeSection === "Sentiment Polls") && (
        <section className="mb-10 mt-[5px]">
          <UnifiedSectionHeader
            title="Sentiment Polls"
            subtitle="Weigh in on current events"
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
                  onClick={() => setStartPollModalOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-poll"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setStartPollModalOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-poll-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            }
          >
            <ScrollMaskedChipRow>
              {getFilterCategories(true).map((cat) => (
                <FilterChip
                  key={cat}
                  category={cat}
                  isActive={topicsCategoryFilter === cat}
                  onClick={() => setTopicsCategoryFilter(cat as FilterCategory)}
                  testIdPrefix="filter-topics"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </ScrollMaskedChipRow>
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
        <section className="mb-10">
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
                  onClick={() => setMatchupSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-matchup"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setMatchupSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-matchup-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            }
          >
            <ScrollMaskedChipRow>
              {getFilterCategories(true).map((cat) => (
                <FilterChip
                  key={cat}
                  category={cat}
                  isActive={matchupsCategoryFilter === cat}
                  onClick={() => setMatchupsCategoryFilter(cat as FilterCategory)}
                  testIdPrefix="filter-matchups"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </ScrollMaskedChipRow>
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
        <section className="mb-10">
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
                  onClick={() => setOpinionSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-opinion"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setOpinionSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-opinion-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            }
          >
            <ScrollMaskedChipRow>
              {getFilterCategories(true).map((cat) => (
                <FilterChip
                  key={cat}
                  category={cat}
                  isActive={opinionPollsCategoryFilter === cat}
                  onClick={() => setOpinionPollsCategoryFilter(cat as FilterCategory)}
                  testIdPrefix="filter-opinion"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </ScrollMaskedChipRow>
          </UnifiedSectionHeader>

          {opinionPollsLoading ? (
            <CardGridSkeleton count={3} />
          ) : displayOpinionPolls.length > 0 ? (
            <CardSection desktopLimit={6} gap="gap-5" testIdPrefix="section-opinion-polls">
              {displayOpinionPolls.map((poll: any) => (
                <div key={poll.id} role="button" tabIndex={0} onClick={(e) => handleCardEmptyTap(e, "opinion", poll.id)} onKeyDown={(e) => { if (e.key === "Enter") handleCardEmptyTap(e as any, "opinion", poll.id); }} className="h-full">
                  <OpinionPollCard
                    poll={poll}
                    onVote={async (pollSlug, optionId) => {
                      await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { optionId });
                      queryClient.invalidateQueries({ queryKey: ['/api/opinion-polls'] });
                    }}
                    onRemoveVote={async (pollSlug) => {
                      await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { remove: true });
                      queryClient.invalidateQueries({ queryKey: ['/api/opinion-polls'] });
                    }}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToDetail={poll.slug ? () => goOpinionDetail(poll.slug) : undefined}
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
        <section className="mb-10">
          <UnifiedSectionHeader
            title="Overrated / Underrated "
            subtitle="overhyped or underappreciated?"
            icon={<BarChart3 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
            accent="cyan"
            testId="section-header-value"
            actions={
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
            }
          >
            <ScrollMaskedChipRow>
              {getFilterCategories(true).map((cat) => (
                <FilterChip
                  key={cat}
                  category={cat}
                  isActive={valuePerceptionCategoryFilter === cat}
                  onClick={() => setValuePerceptionCategoryFilter(cat as FilterCategory)}
                  testIdPrefix="filter-value"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </ScrollMaskedChipRow>
          </UnifiedSectionHeader>
          
          {valueLoading ? (
            <CardGridSkeleton count={3} />
          ) : filteredValueCelebrities.length > 0 ? (
            <CardSection desktopLimit={9} gap="gap-5" testIdPrefix="section-value">
              {filteredValueCelebrities.map((person) => (
                <UnderratedOverratedCard 
                  key={person.id} 
                  person={person}
                  onVisitProfile={() => setLocation(`/person/${person.id}`)}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                />
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
        <section className="mb-10">
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
                  onClick={() => setInductionSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-induction"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setInductionSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-induction-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            }
            meta={
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border bg-slate-800/50 border-slate-700/60">
                  <Clock className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
                  <span className="text-slate-300">Ends in: {countdown}</span>
                </div>
                <div className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border bg-slate-800/50 border-slate-700/60">
                  <Star className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  <span className="text-slate-300">Top 1 will be inducted</span>
                </div>
              </div>
            }
          >
            <ScrollMaskedChipRow>
              {getFilterCategories(false).map((cat) => (
                <FilterChip
                  key={cat}
                  category={cat}
                  isActive={inductionCategoryFilter === cat}
                  onClick={() => setInductionCategoryFilter(cat as FilterCategory)}
                  testIdPrefix="filter-induction"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </ScrollMaskedChipRow>
          </UnifiedSectionHeader>

          {inductionLoading ? (
            <CardGridSkeleton count={3} />
          ) : filteredCandidates.length > 0 ? (
            <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-induction">
              {filteredCandidates.map((candidate, index) => (
                <InductionCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  rank={index + 1}
                  maxVotes={filteredMaxVotes}
                  isVoted={votedIds.has(candidate.id)}
                  onToggleVote={handleToggleVote}
                  onXPGain={handleInductionXP}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                />
              ))}
            </CardSection>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No candidates match your filter criteria.
            </div>
          )}

          <div className="text-center mb-6">
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
        <section className="mb-10">
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
                  onClick={() => setCurateSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-curate"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setCurateSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/25 dark:hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-curate-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            }
          >
            <ScrollMaskedChipRow>
              {getFilterCategories(false).map((cat) => (
                <FilterChip
                  key={cat}
                  category={cat}
                  isActive={curateCategoryFilter === cat}
                  onClick={() => setCurateCategoryFilter(cat as FilterCategory)}
                  testIdPrefix="filter-curate"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </ScrollMaskedChipRow>
          </UnifiedSectionHeader>

          <CurateSection categoryFilter={curateCategoryFilter} onFilterCategory={handleCategoryPillFilter} categoryRaceMap={raceMap} leaderboardCategories={leaderboardCats} />
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
      <Dialog open={startPollModalOpen} onOpenChange={setStartPollModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              Suggest a Poll
            </DialogTitle>
            <DialogDescription>
              Suggest a topic for the community to vote on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
            <div>
              <label className="text-sm font-medium mb-1 block">Subject (Entity) *</label>
              <HybridSubjectCombobox
                value={pollEntitySearch}
                onChange={setPollEntitySearch}
                onSelect={(selection) => {
                  setPollEntitySearch(selection.value);
                  setPollSubjectType(selection.type);
                  if (selection.type === 'custom') {
                    setPollCategory('misc');
                  }
                }}
                placeholder="Search celebrity or create custom topic..."
                showCustomTopicOption={true}
              />
              {pollSubjectType && (
                <div className={`mt-2 text-xs flex items-center gap-1.5 ${pollSubjectType === 'custom' ? 'text-violet-600 dark:text-violet-400' : 'text-cyan-600 dark:text-cyan-400'}`}>
                  {pollSubjectType === 'custom' ? (
                    <>
                      <Sparkles className="h-3 w-3" />
                      Misc
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
            <div>
              <label className="text-sm font-medium mb-1 block">Timeline</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setPollDuration(preset.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      pollDuration === preset.value
                        ? "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                        : "bg-muted/50 border-border/60 text-muted-foreground hover:border-foreground/30 dark:bg-slate-800/30 dark:border-slate-700/40 dark:text-slate-400 dark:hover:border-slate-600"
                    }`}
                    data-testid={`poll-duration-${preset.value}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {pollDuration === "custom" && (
                <Input
                  type="datetime-local"
                  value={pollCustomDate}
                  onChange={(e) => setPollCustomDate(e.target.value)}
                  className="mt-2"
                  data-testid="input-poll-custom-date"
                />
              )}
            </div>
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
          <div className="flex justify-end gap-2">
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
        </DialogContent>
      </Dialog>
      <Dialog open={matchupSuggestOpen} onOpenChange={setMatchupSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              Suggest a Matchup
            </DialogTitle>
            <DialogDescription>
              Create an A vs B matchup for the community to vote on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
            <div>
              <label className="text-sm font-medium mb-1 block">Category *</label>
              <Select value={matchupCategory} onValueChange={setMatchupCategory}>
                <SelectTrigger data-testid="select-matchup-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Music">Music</SelectItem>
                  <SelectItem value="Tech">Tech</SelectItem>
                  <SelectItem value="Creator">Creator</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Politics">Politics</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="misc">Misc</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
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
        </DialogContent>
      </Dialog>
      <Dialog open={inductionSuggestOpen} onOpenChange={setInductionSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              Suggest a Candidate
            </DialogTitle>
            <DialogDescription>
              Who are we missing? Suggest someone NEW to be added to VoxDex.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
            <div>
              <label className="text-sm font-medium mb-1 block">Category (optional)</label>
              <Select value={suggestCategory} onValueChange={setSuggestCategory}>
                <SelectTrigger data-testid="select-induction-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Music">Music</SelectItem>
                  <SelectItem value="Tech">Tech</SelectItem>
                  <SelectItem value="Creator">Creator</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Politics">Politics</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          <div className="flex justify-end gap-2">
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
        </DialogContent>
      </Dialog>
      {/* Curate Profile Suggest Modal */}
      <Dialog open={curateSuggestOpen} onOpenChange={setCurateSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              Suggest a Profile Image
            </DialogTitle>
            <DialogDescription>
              Upload a high-quality photo for a celebrity's profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
          <div className="flex justify-end gap-2">
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
        </DialogContent>
      </Dialog>
      {/* Suggest Opinion Poll Modal */}
      <Dialog open={opinionSuggestOpen} onOpenChange={setOpinionSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              Suggest an Opinion Poll
            </DialogTitle>
            <DialogDescription>
              Create a multi-option poll for the community to vote on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
                <label className="text-sm font-medium">Options * (min 3, max 20)</label>
                <span className="text-xs text-muted-foreground">{opinionSuggestOptions.length} options</span>
              </div>
              <div className="space-y-2">
                {opinionSuggestOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/25 dark:bg-cyan-500/20 flex items-center justify-center shrink-0">
                      <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">{idx + 1}</span>
                    </div>
                    <Input
                      value={opt}
                      onChange={(e) => {
                        const updated = [...opinionSuggestOptions];
                        updated[idx] = e.target.value;
                        setOpinionSuggestOptions(updated);
                      }}
                      placeholder={`Option ${idx + 1}`}
                      className="flex-1"
                      data-testid={`input-opinion-option-${idx}`}
                    />
                    {opinionSuggestOptions.length > 3 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const updated = opinionSuggestOptions.filter((_, i) => i !== idx);
                          setOpinionSuggestOptions(updated);
                        }}
                        data-testid={`button-remove-opinion-option-${idx}`}
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {opinionSuggestOptions.length < 20 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpinionSuggestOptions([...opinionSuggestOptions, ""])}
                  className="mt-2 text-cyan-600 dark:text-cyan-400"
                  data-testid="button-add-opinion-option"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Option
                </Button>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Category</label>
              <Select value={opinionSuggestCategory} onValueChange={setOpinionSuggestCategory}>
                <SelectTrigger data-testid="select-opinion-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="misc">General</SelectItem>
                  <SelectItem value="tech">Tech</SelectItem>
                  <SelectItem value="music">Music</SelectItem>
                  <SelectItem value="sports">Sports</SelectItem>
                  <SelectItem value="politics">Politics</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="entertainment">Entertainment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Timeline</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setOpinionSuggestDuration(preset.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      opinionSuggestDuration === preset.value
                        ? "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                        : "bg-muted/50 border-border/60 text-muted-foreground hover:border-foreground/30 dark:bg-slate-800/30 dark:border-slate-700/40 dark:text-slate-400 dark:hover:border-slate-600"
                    }`}
                    data-testid={`opinion-duration-${preset.value}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {opinionSuggestDuration === "custom" && (
                <Input
                  type="datetime-local"
                  value={opinionSuggestCustomDate}
                  onChange={(e) => setOpinionSuggestCustomDate(e.target.value)}
                  className="mt-2"
                  data-testid="input-opinion-custom-date"
                />
              )}
            </div>
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpinionSuggestOpen(false)} data-testid="button-cancel-opinion-suggest">Cancel</Button>
            <Button
              onClick={handleOpinionSuggestSubmit}
              disabled={isSuggestSubmitting || !opinionSuggestTitle || opinionSuggestOptions.filter(o => o.trim()).length < 3}
              className="bg-cyan-500 text-white"
              data-testid="button-submit-opinion-suggest"
            >
              {isSuggestSubmitting ? "Submitting…" : "Submit Poll"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!rulesModalOpen} onOpenChange={() => setRulesModalOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              {rulesModalOpen === "induction" && "Induction Queue Rules"}
              {rulesModalOpen === "curate" && "Curate the Profile Rules"}
              {rulesModalOpen === "voice" && "Sentiment Polls Rules"}
              {rulesModalOpen === "matchups" && "Matchups Rules"}
              {rulesModalOpen === "value" && "How It Works"}
              {rulesModalOpen === "opinion" && "Opinion Polls Rules"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 text-sm">
            {rulesModalOpen === "induction" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Vote for celebrities you want to see added to the VoxDex leaderboard.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Vote className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Each user can vote <span className="text-cyan-600 dark:text-cyan-400 font-medium">once per candidate</span></span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Crown className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>The <span className="text-cyan-600 dark:text-cyan-400 font-medium">#1 candidate</span> is inducted weekly</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-600 dark:text-cyan-400 font-medium">+30 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Weekly winner gets inducted to the main leaderboard</span>
                  </div>
                </div>
              </div>
            )}
            {rulesModalOpen === "curate" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Help choose the official profile photo displayed across VoxDex.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Camera className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Swipe left or right to vote on profile photos</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Crown className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>The winning image becomes the official profile photo</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-600 dark:text-cyan-400 font-medium">+20 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Votes accumulate perpetually to determine the definitive all-time look</span>
                  </div>
                </div>
              </div>
            )}
            {rulesModalOpen === "voice" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Share your opinion on trending topics and current events.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Vote <span className="text-[#00C853] font-medium">Support</span>, <span className="text-slate-400 font-medium">Neutral</span>, or <span className="text-[#FF0000] font-medium">Oppose</span> on various topics.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>See how your vote compares to the community</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-600 dark:text-cyan-400 font-medium">+25 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Plus className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Submit your own poll topics for community voting</span>
                  </div>
                </div>
              </div>
            )}
            {rulesModalOpen === "matchups" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Pick a side in head-to-head matchups across anything and everything.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Swords className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Vote A vs B: Choose the winner in quick 1v1 battles.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Globe className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Anything Goes: People, brands, sports, ideas â€” even random preferences.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-600 dark:text-cyan-400 font-medium">+15 XP</span>: Get rewarded for every Matchup vote you cast.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Instant Results: See how your pick compares to the community.</span>
                  </div>
                </div>
              </div>
            )}
            {rulesModalOpen === "value" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Do you believe the public perception of this person is accurate?</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <ArrowUp className="h-4 w-4 text-[#00C853] mt-0.5 shrink-0" />
                    <span>Vote <span className="text-[#00C853] font-medium">Underrated</span> if you think they deserve more recognition than they currently get.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ArrowDown className="h-4 w-4 text-[#FF0000] mt-0.5 shrink-0" />
                    <span>Vote <span className="text-[#FF0000] font-medium">Overrated</span> if you think they receive more attention or praise than they deserve.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Compare your view with the community results.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Your vote updates the Underrated/Overrated split in real time.</span>
                  </div>
                </div>
              </div>
            )}
            {rulesModalOpen === "opinion" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Choose your pick from multiple options on community-created polls.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <ListChecks className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Pick <span className="text-cyan-600 dark:text-cyan-400 font-medium">one option</span> from multiple choices on each poll</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>See live results and how the community voted</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-600 dark:text-cyan-400 font-medium">+15 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Plus className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
                    <span>Suggest your own opinion polls for the community</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <OnboardingDrawer
        ref={voteOnboardingRef}
        storageKey="authoridex_vote_welcome_seen"
        steps={VOTE_ONBOARDING_STEPS}
        toastLabel="New to voting?"
        lastStepCta="Cast Your First Vote"
        disableAutoToast={!!user}
      />
      {/* Community Governance Info Modal */}
      <Dialog open={infoModalOpen === "governance"} onOpenChange={() => setInfoModalOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              You Run the Show
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 text-sm">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-600 dark:text-cyan-400 text-xs font-bold">1</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">Expand the Roster:</span>
                  <span className="text-muted-foreground"> The leaderboard isn't static. Vote in the Induction Queue to decide exactly who deserves to be added next.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-600 dark:text-cyan-400 text-xs font-bold">2</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">Define the Aesthetic:</span>
                  <span className="text-muted-foreground"> You are the Art Director. Use Curate Profile to swap out bad press photos and choose the definitive image for every star.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-600 dark:text-cyan-400 text-xs font-bold">3</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">Remove the Gatekeepers:</span>
                  <span className="text-muted-foreground"> No editors, no bias. This is the first global index that is 100% shaped, ranked, and managed by you.</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
              categories={VOTE_CATEGORIES}
              allValue="All"
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
                    rank={index + 1}
                    maxVotes={filteredMaxVotes}
                    isVoted={votedIds.has(candidate.id)}
                    onToggleVote={handleToggleVote}
                    onXPGain={handleInductionXP}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
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
              categories={VOTE_CATEGORIES_WITH_CUSTOM}
              allValue="All"
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
              categories={VOTE_CATEGORIES_WITH_CUSTOM}
              allValue="All"
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
              categories={VOTE_CATEGORIES_WITH_CUSTOM}
              allValue="All"
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
                    onVote={async (pollSlug, optionId) => {
                      await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { optionId });
                      queryClient.invalidateQueries({ queryKey: ['/api/opinion-polls'] });
                    }}
                    onRemoveVote={async (pollSlug) => {
                      await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { remove: true });
                      queryClient.invalidateQueries({ queryKey: ['/api/opinion-polls'] });
                    }}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                    onNavigateToDetail={poll.slug ? () => goOpinionDetail(poll.slug) : undefined}
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
              categories={VOTE_CATEGORIES_WITH_CUSTOM}
              allValue="All"
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
            renderCard={(item) => {
              const p = opinionPolls.find((x: any) => x.id === item.id);
              if (!p) return null;
              return (
                <OpinionPollCard
                  poll={p}
                  onVote={async (pollSlug, optionId) => {
                    await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { optionId });
                    queryClient.invalidateQueries({ queryKey: ['/api/opinion-polls'] });
                  }}
                  onRemoveVote={async (pollSlug) => {
                    await apiRequest("POST", `/api/opinion-polls/${pollSlug}/vote`, { remove: true });
                    queryClient.invalidateQueries({ queryKey: ['/api/opinion-polls'] });
                  }}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                  onNavigateToDetail={p.slug ? () => goOpinionDetail(p.slug) : undefined}
                />
              );
            }}
          />
        </>
      )}
    </div>
  );
}
