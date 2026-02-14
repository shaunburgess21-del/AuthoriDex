import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryPill } from "@/components/CategoryPill";
import { UserMenu } from "@/components/UserMenu";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useDragScroll } from "@/hooks/use-drag-scroll";
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
  Upload,
  Cpu,
  Landmark,
  Briefcase,
  Clapperboard,
  Trophy,
  Video,
  LayoutGrid,
  type LucideIcon
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { motion, AnimatePresence } from "framer-motion";
import { getFilterCategories, type FilterCategory } from "@shared/constants";
import type { TrendingPerson } from "@shared/schema";
import { CurateSection } from "@/components/curate";
import { UnderratedOverratedCard } from "@/components/UnderratedOverratedCard";

const mockCelebrityList = [
  "Taylor Swift", "Elon Musk", "Keanu Reeves", "Beyoncé", "Dwayne Johnson",
  "Rihanna", "LeBron James", "Kim Kardashian", "Justin Bieber", "Ariana Grande",
  "Cristiano Ronaldo", "Lionel Messi", "Drake", "Selena Gomez", "Kylie Jenner",
  "Billie Eilish", "Bad Bunny", "Post Malone", "The Weeknd", "Zendaya",
  "Tom Holland", "Timothée Chalamet", "Margot Robbie", "Ryan Reynolds", "Dua Lipa",
  "Harry Styles", "Olivia Rodrigo", "Ice Spice", "Travis Scott", "SZA"
];

interface InductionCandidate {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  category: "Tech" | "Entertainment" | "Creator" | "Sports" | "Business" | "Politics";
  votes: number;
}

