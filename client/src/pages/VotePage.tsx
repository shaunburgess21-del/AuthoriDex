import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryPill } from "@/components/CategoryPill";
import { UserMenu } from "@/components/UserMenu";
import { PersonAvatar } from "@/components/PersonAvatar";
import { 
  ArrowLeft, 
  Plus, 
  Vote,
  Users,
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
  Calendar
} from "lucide-react";
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
  category: "Tech" | "Music" | "Creator" | "Sports" | "Business" | "Politics";
  votes: number;
}

const INDUCTION_CANDIDATES: InductionCandidate[] = [
  { id: "i1", name: "Jensen Huang", initials: "JH", category: "Tech", votes: 12406 },
  { id: "i2", name: "Charli XCX", initials: "CX", category: "Music", votes: 11205 },
  { id: "i3", name: "Kai Cenat", initials: "KC", category: "Creator", votes: 10892 },
  { id: "i4", name: "Sabrina Carpenter", initials: "SC", category: "Music", votes: 9847 },
  { id: "i5", name: "Ice Spice", initials: "IS", category: "Music", votes: 8934 },
  { id: "i6", name: "Sam Altman", initials: "SA", category: "Tech", votes: 8421 },
  { id: "i7", name: "Jenna Ortega", initials: "JO", category: "Creator", votes: 7856 },
  { id: "i8", name: "Patrick Mahomes", initials: "PM", category: "Sports", votes: 7234 },
  { id: "i9", name: "Vivek Ramaswamy", initials: "VR", category: "Politics", votes: 6891 },
  { id: "i10", name: "xQc", initials: "XQ", category: "Creator", votes: 6543 },
  { id: "i11", name: "Hailey Bieber", initials: "HB", category: "Creator", votes: 5987 },
  { id: "i12", name: "Mark Cuban", initials: "MC", category: "Business", votes: 5432 },
];

interface CurateProfilePoll {
  id: string;
  personName: string;
  category: string;
}

const curateProfilePolls: CurateProfilePoll[] = [
  { id: "pp1", personName: "Taylor Swift", category: "Music" },
  { id: "pp2", personName: "Elon Musk", category: "Tech" },
  { id: "pp3", personName: "Beyoncé", category: "Music" },
  { id: "pp4", personName: "MrBeast", category: "Creator" },
  { id: "pp5", personName: "Zendaya", category: "Creator" },
  { id: "pp6", personName: "Bad Bunny", category: "Music" },
];

interface DiscourseTopicData {
  id: string;
  headline: string;
  description: string;
  category: string;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  totalVotes: number;
}

