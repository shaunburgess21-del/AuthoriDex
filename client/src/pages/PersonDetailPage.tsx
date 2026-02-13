import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TrendBadge } from "@/components/TrendBadge";
import { TrendChart } from "@/components/TrendChart";
import { StatCard } from "@/components/StatCard";
import { UserMenu } from "@/components/UserMenu";
import { PlatformInsightsSection } from "@/components/PlatformInsightsSection";
import { AnimatedSentimentVotingWidget } from "@/components/AnimatedSentimentVotingWidget";
import { CommunityInsights } from "@/components/CommunityInsights";
import { ProfileTabs } from "@/components/ProfileTabs";
import { PredictTab } from "@/components/PredictTab";
import { PolymarketBetsWidget } from "@/components/PolymarketBetsWidget";
import { CelebrityInfoModal } from "@/components/CelebrityInfoModal";
import { CategoryPill } from "@/components/CategoryPill";
import { ArrowLeft, Share2, Star, TrendingUp, Users, Eye, DollarSign, Globe, MessageSquare, Trophy, Zap, Camera, Check, X, Search, ThumbsUp, ThumbsDown, Minus, HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { formatNumber } from "@/lib/formatNumber";
import { OverratedUnderratedWidget } from "@/components/OverratedUnderratedWidget";
import { WhyTrendingCard } from "@/components/WhyTrendingCard";
import { getExceptionalIndicator, computePercentileThresholds } from "@/components/LeaderboardRow";

interface CurateProfilePoll {
  id: string;
  personId: number | string;
  personName: string;
  category: string;
}

interface CelebrityImage {
  id: number;
  personId: number;
  imageUrl: string;
  sourceType: string;
  votesUp: number;
  votesDown: number;
}

interface FeaturedPoll {
  id: string;
  headline: string;
  description: string;
  subjectEntity: string;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  totalVotes: number;
  createdAt: Date;
}

const FEATURED_POLLS_DATA: FeaturedPoll[] = [
  { id: "fp1", headline: "Elon buys Twitter", description: "Was the $44B acquisition a smart move?", subjectEntity: "Elon Musk", approvePercent: 35, neutralPercent: 20, disapprovePercent: 45, totalVotes: 89432, createdAt: new Date("2024-12-20") },
  { id: "fp2", headline: "Tesla's Cybertruck success", description: "Is it living up to the hype?", subjectEntity: "Elon Musk", approvePercent: 42, neutralPercent: 28, disapprovePercent: 30, totalVotes: 67891, createdAt: new Date("2024-12-18") },
  { id: "fp3", headline: "SpaceX Mars timeline", description: "Will they really reach Mars by 2030?", subjectEntity: "Elon Musk", approvePercent: 38, neutralPercent: 32, disapprovePercent: 30, totalVotes: 54321, createdAt: new Date("2024-12-15") },
  { id: "fp4", headline: "Neuralink progress", description: "Breakthrough or overpromise?", subjectEntity: "Elon Musk", approvePercent: 28, neutralPercent: 35, disapprovePercent: 37, totalVotes: 43210, createdAt: new Date("2024-12-10") },
  { id: "fp5", headline: "X Platform rebrand", description: "Better or worse than Twitter?", subjectEntity: "Elon Musk", approvePercent: 25, neutralPercent: 30, disapprovePercent: 45, totalVotes: 98765, createdAt: new Date("2024-12-05") },
  { id: "fp6", headline: "Trump's 2024 campaign", description: "Will he win the election?", subjectEntity: "Donald Trump", approvePercent: 48, neutralPercent: 12, disapprovePercent: 40, totalVotes: 234567, createdAt: new Date("2024-12-22") },
  { id: "fp7", headline: "Trump on TikTok ban", description: "Should TikTok be banned?", subjectEntity: "Donald Trump", approvePercent: 52, neutralPercent: 18, disapprovePercent: 30, totalVotes: 156789, createdAt: new Date("2024-12-19") },
  { id: "fp8", headline: "MAGA economic policies", description: "Good for the economy?", subjectEntity: "Donald Trump", approvePercent: 45, neutralPercent: 20, disapprovePercent: 35, totalVotes: 145678, createdAt: new Date("2024-12-14") },
  { id: "fp9", headline: "Taylor's Eras Tour pricing", description: "Are dynamic ticket prices fair to fans?", subjectEntity: "Taylor Swift", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 234567, createdAt: new Date("2024-12-21") },
  { id: "fp10", headline: "Taylor & Travis relationship", description: "Power couple or PR stunt?", subjectEntity: "Taylor Swift", approvePercent: 65, neutralPercent: 22, disapprovePercent: 13, totalVotes: 189432, createdAt: new Date("2024-12-17") },
  { id: "fp11", headline: "Beyoncé's country album", description: "Authentic exploration or cultural appropriation?", subjectEntity: "Beyoncé", approvePercent: 65, neutralPercent: 20, disapprovePercent: 15, totalVotes: 176543, createdAt: new Date("2024-12-20") },
  { id: "fp12", headline: "MrBeast's philanthropy", description: "Is it genuine or just content?", subjectEntity: "MrBeast", approvePercent: 68, neutralPercent: 20, disapprovePercent: 12, totalVotes: 98765, createdAt: new Date("2024-12-19") },
];

function CurateProfileCardProfile({ 
  poll, 
  onVote,
  onComplete 
}: { 
  poll: CurateProfilePoll; 
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
        <span>{poll.totalVotes.toLocaleString()} votes</span>
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif font-bold text-xl">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-polls-overlay">
              <X className="h-5 w-5" />
            </Button>
          </div>
          
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

export default function PersonDetailPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, params] = useRoute("/person/:id");
  const [location, setLocation] = useLocation();
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [showAllPollsOverlay, setShowAllPollsOverlay] = useState(false);
  const [curateCompleted, setCurateCompleted] = useState(false);

  // Handle URL query param for tab
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get("tab");
    if (tabParam && ["overview", "vote", "predict"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [location]);

  const { data: person, isLoading, error } = useQuery<TrendingPerson>({
    queryKey: [`/api/trending/${params?.id}`],
    enabled: !!params?.id,
  });

  const { data: leaderboardForThresholds } = useQuery<{ data: (TrendingPerson & { rankChange?: number | null })[] }>({
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
    if (!person || !leaderboardForThresholds?.data || leaderboardForThresholds.data.length === 0) {
      return { isHotMover: false, exceptionalIndicator: null };
    }
    const thresholds = computePercentileThresholds(leaderboardForThresholds.data as any);
    const match = leaderboardForThresholds.data.find(p => p.id === person.id);
    if (!match) return { isHotMover: false, exceptionalIndicator: null };
    const indicator = getExceptionalIndicator(match as any, thresholds);
    return { isHotMover: indicator?.triggersHotMover === true, exceptionalIndicator: indicator };
  }, [person, leaderboardForThresholds]);

  // Check if person is favorited
  useEffect(() => {
    if (!user || !person) return;

    async function checkFavorite() {
      try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
          .from('user_favourites')
          .select('id')
          .eq('userId', user!.id)
          .eq('personId', person!.id)
          .single();

        if (!error && data) {
          setIsFavorited(true);
        }
      } catch (error) {
        console.error('Error checking favorite:', error);
      }
    }

    checkFavorite();
  }, [user, person]);

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
    if (!user) {
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
      const supabase = await getSupabase();

      if (isFavorited) {
        const { error } = await supabase
          .from('user_favourites')
          .delete()
          .eq('userId', user.id)
          .eq('personId', person.id);

        if (error) throw error;

        setIsFavorited(false);
        toast({
          title: "Removed from favorites",
          description: `${person.name} has been removed from your favorites`,
        });
      } else {
        const { error } = await supabase
          .from('user_favourites')
          .insert({
            userId: user.id,
            personId: person.id,
            personName: person.name,
            personAvatar: person.avatar,
            personCategory: person.category,
          });

        if (error) throw error;

        setIsFavorited(true);
        toast({
          title: "Added to favorites",
          description: `${person.name} has been added to your favorites`,
        });
      }
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
    setActiveTab("predict");
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
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLocation("/")}
              data-testid="link-logo-home"
            >
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">FameDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" onClick={() => setLocation("/#leaderboard")} data-testid="nav-leaderboard-desktop">
                Leaderboard
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/vote")} data-testid="nav-vote-desktop">
                Vote
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-6xl">
        {/* 1. Header: Name + Category */}
        <div className="mb-8">
          <div className="flex gap-6">
            <PersonAvatar name={person.name} avatar={person.avatar} size="xl" />
            <div className="flex-1 flex flex-col justify-between h-48">
              <div>
                <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2" data-testid="text-person-name">
                  {person.name}
                </h1>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <p className="text-lg text-muted-foreground">{person.category}</p>
                  <CelebrityInfoModal personId={person.id} personName={person.name} />
                </div>
                {person.bio && (
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4" data-testid="text-person-bio">
                    {person.bio}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-share">
                  <Share2 className="h-4 w-4" />
                  Share
                </Button>
                <Button
                  variant={isFavorited ? "default" : "outline"}
                  size="sm"
                  className="gap-2"
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

        {/* Why They're Trending - AI-powered news summary (top 10 + Hot Movers) */}
        {((person.rank && person.rank <= 10) || isHotMover) && (
          <div className="mb-8">
            <WhyTrendingCard personId={person.id} personName={person.name} hotMover={isHotMover && !(person.rank && person.rank <= 10)} />
          </div>
        )}

        {/* 2. Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="text-center p-4">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              Fame Score
            </p>
            <p className="text-3xl font-mono font-bold" data-testid="text-trend-score">
              {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString()}
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
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              Rank
            </p>
            <p className="text-3xl font-mono font-bold">
              #{person.rank}
            </p>
          </Card>
        </div>

        {/* Profile Tabs Section */}
        <div id="profile-tabs-section">
          <ProfileTabs activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <>
            {/* 5. Trend History Chart */}
            <TrendChart personId={person.id} personName={person.name} />
            
            {/* 6. Platform Insights (stacked blocks) */}
            <PlatformInsightsSection personId={person.id} />

            {/* 7. Polymarket Bets Widget */}
            <PolymarketBetsWidget personName={person.name} />

            {/* Future Widgets - Placeholder Section */}
            <div className="mt-12 space-y-6">
              <h2 className="text-2xl font-serif font-bold mb-6">Additional Insights</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Net Worth Placeholder */}
                <Card className="p-6 opacity-50">
                  <div className="flex items-center gap-3 mb-3">
                    <DollarSign className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">Net Worth</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Coming soon: Forbes & Knowledge Graph data</p>
                </Card>

                {/* Social Reach Summary Placeholder */}
                <Card className="p-6 opacity-50">
                  <div className="flex items-center gap-3 mb-3">
                    <Globe className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">Social Reach</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Coming soon: Total followers across platforms</p>
                </Card>

                {/* AI Sentiment Summary Placeholder */}
                <Card className="p-6 opacity-50">
                  <div className="flex items-center gap-3 mb-3">
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">AI Sentiment</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Coming soon: AI-powered sentiment analysis</p>
                </Card>

                {/* Engagement Rank Placeholder */}
                <Card className="p-6 opacity-50">
                  <div className="flex items-center gap-3 mb-3">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">Category Rank</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Coming soon: Engagement vs. peers</p>
                </Card>

                {/* Most Talked About Topic Placeholder */}
                <Card className="p-6 opacity-50">
                  <div className="flex items-center gap-3 mb-3">
                    <TrendingUp className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">Trending Topics</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Coming soon: Keywords from latest posts</p>
                </Card>

                {/* Search Volume Detail Placeholder */}
                <Card className="p-6 opacity-50">
                  <div className="flex items-center gap-3 mb-3">
                    <Eye className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">Search Trends</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Coming soon: Geographic search distribution</p>
                </Card>
              </div>
            </div>
          </>
        )}

        {/* VOTE TAB */}
        {activeTab === "vote" && (
          <>
            {/* Sentiment Voting Widget */}
            <div id="voting-widget" className="mb-8">
              <AnimatedSentimentVotingWidget 
                personId={person.id} 
                personName={person.name}
                isProfilePage={true}
              />
            </div>

            {/* Overrated/Underrated Widget - below Cast Your Vote */}
            <div className="mb-8">
              <OverratedUnderratedWidget personId={person.id} personName={person.name} />
            </div>

            {/* Curate the Profile Section */}
            <section className="mb-8">
              <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                      <Camera className="h-5 w-5 text-cyan-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-serif font-bold">Curate the Profile</h2>
                      <p className="text-sm text-muted-foreground">Help choose the best profile photo</p>
                    </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-curate-info">
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Vote on which image best represents this celebrity. The winning look becomes their primary profile image.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {!curateCompleted ? (
                <div className="max-w-md mx-auto">
                  <CurateProfileCardProfile
                    poll={{ id: `curate-${person.id}`, personId: person.id, personName: person.name, category: person.category || "General" }}
                    onVote={() => {}}
                    onComplete={() => setCurateCompleted(true)}
                  />
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <Check className="h-8 w-8 text-green-500" />
                  </div>
                  <p className="text-lg font-semibold mb-2">Thanks for voting!</p>
                  <p className="text-sm text-muted-foreground mb-4">Your vote helps determine their official profile image.</p>
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

            {/* Featured Polls Section */}
            {(() => {
              const personPolls = FEATURED_POLLS_DATA
                .filter(p => p.subjectEntity === person.name)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
              
              if (personPolls.length === 0) return null;

              const displayPolls = personPolls.slice(0, 3);
              const hasMore = personPolls.length > 3;

              return (
                <section className="mb-8">
                  <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                          <MessageSquare className="h-5 w-5 text-cyan-400" />
                        </div>
                        <div>
                          <h2 className="text-lg font-serif font-bold">Featured Polls</h2>
                          <p className="text-sm text-muted-foreground">{personPolls.length} poll{personPolls.length !== 1 ? 's' : ''} about {person.name}</p>
                        </div>
                      </div>
                      {hasMore && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setShowAllPollsOverlay(true)}
                          className="text-cyan-400 hover:text-cyan-300"
                          data-testid="button-view-all-polls"
                        >
                          View all
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {displayPolls.map((poll) => (
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
                    title={`All Polls about ${person.name}`}
                    polls={personPolls}
                    onVote={(pollId, choice) => {
                      toast({
                        title: "Vote Recorded",
                        description: `Your vote has been recorded.`,
                      });
                    }}
                  />
                </section>
              );
            })()}

            {/* Community Insights */}
            <div className="mb-8">
              <CommunityInsights personId={person.id} personName={person.name} />
            </div>
          </>
        )}

        {/* PREDICT TAB */}
        {activeTab === "predict" && (
          <PredictTab 
            personId={person.id} 
            personName={person.name}
            personAvatar={person.avatar || ""}
            currentScore={person.fameIndex ?? Math.round(person.trendScore / 100)}
          />
        )}
      </div>
    </div>
  );
}