const INDUCTION_CANDIDATES: InductionCandidate[] = [
  { id: "i1", name: "Jensen Huang", initials: "JH", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/jensen-huang/1.png", category: "Tech", votes: 12406 },
  { id: "i2", name: "Charli XCX", initials: "CX", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/charli-xcx/1.png", category: "Entertainment", votes: 11205 },
  { id: "i3", name: "Kai Cenat", initials: "KC", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/kai-cenat/1.png", category: "Creator", votes: 10892 },
  { id: "i4", name: "Sabrina Carpenter", initials: "SC", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/sabrina-carpenter/1.png", category: "Entertainment", votes: 9847 },
  { id: "i5", name: "Ice Spice", initials: "IS", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/ice-spice/1.png", category: "Entertainment", votes: 8934 },
  { id: "i6", name: "Sam Altman", initials: "SA", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/sam-altman/1.png", category: "Tech", votes: 8421 },
  { id: "i7", name: "Jenna Ortega", initials: "JO", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/jenna-ortega/1.png", category: "Creator", votes: 7856 },
  { id: "i8", name: "Patrick Mahomes", initials: "PM", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/patrick-mahomes/1.png", category: "Sports", votes: 7234 },
  { id: "i9", name: "Vivek Ramaswamy", initials: "VR", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/vivek-ramaswamy/1.png", category: "Politics", votes: 6891 },
  { id: "i10", name: "xQc", initials: "XQ", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/xqc/1.png", category: "Creator", votes: 6543 },
  { id: "i11", name: "Hailey Bieber", initials: "HB", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/hailey-bieber/1.png", category: "Creator", votes: 5987 },
  { id: "i12", name: "Mark Cuban", initials: "MC", avatar: "https://etpnpiqwfjgyvbyfdbmw.supabase.co/storage/v1/object/public/celebrity_images/mark-cuban/1.png", category: "Business", votes: 5432 },
];

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
    category: "Entertainment",
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
    personName: "Beyoncé", 
    category: "Entertainment",
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
    category: "Entertainment",
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
    category: "Entertainment",
  },
  { 
    id: "pp8", 
    personId: "0b9bd1d6-0f66-4665-8cec-05d87908e3a1",
    personName: "Kendrick Lamar", 
    category: "Entertainment",
  },
];


const SECTION_TOGGLES = ["All", "Face-Offs", "Trending Polls", "Induction Queue", "Curate Profile"] as const;
type SectionToggle = typeof SECTION_TOGGLES[number];

const isGovernanceSection = (section: SectionToggle) => 
  section === "Induction Queue" || section === "Curate Profile";

const isPublicOpinionSection = (section: SectionToggle) =>
  section === "Face-Offs" || section === "Trending Polls";

const SECTION_RULES = {
  induction: {
    title: "Induction Queue Rules",
    content: "Voted candidates with the most support at the end of the cycle are officially inducted into the FameDex Main Leaderboard. Your vote helps shape who defines the future of fame."
  },
  curate: {
    title: "Curate Profile Rules",
    content: "Which image best represents this celebrity? The winning look becomes the primary profile image across the entire platform. Only the highest quality looks make it to the index."
  },
  faceoffs: {
    title: "Face-Offs Rules",
    content: "Pick your side in head-to-head matchups! Vote for your favorite in classic A vs B showdowns. Each vote earns XP and contributes to the community consensus."
  },
  voice: {
    title: "Trending Polls Rules",
    content: "The ultimate community pulse check. Weigh in on current events and controversies. Evergreen polls remain open; timed polls resolve at the specified deadline."
  },
  value: {
    title: "How It Works",
    content: "This vote is about public perception — not your personal like/dislike. Vote Underrated if you think they deserve more recognition than they currently get. Vote Overrated if you think they receive more attention or praise than they deserve. Compare your view with the community results. Your vote updates the Underrated/Overrated split in real time."
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

interface FaceOffData {
  id: string;
  category: string;
  title: string;
  optionAText: string;
  optionAImage: string | null;
  optionBText: string;
  optionBImage: string | null;
  isActive: boolean;
  createdAt: string;
  optionAVotes: number;
  optionBVotes: number;
  totalVotes: number;
  optionAPercent: number;
  optionBPercent: number;
}

function VersusCard({ 
  faceOff, 
  userVote, 
  onVote 
}: { 
  faceOff: FaceOffData; 
  userVote: string | null;
  onVote: (faceOffId: string, option: 'option_a' | 'option_b', event?: React.MouseEvent) => void;
}) {
  const hasVoted = userVote !== null;
  const votedA = userVote === 'option_a';
  const votedB = userVote === 'option_b';
  const leadingA = faceOff.optionAPercent >= faceOff.optionBPercent;
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50 hover-elevate">
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-teal-500/5 rounded-lg" />
      
      <div className="relative pt-4 pb-4">
        <div className="flex items-center justify-between mb-3 gap-2 px-4">
          <CategoryPill category={faceOff.category} data-testid={`badge-faceoff-${faceOff.id}`} />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-cyan-400" />
            <span>{faceOff.totalVotes.toLocaleString()} votes</span>
          </div>
        </div>
        
        <div className="flex items-stretch gap-[2px] relative px-[2px]">
          <button
            onClick={(e) => !hasVoted && onVote(faceOff.id, 'option_a', e)}
            disabled={hasVoted}
            className={`flex-1 rounded-lg border transition-all duration-300 overflow-hidden relative ${
              hasVoted
                ? votedA
                  ? 'border-cyan-500/50 ring-2 ring-cyan-500/30'
                  : 'border-slate-700/30 opacity-60'
                : 'border-slate-700/50 hover:border-cyan-500/50 cursor-pointer'
            }`}
            style={{ minHeight: '262px' }}
            data-testid={`button-vote-a-${faceOff.id}`}
          >
            {faceOff.optionAImage ? (
              <div className="absolute inset-0">
                <img 
                  src={faceOff.optionAImage} 
                  alt={faceOff.optionAText}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              </div>
            ) : (
              <div className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedA ? 'from-cyan-600/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
            )}
            <div className="relative h-full flex flex-col items-center justify-end p-3">
              <span className="font-semibold text-sm text-center text-white drop-shadow-lg">{faceOff.optionAText}</span>
            </div>
          </button>
          
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center pointer-events-none">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-xs font-bold text-slate-200">VS</span>
            </div>
          </div>
          
          <button
            onClick={(e) => !hasVoted && onVote(faceOff.id, 'option_b', e)}
            disabled={hasVoted}
            className={`flex-1 rounded-lg border transition-all duration-300 overflow-hidden relative ${
              hasVoted
                ? votedB
                  ? 'border-teal-500/50 ring-2 ring-teal-500/30'
                  : 'border-slate-700/30 opacity-60'
                : 'border-slate-700/50 hover:border-teal-500/50 cursor-pointer'
            }`}
            style={{ minHeight: '262px' }}
            data-testid={`button-vote-b-${faceOff.id}`}
          >
            {faceOff.optionBImage ? (
              <div className="absolute inset-0">
                <img 
                  src={faceOff.optionBImage} 
                  alt={faceOff.optionBText}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              </div>
            ) : (
              <div className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedB ? 'from-teal-600/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
            )}
            <div className="relative h-full flex flex-col items-center justify-end p-3">
              <span className="font-semibold text-sm text-center text-white drop-shadow-lg">{faceOff.optionBText}</span>
            </div>
          </button>
        </div>
        
        <div className="mt-3 px-4">
          {hasVoted ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`text-lg font-bold ${leadingA ? 'text-cyan-400' : 'text-slate-400'}`}>
                    {faceOff.optionAPercent}%
                  </span>
                  {votedA && (
                    <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-400 px-1.5 py-0">
                      Your pick
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {votedB && (
                    <Badge variant="outline" className="text-[10px] border-teal-500/40 text-teal-400 px-1.5 py-0">
                      Your pick
                    </Badge>
                  )}
                  <span className={`text-lg font-bold ${!leadingA ? 'text-teal-400' : 'text-slate-400'}`}>
                    {faceOff.optionBPercent}%
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-700/50 overflow-hidden flex">
                <motion.div 
                  className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                  initial={{ width: '50%' }}
                  animate={{ width: `${faceOff.optionAPercent}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                />
                <motion.div 
                  className="h-full bg-gradient-to-r from-teal-400 to-teal-500"
                  initial={{ width: '50%' }}
                  animate={{ width: `${faceOff.optionBPercent}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-slate-500 font-medium">{faceOff.optionAText}</span>
                <span className="text-[11px] text-slate-500 font-medium">{faceOff.optionBText}</span>
              </div>
            </motion.div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-1.5 text-xs text-slate-400">
              <Swords className="h-3.5 w-3.5 text-cyan-400/70" />
              <span className="font-medium">Tap an image to pick your side</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function getRankBadgeStyle(rank: number) {
  if (rank === 1) return "bg-yellow-500/10 border-yellow-500/20 text-yellow-300";
  if (rank === 2) return "bg-slate-400/10 border-slate-400/20 text-slate-300";
  if (rank === 3) return "bg-orange-500/10 border-orange-500/20 text-orange-300";
  return "bg-slate-500/10 border-slate-500/20 text-slate-400";
}

function InductionCandidateCard({ 
  candidate,
  rank,
  maxVotes,
  isVoted,
  onToggleVote,
  onXPGain
}: { 
  candidate: InductionCandidate;
  rank: number;
  maxVotes: number;
  isVoted: boolean;
  onToggleVote: (id: string) => void;
  onXPGain: (event: React.MouseEvent) => void;
}) {
  const [showVoteAnimation, setShowVoteAnimation] = useState(false);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPercent = rank === 1 ? 100 : (candidate.votes / maxVotes) * 100;
  const gap = maxVotes - candidate.votes;

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
    <Card 
      className="p-5 transition-all duration-200 hover:shadow-[0_0_20px_rgba(148,163,184,0.08)] h-full flex flex-col relative overflow-hidden"
      style={{ border: '1px solid rgba(148,163,184,0.18)' }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(148,163,184,0.35)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)'}
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
        <CategoryPill category={candidate.category} data-testid={`badge-category-${candidate.id}`} />
      </div>
      
      <div className="flex items-center mb-4">
        <div className={`rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1 border ${getRankBadgeStyle(rank)}`}>
          {rank === 1 && <Crown className="h-3 w-3" />}
          #{rank}
        </div>
      </div>

      <div className="flex flex-col items-center text-center mb-4 flex-grow">
        <div className="relative">
          <PersonAvatar name={candidate.name} avatar={candidate.avatar} size="lg" />
          {isVoted && (
            <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="h-3 w-3 text-white" />
            </div>
          )}
        </div>
        <h3 className="font-semibold mt-3">{candidate.name}</h3>
      </div>
      
      <div className="mb-4">
        <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {rank === 1 ? (
            <span className="flex items-center gap-1">
              <Crown className="h-3 w-3 text-yellow-400" />
              <span className="text-yellow-400/80">Leader</span>
              <span className="mx-1">•</span>
              <span className="text-slate-400">{candidate.votes.toLocaleString()} votes</span>
            </span>
          ) : (
            <span>
              <span className="text-slate-500">Gap: </span>
              <span className="text-slate-400">-{gap.toLocaleString()}</span>
              <span className="mx-1 text-slate-500">•</span>
              <span className="text-slate-400">{candidate.votes.toLocaleString()} votes</span>
            </span>
          )}
        </div>
      </div>
      
      <Button 
        onClick={handleVoteClick}
        className={`w-full ${isVoted 
          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20' 
          : 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-[0_0_15px_rgba(34,211,238,0.2)]'
        }`}
        data-testid={`button-induct-${candidate.id}`}
      >
        {isVoted ? (
          <>
            <Check className="h-4 w-4 mr-2" />
            Voted
          </>
        ) : (
          <>
            <Vote className="h-4 w-4 mr-2" />
            Vote to Induct
          </>
        )}
      </Button>
    </Card>
  );
}

function CurateProfileCard({ 
  poll, 
  onVote,
  onComplete,
  onViewResults
}: { 
  poll: CurateProfilePoll; 
  onVote: () => void;
  onComplete: () => void;
  onViewResults: (poll: CurateProfilePoll) => void;
}) {
  const [selectedChoice, setSelectedChoice] = useState<'a' | 'b' | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timeoutRef1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

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
      toast({
        title: "Error",
        description: error.message || "Failed to record vote",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef1.current) clearTimeout(timeoutRef1.current);
      if (timeoutRef2.current) clearTimeout(timeoutRef2.current);
    };
  }, []);

  const handlePick = (choice: 'a' | 'b') => {
    if (!selectedChoice && imageA && imageB) {
      setSelectedChoice(choice);
      setShowShimmer(true);
      onVote();
      
      // Vote up for selected, vote down for other
      const selectedImage = choice === 'a' ? imageA : imageB;
      const otherImage = choice === 'a' ? imageB : imageA;
      voteMutation.mutate({ imageId: selectedImage.id, direction: 'up' });
      voteMutation.mutate({ imageId: otherImage.id, direction: 'down' });
      
      timeoutRef1.current = setTimeout(() => {
        setShowShimmer(false);
        setShowResults(true);
      }, 600);
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
      className="px-2"
      initial={{ opacity: 1, x: 0 }}
      animate={{ opacity: isExiting ? 0 : 1, x: isExiting ? -100 : 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card 
        className="p-4 transition-all duration-200 hover:shadow-[0_0_20px_rgba(148,163,184,0.08)] relative overflow-hidden"
        style={{ border: '1px solid rgba(148,163,184,0.18)' }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(148,163,184,0.35)'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)'}
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
          <CategoryPill category={poll.category} data-testid={`badge-curate-${poll.id}`} />
        </div>
        <div className="mb-3">
          <h3 className="font-semibold text-sm">{poll.personName}</h3>
        </div>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
          </div>
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
              className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3"
            >
              <Check className="h-6 w-6 text-green-400" />
            </motion.div>
            <p className="font-medium text-green-400 mb-1">Vote recorded!</p>
            <p className="text-xs text-muted-foreground mb-4">{totalVotes.toLocaleString()} total votes</p>
            <div className="flex gap-2 justify-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onViewResults(poll)}
                className="border-cyan-500/50 text-cyan-400"
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
                data-testid={`button-photo-a-${poll.id}`}
              >
                <img 
                  src={imageA.imageUrl} 
                  alt={`${poll.personName} Look A`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <span className="text-xs text-white font-medium">Look A</span>
                </div>
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
                data-testid={`button-photo-b-${poll.id}`}
              >
                <img 
                  src={imageB.imageUrl} 
                  alt={`${poll.personName} Look B`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <span className="text-xs text-white font-medium">Look B</span>
                </div>
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
          </>
        )}
      </Card>
    </motion.div>
  );
}

function DiscourseCard({ 
  topic, 
  onVote 
}: { 
  topic: any; 
  onVote: (choice: 'support' | 'neutral' | 'oppose') => void;
}) {
  const [voted, setVoted] = useState<'support' | 'neutral' | 'oppose' | null>(null);

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
    <Card 
      className="pt-6 px-5 pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full flex flex-col hover:shadow-[0_0_20px_rgba(148,163,184,0.08)] relative"
      style={{ 
        border: '1px solid rgba(148,163,184,0.18)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(148,163,184,0.35)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)'}
      data-testid={`card-discourse-${topic.id}`}
    >
      <div className="absolute top-3 right-3">
        <CategoryPill category={topic.category} data-testid={`badge-category-${topic.id}`} />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-cyan-400" />
        <span>{topic.totalVotes.toLocaleString()} votes</span>
      </div>
      <div className="flex items-start gap-3 mb-3">
        {(topic.personAvatar || topic.imageUrl) ? (
          <div className="h-12 w-12 rounded-md overflow-hidden shrink-0 border border-cyan-500/30 bg-slate-800">
            <img 
              src={topic.personAvatar || topic.imageUrl} 
              alt={topic.personName || topic.headline}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="h-12 w-12 rounded-md bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0 border border-slate-600/30">
            <MessageSquare className="h-5 w-5 text-slate-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-bold text-lg leading-tight">{topic.headline}</h3>
          {topic.personName && (
            <span className="text-xs text-cyan-400">{topic.personName}</span>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-5 flex-grow">{topic.description}</p>
      
      {!voted ? (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleVote('support')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
            data-testid={`button-support-${topic.id}`}
          >
            <ThumbsUp className="h-4 w-4 shrink-0" />
            <span>Support</span>
          </button>
          <button
            onClick={() => handleVote('neutral')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15"
            data-testid={`button-neutral-${topic.id}`}
          >
            <Minus className="h-4 w-4 shrink-0" />
            <span>Neutral</span>
          </button>
          <button
            onClick={() => handleVote('oppose')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
            data-testid={`button-oppose-${topic.id}`}
          >
            <ThumbsDown className="h-4 w-4 shrink-0" />
            <span>Oppose</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
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
              <span>{topic.totalVotes.toLocaleString()} total votes</span>
            </div>
            <div 
              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                voted === 'support' 
                  ? 'bg-[#00C853]/10 border-[#00C853]/40 text-[#00C853]' 
                  : voted === 'oppose'
                  ? 'bg-[#FF0000]/10 border-[#FF0000]/40 text-[#FF0000]'
                  : 'bg-slate-500/10 border-slate-500/40 text-slate-400'
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
  );
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
  const sliderSettings = {
    dots: false,
    infinite: false,
    speed: 300,
    slidesToShow: 3,
    slidesToScroll: 1,
    arrows: true,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 2,
        }
      },
      {
        breakpoint: 640,
        settings: {
          slidesToShow: 1,
          centerMode: true,
          centerPadding: '20px',
        }
      }
    ]
  };

  return (
    <section className="mb-10">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-serif font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      
      <div className="predict-carousel -mx-2">
        <Slider {...sliderSettings}>
          {children}
        </Slider>
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
      <span className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
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
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-cyan-500/10 transition-colors flex items-center gap-2 border-b border-border bg-gradient-to-r from-cyan-500/5 to-transparent"
                data-testid="option-create-custom-topic"
              >
                <div className="h-7 w-7 rounded-md bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-cyan-400">Create Custom Topic</span>
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
                <div className="h-7 w-7 rounded-md bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                  <Plus className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <div className="flex flex-col">
                  <span>Use "<span className="font-medium text-violet-400">{value}</span>" as Custom Topic</span>
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

// Contender Selection for Face-Off modal - supports celebrities with auto-images and custom entries with uploads
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
                <span className="text-cyan-400">FameDex Celebrity</span>
              ) : (
                <span className="text-violet-400">Custom Contender</span>
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
          <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5">
            <Upload className="h-4 w-4 text-amber-400" />
            <span className="text-sm text-amber-400">Image required for custom contenders</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="ml-auto border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
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
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-violet-500/10 transition-colors flex items-center gap-2 border-b border-border bg-gradient-to-r from-violet-500/5 to-transparent"
                  data-testid={`${testIdPrefix}-custom-option`}
                >
                  <div className="h-8 w-8 rounded-md bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                    <Plus className="h-4 w-4 text-violet-400" />
                  </div>
                  <div className="flex flex-col">
                    <span>Use "<span className="font-medium text-violet-400">{searchQuery}</span>" as Custom Contender</span>
                    <span className="text-xs text-muted-foreground">Image upload required</span>
                  </div>
                </button>
              )}

              {/* Celebrity suggestions */}
              {hasMatchingCelebrities ? (
                <>
                  <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border">
                    FameDex Celebrities
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
                          {celebrity.category} • Auto-image
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-300 border-cyan-400/30">
                        <Check className="h-3 w-3 mr-1" />
                        Auto
                      </Badge>
                    </button>
                  ))}
                </>
              ) : searchQuery.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                  Type to search FameDex celebrities or enter a custom name
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
  Tech: Cpu,
  Politics: Landmark,
  Business: Briefcase,
  Entertainment: Clapperboard,
  Sports: Trophy,
  Creator: Video,
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
    if (isCustomTopic) return "Custom Topic";
    return category;
  };

  const getTestId = () => {
    if (isCustomTopic) return `${testIdPrefix}-custom-topic`;
    return `${testIdPrefix}-${category.toLowerCase()}`;
  };

  return (
    <button
      onClick={handleClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 ${
        isActive
          ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
          : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
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

export default function VotePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { favorites, favoriteIds, isAuthenticated } = useFavorites();
  
  const handleAuthRequired = () => {
    setLocation("/login");
  };
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [inductionSuggestOpen, setInductionSuggestOpen] = useState(false);
  const [faceOffSuggestOpen, setFaceOffSuggestOpen] = useState(false);
  const [curateSuggestOpen, setCurateSuggestOpen] = useState(false);
  const [curateCelebrity, setCurateCelebrity] = useState("");
  const [curateImageFile, setCurateImageFile] = useState<File | null>(null);
  const [curateImageSource, setCurateImageSource] = useState("");
  const [suggestName, setSuggestName] = useState("");
  const [suggestCategory, setSuggestCategory] = useState("");
  const [suggestReason, setSuggestReason] = useState("");
  const [suggestUrl, setSuggestUrl] = useState("");
  const [faceOffHeadline, setFaceOffHeadline] = useState("");
  const [faceOffContenderA, setFaceOffContenderA] = useState<ContenderSelection>({ type: null, name: '' });
  const [faceOffContenderB, setFaceOffContenderB] = useState<ContenderSelection>({ type: null, name: '' });
  const [faceOffCategory, setFaceOffCategory] = useState("");
  const [totalVotes] = useState(127843);
  const [countdown, setCountdown] = useState("2d 14h 32m");
  
  const [xp, setXp] = useState(120);
  const [rank] = useState("Citizen");
  const [xpFloaters, setXpFloaters] = useState<XPFloater[]>([]);
  const floaterIdRef = useRef(0);
  
  const dragScrollRef1 = useDragScroll<HTMLDivElement>();
  const dragScrollRef2 = useDragScroll<HTMLDivElement>();
  const dragScrollRef3 = useDragScroll<HTMLDivElement>();
  const dragScrollRef4 = useDragScroll<HTMLDivElement>();
  const dragScrollRef5 = useDragScroll<HTMLDivElement>();
  const dragScrollRef6 = useDragScroll<HTMLDivElement>();
  const dragScrollRef7 = useDragScroll<HTMLDivElement>();

  const [currentCurateIndex, setCurrentCurateIndex] = useState(0);
  
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [candidateVotes, setCandidateVotes] = useState<Record<string, number>>(() => {
    const votes: Record<string, number> = {};
    INDUCTION_CANDIDATES.forEach(c => { votes[c.id] = c.votes; });
    return votes;
  });

  const [inductionCategoryFilter, setInductionCategoryFilter] = useState<FilterCategory>("All");
  const [inductionSearchQuery, setInductionSearchQuery] = useState("");
  const [inductionOverlayOpen, setInductionOverlayOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [topicsCategoryFilter, setTopicsCategoryFilter] = useState<FilterCategory>("All");
  const [topicsSearchQuery, setTopicsSearchQuery] = useState("");
  const [topicsOverlayOpen, setTopicsOverlayOpen] = useState(false);
  const [startPollModalOpen, setStartPollModalOpen] = useState(false);
  
  const [faceOffsCategoryFilter, setFaceOffsCategoryFilter] = useState<FilterCategory>("All");
  const [faceOffsSearchQuery, setFaceOffsSearchQuery] = useState("");
  const [faceOffsOverlayOpen, setFaceOffsOverlayOpen] = useState(false);
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
  const [rulesModalOpen, setRulesModalOpen] = useState<string | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState<"voxpopuli" | "governance" | null>(null);
  const [curateCategoryFilter, setCurateCategoryFilter] = useState<FilterCategory>("All");
  const [globalVoteSearchQuery, setGlobalVoteSearchQuery] = useState("");
  const [globalCategoryFilter, setGlobalCategoryFilter] = useState<FilterCategory>("All");
  
  const [valuePerceptionOverlayOpen, setValuePerceptionOverlayOpen] = useState(false);
  const [valuePerceptionCategoryFilter, setValuePerceptionCategoryFilter] = useState<FilterCategory>("All");
  const [valuePerceptionSearchQuery, setValuePerceptionSearchQuery] = useState("");
  const [curateSearchQuery, setCurateSearchQuery] = useState("");

  const enrichedCandidates = INDUCTION_CANDIDATES.map(c => ({
    ...c,
    votes: candidateVotes[c.id] ?? c.votes
  }));
  
  const filteredCandidates = enrichedCandidates.filter(c => {
    const matchesCategory = inductionCategoryFilter === "All" || c.category === inductionCategoryFilter;
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

  const filteredTopics = dbPolls.filter((t: any) => {
    const matchesCategory = topicsCategoryFilter === "All" || t.category === topicsCategoryFilter;
    const matchesSearch = t.headline.toLowerCase().includes(topicsSearchQuery.toLowerCase()) ||
                         (t.description || '').toLowerCase().includes(topicsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const { data: detailImages = [] } = useQuery<CelebrityImage[]>({
    queryKey: ['/api/people', selectedCuratePerson?.personId, 'images'],
    enabled: !!selectedCuratePerson,
  });

  const detailTotalVotes = useMemo(() => {
    return detailImages.reduce((sum, img) => sum + img.votesUp + img.votesDown, 0);
  }, [detailImages]);

  const { data: faceOffs = [], isLoading: faceOffsLoading } = useQuery<FaceOffData[]>({
    queryKey: ['/api/face-offs'],
    staleTime: 60 * 1000,
  });
  
  const { data: existingFaceOffVotes = {} } = useQuery<Record<string, string>>({
    queryKey: ['/api/face-offs/user-votes'],
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
      userValueVote: string | null;
    }>;
  }
  
  const { data: valueCelebritiesData } = useQuery<ValueLeaderboardResponse>({
    queryKey: ['/api/leaderboard?tab=value&limit=20'],
    staleTime: 60 * 1000,
  });
  
  const valueCelebrities = valueCelebritiesData?.data || [];
  
  const filteredValueCelebrities = valueCelebrities.filter(c => {
    const matchesCategory = valuePerceptionCategoryFilter === "All" || c.category === valuePerceptionCategoryFilter;
    const matchesSearch = !valuePerceptionSearchQuery || c.name.toLowerCase().includes(valuePerceptionSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });
  
  const [localFaceOffVotes, setLocalFaceOffVotes] = useState<Record<string, string>>({});
  
  const faceOffUserVotes = { ...existingFaceOffVotes, ...localFaceOffVotes };
  
  const faceOffVoteMutation = useMutation({
    mutationFn: async ({ faceOffId, option }: { faceOffId: string; option: 'option_a' | 'option_b' }) => {
      const response = await apiRequest('POST', `/api/face-offs/${faceOffId}/vote`, { option });
      return response.json();
    },
    onSuccess: (data, variables) => {
      setLocalFaceOffVotes((prev: Record<string, string>) => ({ ...prev, [variables.faceOffId]: variables.option }));
      queryClient.invalidateQueries({ queryKey: ['/api/face-offs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/face-offs/user-votes'] });
      toast({
        title: "Vote recorded!",
        description: "Your Face-Off vote has been counted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit vote",
        variant: "destructive",
      });
    },
  });
  
  const handleFaceOffVote = (faceOffId: string, option: 'option_a' | 'option_b', event?: React.MouseEvent) => {
    faceOffVoteMutation.mutate({ faceOffId, option });
    if (event) {
      addXP(5, event);
    }
  };
  
  const filteredFaceOffs = faceOffs.filter(f => {
    const matchesCategory = faceOffsCategoryFilter === "All" || f.category === faceOffsCategoryFilter;
    const matchesSearch = f.title.toLowerCase().includes(faceOffsSearchQuery.toLowerCase()) ||
                         f.optionAText.toLowerCase().includes(faceOffsSearchQuery.toLowerCase()) ||
                         f.optionBText.toLowerCase().includes(faceOffsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch && f.isActive;
  });

  useEffect(() => {
    if (inductionOverlayOpen || topicsOverlayOpen || suggestModalOpen || startPollModalOpen || faceOffsOverlayOpen || inductionSuggestOpen || faceOffSuggestOpen || valuePerceptionOverlayOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [inductionOverlayOpen, topicsOverlayOpen, suggestModalOpen, startPollModalOpen, faceOffsOverlayOpen, inductionSuggestOpen, faceOffSuggestOpen, valuePerceptionOverlayOpen]);

  const addXP = (amount: number, event?: React.MouseEvent) => {
    setXp(prev => prev + amount);
    
    const x = event ? event.clientX - 40 : window.innerWidth / 2;
    const y = event ? event.clientY - 20 : 100;
    
    const newFloater: XPFloater = {
      id: floaterIdRef.current++,
      x,
      y,
      amount
    };
    
    setXpFloaters(prev => [...prev, newFloater]);
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
    setFaceOffsCategoryFilter(globalCategoryFilter);
    setTopicsCategoryFilter(globalCategoryFilter);
    setInductionCategoryFilter(globalCategoryFilter);
    setCurateCategoryFilter(globalCategoryFilter);
  }, [globalCategoryFilter]);

  const handleToggleVote = (candidateId: string) => {
    setVotedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(candidateId)) {
        newSet.delete(candidateId);
        setCandidateVotes(v => ({ ...v, [candidateId]: (v[candidateId] || 0) - 1 }));
      } else {
        newSet.add(candidateId);
        setCandidateVotes(v => ({ ...v, [candidateId]: (v[candidateId] || 0) + 1 }));
      }
      return newSet;
    });
  };

  const handleInductionXP = (event: React.MouseEvent) => {
    addXP(10, event);
  };

  const handleCurateVote = (event?: React.MouseEvent) => {
    addXP(10, event as React.MouseEvent);
  };

  const handleCurateComplete = () => {
    if (currentCurateIndex < curateProfilePolls.length - 1) {
      setCurrentCurateIndex(prev => prev + 1);
    }
  };

  const handleDiscourseVote = (topicId: string, choice: 'support' | 'neutral' | 'oppose', event?: React.MouseEvent) => {
    addXP(20, event as React.MouseEvent);
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

  const handlePollSubmit = () => {
    if (pollHeadline && pollCategory) {
      setStartPollModalOpen(false);
      setPollHeadline("");
      setPollCategory("");
      setPollDescription("");
      setPollEntitySearch("");
      setPollSubjectType(null);
      setPollSubjectImage(null);
      setPollSubjectImagePreview(null);
      toast({
        title: "Poll submitted",
        description: "Thanks - your poll was submitted for review.",
      });
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

  const currentCuratePoll = curateProfilePolls[currentCurateIndex];

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
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">FameDex</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Link href="/#leaderboard">
                <Button variant="ghost" size="sm" data-testid="link-nav-leaderboard">Leaderboard</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm" className="text-cyan-400" data-testid="link-nav-vote">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm" data-testid="link-nav-predict">Predict</Button>
              </Link>
            </div>
            
            <UserMenu />
          </div>
        </div>
      </header>
      <div 
        className="sticky top-16 z-40 bg-background/80 backdrop-blur-xl border-b"
        data-testid="section-toggles-container"
      >
        <div className="container mx-auto px-4 py-3 max-w-7xl">
          <div ref={dragScrollRef1} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 relative">
            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none z-10 md:hidden" />
            {SECTION_TOGGLES.map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit ${
                  activeSection === section
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-400/40 shadow-sm shadow-cyan-500/20"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
                }`}
                data-testid={`toggle-section-${section.toLowerCase().replace(/['\s]/g, '-')}`}
              >
                {section === "Face-Offs" && <Swords className="h-4 w-4" />}
                {section === "Trending Polls" && <MessageSquare className="h-4 w-4" />}
                {section === "Induction Queue" && <UserPlus className="h-4 w-4" />}
                {section === "Curate Profile" && <ImageIcon className="h-4 w-4" />}
                {section}
              </button>
            ))}
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10 md:hidden" />
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-4 max-w-7xl">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-[420px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search votes..."
              value={globalVoteSearchQuery}
              onChange={(e) => setGlobalVoteSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-global-vote-search"
            />
          </div>
          
          <div ref={dragScrollRef2} className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {getFilterCategories(false).map((cat) => (
              <FilterChip
                key={cat}
                category={cat}
                isActive={globalCategoryFilter === cat}
                onClick={() => setGlobalCategoryFilter(cat as FilterCategory)}
                testIdPrefix="chip-category"
                user={user}
                onAuthRequired={handleAuthRequired}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 max-w-7xl pt-[5px] pb-[5px]">
        {/* VOX POPULI HEADER - Above Face-Offs + Trending Polls */}
        {(activeSection === "All" || isPublicOpinionSection(activeSection)) && (
        <div className="relative overflow-hidden mb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent" />
          <div className="relative py-4">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2" data-testid="text-voxpopuli-title">
                The Voice of the People
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto mb-3">
                Your votes capture what the world thinks — across rumors, ideas, and events.
              </p>
              <button
                onClick={() => setInfoModalOpen("voxpopuli")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/30 transition-all cursor-pointer"
                data-testid="button-voxpopuli-info"
              >
                <Sparkles className="h-4 w-4 text-cyan-400" />
                <span className="text-sm text-cyan-400 font-medium">Vox Populi</span>
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ZONE 1: Public Opinion - Face-Offs Section (First) */}
        {(activeSection === "All" || activeSection === "Face-Offs") && (
        <section className="mb-10">
          <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <Swords className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold">Face-Offs</h2>
                  <p className="text-sm text-muted-foreground">Vote on A vs B matchups. Which do your prefer?</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("faceoffs")}
                      className="text-cyan-400 hover:text-cyan-300"
                      data-testid="button-rules-faceoffs"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-900/95 border-slate-700 text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => setFaceOffSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-faceoff"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setFaceOffSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-faceoff-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div ref={dragScrollRef3} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
              {getFilterCategories(true).map((cat) => (
                <FilterChip
                  key={cat}
                  category={cat}
                  isActive={faceOffsCategoryFilter === cat}
                  onClick={() => setFaceOffsCategoryFilter(cat as FilterCategory)}
                  testIdPrefix="filter-faceoffs"
                  user={user}
                  onAuthRequired={handleAuthRequired}
                />
              ))}
            </div>
            <div className="relative flex-1 max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search matchups..."
                value={faceOffsSearchQuery}
                onChange={(e) => setFaceOffsSearchQuery(e.target.value)}
                className="pl-10 h-9 bg-slate-800/30 border-slate-700/40"
                data-testid="input-faceoffs-search"
              />
            </div>
          </div>
          
          {faceOffsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3].map(i => (
                <Card key={i} className="h-40 bg-slate-800/30 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredFaceOffs.slice(0, 3).map((faceOff) => (
                <VersusCard 
                  key={faceOff.id} 
                  faceOff={faceOff} 
                  userVote={faceOffUserVotes[faceOff.id] || null}
                  onVote={handleFaceOffVote}
                />
              ))}
            </div>
          )}

          {filteredFaceOffs.length === 0 && !faceOffsLoading && (
            <div className="text-center py-8 text-muted-foreground">
              No face-offs match your filter criteria.
            </div>
          )}

          <div className="text-center mt-6">
            <Button
              variant="ghost"
              onClick={() => setFaceOffsOverlayOpen(true)}
              className="text-cyan-400 hover:text-cyan-300"
              data-testid="button-view-all-faceoffs"
            >
              View all matchups
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* ZONE 1: Public Opinion - Trending Polls Section (Second) */}
        {(activeSection === "All" || activeSection === "Trending Polls") && (
        <section className="mb-10">
          <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold">Trending Polls</h2>
                  <p className="text-sm text-muted-foreground">Weigh in on current events and controversies.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("voice")}
                      className="text-cyan-400 hover:text-cyan-300"
                      data-testid="button-rules-voice"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-900/95 border-slate-700 text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => setStartPollModalOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-poll"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setStartPollModalOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-poll-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div ref={dragScrollRef4} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
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
            </div>
            <div className="relative flex-1 max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search topics..."
                value={topicsSearchQuery}
                onChange={(e) => setTopicsSearchQuery(e.target.value)}
                className="pl-10 h-9 bg-slate-800/30 border-slate-700/40"
                data-testid="input-topics-search"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTopics.slice(0, 3).map((topic) => (
              <DiscourseCard 
                key={topic.id} 
                topic={topic} 
                onVote={(choice) => handleDiscourseVote(topic.id, choice)} 
              />
            ))}
          </div>

          {filteredTopics.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No topics match your filter criteria.
            </div>
          )}

          <div className="text-center mt-6">
            <Button
              variant="ghost"
              onClick={() => setTopicsOverlayOpen(true)}
              className="text-cyan-400 hover:text-cyan-300"
              data-testid="button-view-all-topics"
            >
              View all topics
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* ZONE 2: Value Perception - Underrated/Overrated Section */}
        {activeSection === "All" && (
        <section className="mb-10">
          <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <BarChart3 className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold">Underrated / Overrated</h2>
                  <p className="text-sm text-muted-foreground">How does the public rate them — overhyped or underappreciated?</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("value")}
                      className="text-cyan-400"
                      data-testid="button-rules-value"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-900/95 border-slate-700 text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div ref={dragScrollRef5} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
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
            </div>
            <div className="relative flex-1 max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search celebrities..."
                value={valuePerceptionSearchQuery}
                onChange={(e) => setValuePerceptionSearchQuery(e.target.value)}
                className="pl-10 h-9 bg-slate-800/30 border-slate-700/40"
                data-testid="input-value-search"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredValueCelebrities.slice(0, 3).map((person) => (
              <UnderratedOverratedCard 
                key={person.id} 
                person={person}
                onVisitProfile={() => setLocation(`/celebrity/${person.id}`)}
              />
            ))}
          </div>

          {filteredValueCelebrities.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No celebrities match your filter criteria.
            </div>
          )}

          <div className="text-center mt-6">
            <Button
              variant="ghost"
              onClick={() => setValuePerceptionOverlayOpen(true)}
              className="text-cyan-400"
              data-testid="button-view-all-value"
            >
              View all celebrities
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </section>
        )}

        {/* GOVERNANCE HEADER DIVIDER - Shows between Zone 1 and Zone 3 */}
        {/* Show when: All, Induction Queue, or Curate Profile is selected */}
        {/* Hide when: Face-Offs or Trending Polls is selected */}
        {(activeSection === "All" || isGovernanceSection(activeSection)) && (
        <div className="relative overflow-hidden mb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent" />
          <div className="relative py-4">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2" data-testid="text-governance-title">
                Shape the FameDex
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto mb-3">
                Vote on new inductees and curate profile images. Your opinion powers the index.
              </p>
              <button
                onClick={() => setInfoModalOpen("governance")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/30 transition-all cursor-pointer"
                data-testid="button-governance-info"
              >
                <Sparkles className="h-4 w-4 text-cyan-400" />
                <span className="text-sm text-cyan-400 font-medium">Community Governance</span>
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ZONE 3: Governance - Induction Queue Section */}
        {(activeSection === "All" || activeSection === "Induction Queue") && (
        <section className="mb-10">
          <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <Vote className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold">The Induction Queue</h2>
                  <p className="text-sm text-muted-foreground">Vote on which celebrity joins the main leaderboard next.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("induction")}
                      className="text-cyan-400 hover:text-cyan-300"
                      data-testid="button-rules-induction"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-900/95 border-slate-700 text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => setInductionSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-induction"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setInductionSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-induction-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border bg-slate-800/50 border-slate-700/60">
              <Clock className="h-3 w-3 text-cyan-400" />
              <span className="text-slate-300">Ends in: {countdown}</span>
            </div>
            <div className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border bg-slate-800/50 border-slate-700/60">
              <Star className="h-3 w-3 text-amber-400" />
              <span className="text-slate-300">Top 1 will be inducted</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div ref={dragScrollRef6} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
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
            </div>
            <div className="relative flex-1 max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={inductionSearchQuery}
                onChange={(e) => setInductionSearchQuery(e.target.value)}
                className="pl-10 h-9 bg-slate-800/30 border-slate-700/40"
                data-testid="input-induction-search"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {filteredCandidates.slice(0, 3).map((candidate, index) => (
              <InductionCandidateCard
                key={candidate.id}
                candidate={candidate}
                rank={index + 1}
                maxVotes={filteredMaxVotes}
                isVoted={votedIds.has(candidate.id)}
                onToggleVote={handleToggleVote}
                onXPGain={handleInductionXP}
              />
            ))}
          </div>

          {filteredCandidates.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No candidates match your filter criteria.
            </div>
          )}

          <div className="text-center mb-6">
            <Button
              variant="ghost"
              onClick={() => setInductionOverlayOpen(true)}
              className="text-cyan-400 hover:text-cyan-300"
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
          <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <Camera className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold">Curate the Profile</h2>
                  <p className="text-sm text-muted-foreground">Winner becomes the default profile photo across FameDex.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRulesModalOpen("curate")}
                      className="text-cyan-400 hover:text-cyan-300"
                      data-testid="button-rules-curate"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-900/95 border-slate-700 text-slate-200 text-xs">
                    How it works
                  </TooltipContent>
                </Tooltip>
                <Button
                  onClick={() => setCurateSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-curate"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest
                </Button>
                <Button
                  size="icon"
                  onClick={() => setCurateSuggestOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-curate-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div ref={dragScrollRef7} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
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
            </div>
            <div className="relative flex-1 max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search celebrities..."
                value={curateSearchQuery}
                onChange={(e) => setCurateSearchQuery(e.target.value)}
                className="pl-10 h-9 bg-slate-800/30 border-slate-700/40"
                data-testid="input-curate-search"
              />
            </div>
          </div>

          <div className="max-w-md mx-auto">
            <CurateSection categoryFilter={curateCategoryFilter} />
          </div>
        </section>
        )}
      </div>
      <Dialog open={startPollModalOpen} onOpenChange={setStartPollModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-cyan-400" />
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
                <span className={`text-xs ${pollHeadline.length > 80 ? 'text-red-400' : 'text-muted-foreground'}`}>
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
                <div className={`mt-2 text-xs flex items-center gap-1.5 ${pollSubjectType === 'custom' ? 'text-violet-400' : 'text-cyan-400'}`}>
                  {pollSubjectType === 'custom' ? (
                    <>
                      <Sparkles className="h-3 w-3" />
                      Custom Topic
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
                <div className="mt-3 p-3 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5">
                  <label className="text-sm font-medium mb-2 block text-amber-400">Topic Image (Optional)</label>
                  {pollSubjectImagePreview ? (
                    <div className="flex items-center gap-3">
                      <div className="h-16 w-16 rounded-md overflow-hidden border border-amber-500/30 bg-slate-800">
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
                          className="text-xs text-red-400 hover:underline mt-1"
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
                        ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                        : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
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
              disabled={!pollHeadline || !pollEntitySearch}
              className="bg-cyan-500 text-white"
              data-testid="button-submit-poll"
            >
              Submit Poll
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={faceOffSuggestOpen} onOpenChange={setFaceOffSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-cyan-400" />
              Suggest a Face-Off
            </DialogTitle>
            <DialogDescription>
              Create an A vs B matchup for the community to vote on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Headline *</label>
                <span className={`text-xs ${faceOffHeadline.length > 60 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  {faceOffHeadline.length}/60
                </span>
              </div>
              <Input
                value={faceOffHeadline}
                onChange={(e) => setFaceOffHeadline(e.target.value.slice(0, 60))}
                placeholder="e.g. Battle of the Brands"
                data-testid="input-faceoff-headline"
              />
            </div>
            <ContenderSelector
              value={faceOffContenderA}
              onChange={setFaceOffContenderA}
              label="Contender A *"
              placeholder="Search celebrity or enter name..."
              testIdPrefix="faceoff-contender-a"
            />
            <ContenderSelector
              value={faceOffContenderB}
              onChange={setFaceOffContenderB}
              label="Contender B *"
              placeholder="Search celebrity or enter name..."
              testIdPrefix="faceoff-contender-b"
            />
            <div>
              <label className="text-sm font-medium mb-1 block">Category *</label>
              <Select value={faceOffCategory} onValueChange={setFaceOffCategory}>
                <SelectTrigger data-testid="select-faceoff-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Entertainment">Entertainment</SelectItem>
                  <SelectItem value="Tech">Tech</SelectItem>
                  <SelectItem value="Creator">Creator</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Politics">Politics</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="misc">Custom Topic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFaceOffSuggestOpen(false)} data-testid="button-cancel-faceoff">Cancel</Button>
            <Button 
              onClick={() => {
                toast({
                  title: "Face-Off Suggested!",
                  description: `Your matchup "${faceOffContenderA.name} vs ${faceOffContenderB.name}" has been submitted for review.`,
                });
                setFaceOffHeadline("");
                setFaceOffContenderA({ type: null, name: '' });
                setFaceOffContenderB({ type: null, name: '' });
                setFaceOffCategory("");
                setFaceOffSuggestOpen(false);
              }}
              disabled={
                !faceOffHeadline || 
                !faceOffCategory ||
                !faceOffContenderA.type ||
                !faceOffContenderB.type ||
                (faceOffContenderA.type === 'custom' && !faceOffContenderA.uploadedPreview) ||
                (faceOffContenderB.type === 'custom' && !faceOffContenderB.uploadedPreview)
              }
              className="bg-cyan-500 text-white"
              data-testid="button-submit-faceoff"
            >
              Submit Face-Off
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={inductionSuggestOpen} onOpenChange={setInductionSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-cyan-400" />
              Suggest a Candidate
            </DialogTitle>
            <DialogDescription>
              Who are we missing? Suggest someone NEW to be added to FameDex.
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
                <p className="text-xs text-red-400 mt-1">Please enter a valid URL starting with http:// or https://</p>
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
                  <SelectItem value="Entertainment">Entertainment</SelectItem>
                  <SelectItem value="Tech">Tech</SelectItem>
                  <SelectItem value="Creator">Creator</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Politics">Politics</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Why should they be on FameDex? (optional)</label>
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
              onClick={() => {
                toast({
                  title: "Candidate Suggested!",
                  description: `Your suggestion for "${suggestName}" has been submitted for review.`,
                });
                setSuggestName("");
                setSuggestUrl("");
                setSuggestCategory("");
                setSuggestReason("");
                setInductionSuggestOpen(false);
              }}
              disabled={!suggestName || !suggestUrl || !suggestUrl.startsWith('http')}
              className="bg-cyan-500 text-white"
              data-testid="button-submit-induction"
            >
              Submit Suggestion
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Curate Profile Suggest Modal */}
      <Dialog open={curateSuggestOpen} onOpenChange={setCurateSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-cyan-400" />
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
                    <div className="flex items-center justify-center gap-2 text-cyan-400">
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
              onClick={() => {
                toast({
                  title: "Image Submitted!",
                  description: `Your image for "${curateCelebrity}" has been submitted for review.`,
                });
                setCurateCelebrity("");
                setCurateImageFile(null);
                setCurateImageSource("");
                setCurateSuggestOpen(false);
              }}
              disabled={!curateCelebrity || !curateImageFile}
              className="bg-cyan-500 text-white"
              data-testid="button-submit-curate"
            >
              Submit Image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!rulesModalOpen} onOpenChange={() => setRulesModalOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-cyan-400" />
              {rulesModalOpen === "induction" && "Induction Queue Rules"}
              {rulesModalOpen === "curate" && "Curate the Profile Rules"}
              {rulesModalOpen === "voice" && "Trending Polls Rules"}
              {rulesModalOpen === "faceoffs" && "Face-Offs Rules"}
              {rulesModalOpen === "value" && "How It Works"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 text-sm">
            {rulesModalOpen === "induction" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Vote for celebrities you want to see added to the FameDex leaderboard.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Vote className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Each user can vote <span className="text-cyan-400 font-medium">once per candidate</span></span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Crown className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>The <span className="text-cyan-400 font-medium">#1 candidate</span> is inducted weekly</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-400 font-medium">+5 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Weekly winner gets inducted to the main leaderboard</span>
                  </div>
                </div>
              </div>
            )}
            {rulesModalOpen === "curate" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Help choose the official profile photo displayed across FameDex.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Camera className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Swipe left or right to vote on profile photos</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Crown className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>The winning image becomes the official profile photo</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-400 font-medium">+3 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
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
                    <MessageSquare className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Vote <span className="text-[#00C853] font-medium">Support</span>, <span className="text-slate-400 font-medium">Neutral</span>, or <span className="text-[#FF0000] font-medium">Oppose</span> on various topics.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>See how your vote compares to the community</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-400 font-medium">+20 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Plus className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Submit your own poll topics for community voting</span>
                  </div>
                </div>
              </div>
            )}
            {rulesModalOpen === "faceoffs" && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Pick a side in head-to-head matchups across anything and everything.</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Swords className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Vote A vs B: Choose the winner in quick 1v1 battles.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Globe className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Anything Goes: People, brands, sports, ideas — even random preferences.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-400 font-medium">+20 XP</span>: Get rewarded for every Face-Off vote you cast.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <BarChart3 className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
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
                    <Users className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Compare your view with the community results.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <BarChart3 className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Your vote updates the Underrated/Overrated split in real time.</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Vox Populi Info Modal */}
      <Dialog open={infoModalOpen === "voxpopuli"} onOpenChange={() => setInfoModalOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              The World's Sentiment Engine
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 text-sm">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-400 text-xs font-bold">1</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-400">Cut Through the Noise:</span>
                  <span className="text-muted-foreground"> Headlines only tell half the story. Use Trending Polls to capture what the world actually thinks about today's news.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-400 text-xs font-bold">2</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-400">Pick Your Side:</span>
                  <span className="text-muted-foreground"> From massive beefs to serious debates, align yourself with the winners or defend the underdogs.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-400 text-xs font-bold">3</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-400">Drive the Data:</span>
                  <span className="text-muted-foreground"> Watch the percentages shift live as thousands of users around the world weigh in on the exact same moment.</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Community Governance Info Modal */}
      <Dialog open={infoModalOpen === "governance"} onOpenChange={() => setInfoModalOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              You Run the Show
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 text-sm">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-400 text-xs font-bold">1</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-400">Expand the Roster:</span>
                  <span className="text-muted-foreground"> The leaderboard isn't static. Vote in the Induction Queue to decide exactly who deserves to be added next.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-400 text-xs font-bold">2</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-400">Define the Aesthetic:</span>
                  <span className="text-muted-foreground"> You are the Art Director. Use Curate Profile to swap out bad press photos and choose the definitive image for every star.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-cyan-400 text-xs font-bold">3</span>
                </div>
                <div>
                  <span className="font-medium text-cyan-400">Remove the Gatekeepers:</span>
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
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-serif font-bold">All candidates</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setInductionOverlayOpen(false)}
                data-testid="button-close-candidates-overlay"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="sticky top-0 z-10 p-4 border-b bg-background/95 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2">
                {getFilterCategories(false).map((cat) => (
                  <FilterChip
                    key={cat}
                    category={cat}
                    isActive={inductionCategoryFilter === cat}
                    onClick={() => setInductionCategoryFilter(cat as FilterCategory)}
                    testIdPrefix="filter-overlay-induction"
                    user={user}
                    onAuthRequired={handleAuthRequired}
                  />
                ))}
                <div className="ml-auto">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name..."
                      value={inductionSearchQuery}
                      onChange={(e) => setInductionSearchQuery(e.target.value)}
                      className="pl-10 h-8 w-48 bg-slate-800/30 border-slate-700/40"
                      data-testid="input-overlay-induction-search"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
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
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-serif font-bold">All topics</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTopicsOverlayOpen(false)}
                data-testid="button-close-topics-overlay"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="sticky top-0 z-10 p-4 border-b bg-background/95 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2">
                {getFilterCategories(true).map((cat) => (
                  <FilterChip
                    key={cat}
                    category={cat}
                    isActive={topicsCategoryFilter === cat}
                    onClick={() => setTopicsCategoryFilter(cat as FilterCategory)}
                    testIdPrefix="filter-overlay-topics"
                    user={user}
                    onAuthRequired={handleAuthRequired}
                  />
                ))}
                <div className="ml-auto">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search topics..."
                      value={topicsSearchQuery}
                      onChange={(e) => setTopicsSearchQuery(e.target.value)}
                      className="pl-10 h-8 w-48 bg-slate-800/30 border-slate-700/40"
                      data-testid="input-overlay-topics-search"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
                {filteredTopics.map((topic) => (
                  <DiscourseCard 
                    key={topic.id} 
                    topic={topic} 
                    onVote={(choice) => handleDiscourseVote(topic.id, choice)} 
                  />
                ))}
              </div>
              {filteredTopics.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No topics match your filter criteria.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {faceOffsOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-cyan-500/20">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Swords className="h-4 w-4 text-cyan-400" />
                </div>
                <h2 className="text-xl font-serif font-bold">All Face-Offs</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setFaceOffsOverlayOpen(false)}
                data-testid="button-close-faceoffs-overlay"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="sticky top-0 z-10 p-4 border-b border-cyan-500/10 bg-background/95 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2">
                {getFilterCategories(true).map((cat) => (
                  <FilterChip
                    key={cat}
                    category={cat}
                    isActive={faceOffsCategoryFilter === cat}
                    onClick={() => setFaceOffsCategoryFilter(cat as FilterCategory)}
                    testIdPrefix="filter-overlay-faceoffs"
                    user={user}
                    onAuthRequired={handleAuthRequired}
                  />
                ))}
                <div className="ml-auto">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search matchups..."
                      value={faceOffsSearchQuery}
                      onChange={(e) => setFaceOffsSearchQuery(e.target.value)}
                      className="pl-10 h-8 w-48 bg-slate-800/30 border-slate-700/40"
                      data-testid="input-overlay-faceoffs-search"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
                {filteredFaceOffs.map((faceOff) => (
                  <VersusCard 
                    key={faceOff.id} 
                    faceOff={faceOff} 
                    userVote={faceOffUserVotes[faceOff.id] || null}
                    onVote={handleFaceOffVote}
                  />
                ))}
              </div>
              {filteredFaceOffs.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No face-offs match your filter criteria.
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
            <div className="flex items-center justify-between p-4 border-b border-amber-500/20">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-amber-400" />
                </div>
                <h2 className="text-xl font-serif font-bold">Underrated / Overrated</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setValuePerceptionOverlayOpen(false)}
                data-testid="button-close-value-overlay"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="sticky top-0 z-10 p-4 border-b bg-background/95 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2">
                {getFilterCategories(true).map((cat) => (
                  <FilterChip
                    key={cat}
                    category={cat}
                    isActive={valuePerceptionCategoryFilter === cat}
                    onClick={() => setValuePerceptionCategoryFilter(cat as FilterCategory)}
                    testIdPrefix="filter-overlay-value"
                    user={user}
                    onAuthRequired={handleAuthRequired}
                  />
                ))}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
                {filteredValueCelebrities.map((person) => (
                  <UnderratedOverratedCard 
                    key={person.id} 
                    person={person}
                    onVisitProfile={() => {
                      setValuePerceptionOverlayOpen(false);
                      setLocation(`/celebrity/${person.id}`);
                    }}
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
    </div>
  );
}