const DISCOURSE_TOPICS: DiscourseTopicData[] = [
  { id: "d1", headline: "Elon buys Twitter", description: "Was the $44B acquisition a smart move?", category: "Tech", approvePercent: 35, neutralPercent: 20, disapprovePercent: 45, totalVotes: 89432 },
  { id: "d2", headline: "AI replacing jobs", description: "Should we embrace or regulate AI in the workplace?", category: "Tech", approvePercent: 28, neutralPercent: 32, disapprovePercent: 40, totalVotes: 156789 },
  { id: "d3", headline: "Taylor's Eras Tour pricing", description: "Are dynamic ticket prices fair to fans?", category: "Music", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 234567 },
  { id: "d4", headline: "Spotify's royalty model", description: "Are artists fairly compensated by streaming?", category: "Music", approvePercent: 22, neutralPercent: 28, disapprovePercent: 50, totalVotes: 145678 },
  { id: "d5", headline: "MrBeast's philanthropy", description: "Is it genuine or just content?", category: "Creator", approvePercent: 68, neutralPercent: 20, disapprovePercent: 12, totalVotes: 98765 },
  { id: "d6", headline: "NFL Sunday Ticket pricing", description: "Is streaming football too expensive?", category: "Sports", approvePercent: 18, neutralPercent: 22, disapprovePercent: 60, totalVotes: 76543 },
  { id: "d7", headline: "Meta's rebrand to AI company", description: "Is the pivot from social media working?", category: "Tech", approvePercent: 25, neutralPercent: 35, disapprovePercent: 40, totalVotes: 112345 },
  { id: "d8", headline: "Drake vs Kendrick beef", description: "Who won the rap battle?", category: "Music", approvePercent: 45, neutralPercent: 15, disapprovePercent: 40, totalVotes: 287654 },
  { id: "d9", headline: "LeBron's longevity", description: "Greatest athlete of all time?", category: "Sports", approvePercent: 55, neutralPercent: 25, disapprovePercent: 20, totalVotes: 198765 },
  { id: "d10", headline: "Crypto regulation", description: "Should governments control digital currencies?", category: "Business", approvePercent: 40, neutralPercent: 20, disapprovePercent: 40, totalVotes: 134567 },
  { id: "d11", headline: "TikTok ban debate", description: "National security vs free speech?", category: "Politics", approvePercent: 35, neutralPercent: 30, disapprovePercent: 35, totalVotes: 256789 },
  { id: "d12", headline: "OpenAI board drama", description: "Was firing Sam Altman justified?", category: "Tech", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 189432 },
  { id: "d13", headline: "Beyonce's country album", description: "Authentic exploration or cultural appropriation?", category: "Music", approvePercent: 65, neutralPercent: 20, disapprovePercent: 15, totalVotes: 176543 },
  { id: "d14", headline: "YouTube Premium worth it?", description: "Is ad-free viewing worth the subscription?", category: "Creator", approvePercent: 48, neutralPercent: 22, disapprovePercent: 30, totalVotes: 87654 },
  { id: "d15", headline: "F1's US expansion", description: "Is Formula 1 becoming too commercial?", category: "Sports", approvePercent: 40, neutralPercent: 35, disapprovePercent: 25, totalVotes: 65432 },
  { id: "d16", headline: "Billionaire space race", description: "Vanity project or advancing humanity?", category: "Tech", approvePercent: 30, neutralPercent: 25, disapprovePercent: 45, totalVotes: 145678 },
  { id: "d17", headline: "Student loan forgiveness", description: "Fair policy or overreach?", category: "Politics", approvePercent: 52, neutralPercent: 18, disapprovePercent: 30, totalVotes: 234567 },
  { id: "d18", headline: "Ozempic for weight loss", description: "Medical breakthrough or vanity?", category: "Business", approvePercent: 38, neutralPercent: 32, disapprovePercent: 30, totalVotes: 112345 },
  { id: "d19", headline: "Twitch streamer earnings", description: "Are top streamers overpaid?", category: "Creator", approvePercent: 25, neutralPercent: 35, disapprovePercent: 40, totalVotes: 78965 },
  { id: "d20", headline: "Climate activism tactics", description: "Is disruption effective or counterproductive?", category: "Politics", approvePercent: 35, neutralPercent: 25, disapprovePercent: 40, totalVotes: 167890 },
];

const FILTER_CATEGORIES = ["All", "Tech", "Music", "Sports", "Creator", "Business", "Politics"] as const;
type FilterCategory = typeof FILTER_CATEGORIES[number];

const SECTION_TOGGLES = ["All", "Induction Queue", "Curate Profile", "People's Voice"] as const;
type SectionToggle = typeof SECTION_TOGGLES[number];

const SECTION_RULES = {
  induction: {
    title: "Induction Queue Rules",
    content: "Voted candidates with the most support at the end of the cycle are officially inducted into the FameDex Main Leaderboard. Your vote helps shape who defines the future of fame."
  },
  curate: {
    title: "Curate Profile Rules",
    content: "Which image best represents this celebrity? The winning look becomes the primary profile image across the entire platform. Only the highest quality looks make it to the index."
  },
  voice: {
    title: "People's Voice Rules",
    content: "The ultimate community pulse check. Weigh in on current events and controversies. Evergreen polls remain open; timed polls resolve at the specified deadline."
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
          <div className="h-16 w-16 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center text-lg font-bold text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.15)]">
            {candidate.initials}
          </div>
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
            Vote to Induct (+1)
          </>
        )}
      </Button>
    </Card>
  );
}

function CurateProfileCard({ 
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">{poll.personName}</h3>
          <CategoryPill category={poll.category} data-testid={`badge-curate-${poll.id}`} />
        </div>
        
        <p className="text-center text-lg font-serif font-bold text-cyan-400 mb-4">Which look defines them?</p>
        
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handlePick('a')}
            disabled={!!selectedChoice}
            className={`relative aspect-square rounded-lg bg-muted flex items-center justify-center border-3 transition-all duration-300 group cursor-pointer overflow-hidden ${
              selectedChoice === 'a' 
                ? 'border-green-500 ring-4 ring-green-500/30 scale-105' 
                : selectedChoice === 'b'
                ? 'border-muted opacity-40 scale-95'
                : 'border-transparent hover:border-cyan-500/50 hover:scale-102'
            }`}
            data-testid={`button-photo-a-${poll.id}`}
          >
            <div className="text-center">
              <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
              <span className="text-sm text-muted-foreground font-medium">Look A</span>
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
            className={`relative aspect-square rounded-lg bg-muted flex items-center justify-center border-3 transition-all duration-300 group cursor-pointer overflow-hidden ${
              selectedChoice === 'b' 
                ? 'border-green-500 ring-4 ring-green-500/30 scale-105' 
                : selectedChoice === 'a'
                ? 'border-muted opacity-40 scale-95'
                : 'border-transparent hover:border-cyan-500/50 hover:scale-102'
            }`}
            data-testid={`button-photo-b-${poll.id}`}
          >
            <div className="text-center">
              <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
              <span className="text-sm text-muted-foreground font-medium">Look B</span>
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
      </Card>
    </motion.div>
  );
}

function DiscourseCard({ 
  topic, 
  onVote 
}: { 
  topic: DiscourseTopicData; 
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
      <h3 className="font-serif font-bold text-lg mb-1">{topic.headline}</h3>
      <p className="text-sm text-muted-foreground mb-5 flex-grow">{topic.description}</p>
      
      {!voted ? (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleVote('support')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
            data-testid={`button-support-${topic.id}`}
          >
            <ThumbsUp className="h-4 w-4 shrink-0" />
            <span>Support</span>
          </button>
          <button
            onClick={() => handleVote('neutral')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15"
            data-testid={`button-neutral-${topic.id}`}
          >
            <Minus className="h-4 w-4 shrink-0" />
            <span>Neutral</span>
          </button>
          <button
            onClick={() => handleVote('oppose')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
            data-testid={`button-oppose-${topic.id}`}
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
            <ThumbsDown className="h-4 w-4 text-red-400 shrink-0" />
            <span className="text-sm text-red-400 w-16 shrink-0">Oppose</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-red-400 rounded-full transition-all duration-500"
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
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' 
                  : voted === 'oppose'
                  ? 'bg-red-500/10 border-red-500/40 text-red-400'
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

function CelebrityAutocomplete({ 
  value, 
  onChange,
  onSelect 
}: { 
  value: string; 
  onChange: (value: string) => void;
  onSelect: (name: string) => void;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value.length >= 1) {
      const filtered = mockCelebrityList.filter(name => 
        name.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 8);
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
    }
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

  const handleSelect = (name: string) => {
    onSelect(name);
    setShowSuggestions(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          ref={inputRef}
          placeholder="Search celebrity name..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => value.length >= 1 && filteredSuggestions.length > 0 && setShowSuggestions(true)}
          className="pl-10"
          data-testid="input-suggest-name"
        />
      </div>
      
      <AnimatePresence>
        {showSuggestions && (
          <motion.div 
            ref={suggestionsRef}
            className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {filteredSuggestions.map((name, index) => (
              <button
                key={name}
                onClick={() => handleSelect(name)}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                data-testid={`suggestion-item-${index}`}
              >
                <PersonAvatar name={name} avatar="" size="sm" />
                <span>{name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function VotePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestCategory, setSuggestCategory] = useState("");
  const [suggestReason, setSuggestReason] = useState("");
  const [suggestUrl, setSuggestUrl] = useState("");
  const [totalVotes] = useState(127843);
  const [countdown, setCountdown] = useState("2d 14h 32m");
  
  const [xp, setXp] = useState(120);
  const [rank] = useState("Citizen");
  const [xpFloaters, setXpFloaters] = useState<XPFloater[]>([]);
  const floaterIdRef = useRef(0);
  
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
  const [pollHeadline, setPollHeadline] = useState("");
  const [pollCategory, setPollCategory] = useState("");
  const [pollDescription, setPollDescription] = useState("");
  const [pollEntitySearch, setPollEntitySearch] = useState("");
  const [isTogglesSticky, setIsTogglesSticky] = useState(false);
  const [curateLeaderboardOpen, setCurateLeaderboardOpen] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const [pollDuration, setPollDuration] = useState<string>("none");
  const [pollCustomDate, setPollCustomDate] = useState("");
  
  const [activeSection, setActiveSection] = useState<SectionToggle>("All");
  const [rulesModalOpen, setRulesModalOpen] = useState<string | null>(null);
  const [curateCategoryFilter, setCurateCategoryFilter] = useState<FilterCategory>("All");

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

  const filteredTopics = DISCOURSE_TOPICS.filter(t => {
    const matchesCategory = topicsCategoryFilter === "All" || t.category === topicsCategoryFilter;
    const matchesSearch = t.headline.toLowerCase().includes(topicsSearchQuery.toLowerCase()) ||
                         t.description.toLowerCase().includes(topicsSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  useEffect(() => {
    if (inductionOverlayOpen || topicsOverlayOpen || suggestModalOpen || startPollModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [inductionOverlayOpen, topicsOverlayOpen, suggestModalOpen, startPollModalOpen]);

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

  useEffect(() => {
    const handleScroll = () => {
      if (heroRef.current) {
        const heroBottom = heroRef.current.getBoundingClientRect().bottom;
        setIsTogglesSticky(heroBottom <= 64);
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
      toast({
        title: "Poll submitted",
        description: "Thanks - your poll was submitted for review.",
      });
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
              onClick={() => setLocation("/")}
              className="md:hidden"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">FameDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="link-nav-home">Home</Button>
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
        ref={heroRef}
        id="hero-section"
        className="relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent" />
        <div className="container mx-auto px-4 py-12 max-w-5xl relative">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-4">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              <span className="text-sm text-cyan-400 font-medium">Community Governance</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-serif font-bold mb-3" data-testid="text-vote-title">
              Shape the FameDex
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Vote on new inductees, curate profile images, and rate global sentiment. Your opinion powers the index.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row justify-center gap-6 mb-8">
            <div className="flex items-center gap-3 px-6 py-3 rounded-lg bg-muted/50 border border-border">
              <Users className="h-5 w-5 text-cyan-400" />
              <div>
                <p className="text-xs text-muted-foreground">Total Votes Cast</p>
                <p className="text-lg font-bold font-mono text-cyan-400" data-testid="text-total-votes">{totalVotes.toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-6 py-3 rounded-lg bg-muted/50 border border-border">
              <Clock className="h-5 w-5 text-cyan-400" />
              <div>
                <p className="text-xs text-muted-foreground">Next Governance Update</p>
                <p className="text-lg font-bold font-mono text-cyan-400" data-testid="text-countdown">{countdown}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div 
        className={`${isTogglesSticky ? 'sticky top-16' : ''} z-40 border-b bg-gradient-to-r from-cyan-500/10 via-background/95 to-cyan-500/10 backdrop-blur-xl transition-all`}
        data-testid="section-toggles-container"
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-2 overflow-x-auto scrollbar-hide py-3 relative">
            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none z-10 md:hidden" />
            {SECTION_TOGGLES.map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  activeSection === section
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm shadow-cyan-500/20"
                    : "bg-background/50 border border-border/50 text-muted-foreground hover:bg-muted/80 hover:border-cyan-400/20"
                }`}
                data-testid={`toggle-section-${section.toLowerCase().replace(/['\s]/g, '-')}`}
              >
                {section}
              </button>
            ))}
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10 md:hidden" />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
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
                  onClick={() => setSuggestModalOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hidden md:flex"
                  data-testid="button-suggest-candidate-header"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Suggest candidate
                </Button>
                <Button
                  size="icon"
                  onClick={() => setSuggestModalOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-suggest-candidate-header-mobile"
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
              <Vote className="h-3 w-3 text-cyan-400" />
              <span className="text-slate-300">Total votes: {totalVotes.toLocaleString()}</span>
            </div>
            <div className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border bg-slate-800/50 border-slate-700/60">
              <Star className="h-3 w-3 text-amber-400" />
              <span className="text-slate-300">Top 1 will be inducted</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setInductionCategoryFilter(cat)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                  inductionCategoryFilter === cat
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                    : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
                }`}
                data-testid={`filter-induction-${cat.toLowerCase()}`}
              >
                {cat}
              </button>
            ))}
            <div className="hidden md:block ml-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name..."
                  value={inductionSearchQuery}
                  onChange={(e) => setInductionSearchQuery(e.target.value)}
                  className="pl-10 h-8 w-48 bg-slate-800/30 border-slate-700/40"
                  data-testid="input-induction-search"
                />
              </div>
            </div>
            <button
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
              className="md:hidden ml-auto rounded-full p-2 bg-slate-800/30 border border-slate-700/40 text-slate-400"
              data-testid="button-mobile-search-toggle"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>

          <AnimatePresence>
            {mobileSearchOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="md:hidden mb-4 overflow-hidden"
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name (e.g. Elon Musk)"
                    value={inductionSearchQuery}
                    onChange={(e) => setInductionSearchQuery(e.target.value)}
                    className="pl-10 bg-slate-800/30 border-slate-700/40"
                    data-testid="input-induction-search-mobile"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Active Voters</p>
              <p className="text-lg font-mono font-semibold text-slate-300">2,847</p>
            </div>
            <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Votes Today</p>
              <p className="text-lg font-mono font-semibold text-slate-300">1,234</p>
            </div>
            <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Your Impact</p>
              <p className="text-lg font-mono font-semibold text-cyan-400">{votedIds.size} candidates</p>
            </div>
          </div>
        </section>
        )}

        {(activeSection === "All" || activeSection === "Curate Profile") && (
        <section className="mb-10">
          <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <Camera className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold">Curate the Profile</h2>
                  <p className="text-sm text-muted-foreground">Winner becomes the default profile photo across the FameDex index.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurateLeaderboardOpen(true)}
                  className="text-cyan-400 hover:text-cyan-300 hidden md:flex"
                  data-testid="button-view-curate-leaderboard"
                >
                  View Leaderboard
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
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
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-2 mb-4 relative">
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-background to-transparent pointer-events-none z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
            {FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCurateCategoryFilter(cat)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                  curateCategoryFilter === cat
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                    : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
                }`}
                data-testid={`filter-curate-${cat.toLowerCase()}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="max-w-md mx-auto">
            <div className="text-center mb-2 text-sm text-muted-foreground">
              {currentCurateIndex + 1} of {curateProfilePolls.length}
            </div>
            <AnimatePresence mode="wait">
              {currentCuratePoll && (
                <CurateProfileCard 
                  key={currentCuratePoll.id}
                  poll={currentCuratePoll} 
                  onVote={handleCurateVote}
                  onComplete={handleCurateComplete}
                />
              )}
            </AnimatePresence>
            {currentCurateIndex >= curateProfilePolls.length - 1 && (
              <div className="text-center mt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setCurrentCurateIndex(0)}
                  className="border-cyan-500/50 text-cyan-400"
                  data-testid="button-curate-start-over"
                >
                  Start Over
                </Button>
              </div>
            )}
          </div>
        </section>
        )}

        {(activeSection === "All" || activeSection === "People's Voice") && (
        <section className="mb-10">
          <div className="relative mb-6 py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500/5 via-cyan-500/10 to-transparent border border-cyan-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold">The People's Voice</h2>
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
                  data-testid="button-start-poll-header"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Start poll
                </Button>
                <Button
                  size="icon"
                  onClick={() => setStartPollModalOpen(true)}
                  className="rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 md:hidden"
                  data-testid="button-start-poll-header-mobile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setTopicsCategoryFilter(cat)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                  topicsCategoryFilter === cat
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                    : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
                }`}
                data-testid={`filter-topics-${cat.toLowerCase()}`}
              >
                {cat}
              </button>
            ))}
            <div className="hidden md:block ml-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search topics..."
                  value={topicsSearchQuery}
                  onChange={(e) => setTopicsSearchQuery(e.target.value)}
                  className="pl-10 h-8 w-48 bg-slate-800/30 border-slate-700/40"
                  data-testid="input-topics-search"
                />
              </div>
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
      </div>

      <button
        onClick={() => setSuggestModalOpen(true)}
        className="fixed bottom-24 md:bottom-8 right-6 h-14 w-14 rounded-full bg-cyan-500 text-white shadow-lg flex items-center justify-center hover:bg-cyan-600 transition-colors z-40"
        data-testid="fab-suggest-candidate"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Dialog open={suggestModalOpen} onOpenChange={setSuggestModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-cyan-400" />
              Suggest a Candidate
            </DialogTitle>
            <DialogDescription>
              Who are we missing? Suggest someone to be added to FameDex.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Candidate name *</label>
              <CelebrityAutocomplete 
                value={suggestName}
                onChange={setSuggestName}
                onSelect={setSuggestName}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Category *</label>
              <Select value={suggestCategory} onValueChange={setSuggestCategory}>
                <SelectTrigger data-testid="select-suggest-category">
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
              <label className="text-sm font-medium mb-1 block">Why should they be on FameDex? (optional)</label>
              <Input
                value={suggestReason}
                onChange={(e) => setSuggestReason(e.target.value)}
                placeholder="Brief reason..."
                data-testid="input-suggest-reason"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Social/profile URL (optional)</label>
              <Input
                value={suggestUrl}
                onChange={(e) => setSuggestUrl(e.target.value)}
                placeholder="https://..."
                data-testid="input-suggest-url"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSuggestModalOpen(false)} data-testid="button-cancel-suggestion">Cancel</Button>
            <Button 
              onClick={handleSuggestSubmit}
              disabled={!suggestName || !suggestCategory}
              className="bg-cyan-500 text-white"
              data-testid="button-submit-suggestion"
            >
              Submit Suggestion
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={startPollModalOpen} onOpenChange={setStartPollModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-cyan-400" />
              Start a Poll
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
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={pollEntitySearch}
                  onChange={(e) => setPollEntitySearch(e.target.value)}
                  placeholder="Search for a celebrity..."
                  className="pl-10"
                  data-testid="input-poll-entity-search"
                />
              </div>
              {pollEntitySearch && (
                <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-border bg-background/95">
                  {mockCelebrityList
                    .filter(name => name.toLowerCase().includes(pollEntitySearch.toLowerCase()))
                    .slice(0, 5)
                    .map((name, idx) => (
                      <button
                        key={name}
                        onClick={() => {
                          setPollCategory(name);
                          setPollEntitySearch(name);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 text-left"
                        data-testid={`poll-entity-option-${idx}`}
                      >
                        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center text-xs font-bold text-cyan-400 border border-cyan-500/30">
                          {name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div className="flex-1">
                          <span className="text-sm font-medium">{name}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Leaderboard
                        </Badge>
                      </button>
                    ))}
                  {mockCelebrityList.filter(name => name.toLowerCase().includes(pollEntitySearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No results found</div>
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

      <Dialog open={!!rulesModalOpen} onOpenChange={() => setRulesModalOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-cyan-400" />
              {rulesModalOpen === "induction" && "Induction Queue Rules"}
              {rulesModalOpen === "curate" && "Curate the Profile Rules"}
              {rulesModalOpen === "voice" && "The People's Voice Rules"}
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
                    <span>Vote Yes/No on community-submitted topics</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>See how your vote compares to the community</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Earn <span className="text-cyan-400 font-medium">+2 XP</span> for each vote</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Plus className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
                    <span>Submit your own poll topics for community voting</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {curateLeaderboardOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-serif font-bold">Curate Profile Leaderboard</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurateLeaderboardOpen(false)}
                data-testid="button-close-curate-leaderboard"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3 max-w-xl mx-auto">
                {curateProfilePolls.slice(0, 10).map((poll, idx) => (
                  <div 
                    key={poll.id}
                    className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 border border-border"
                    data-testid={`curate-leaderboard-item-${idx}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      idx === 0 ? 'bg-yellow-500/20 text-yellow-300' :
                      idx === 1 ? 'bg-slate-400/20 text-slate-300' :
                      idx === 2 ? 'bg-orange-500/20 text-orange-300' :
                      'bg-slate-700/30 text-slate-400'
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center text-sm font-bold text-cyan-400 border border-cyan-500/30">
                      {poll.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{poll.name}</p>
                      <p className="text-xs text-muted-foreground">{poll.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold font-mono text-cyan-400">{((idx + 1) * 1247).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">total votes</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                {FILTER_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setInductionCategoryFilter(cat)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                      inductionCategoryFilter === cat
                        ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                        : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
                    }`}
                    data-testid={`filter-overlay-induction-${cat.toLowerCase()}`}
                  >
                    {cat}
                  </button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
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
                {FILTER_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setTopicsCategoryFilter(cat)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                      topicsCategoryFilter === cat
                        ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                        : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
                    }`}
                    data-testid={`filter-overlay-topics-${cat.toLowerCase()}`}
                  >
                    {cat}
                  </button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
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
    </div>
  );
}
