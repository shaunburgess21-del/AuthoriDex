import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryPill } from "@/components/CategoryPill";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  Minus
} from "lucide-react";
import { useLocation, Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
  avatar: string;
  category: string;
  currentVotes: number;
  votesNeeded: number;
}

const inductionCandidates: InductionCandidate[] = [
  { id: "i1", name: "Jensen Huang", avatar: "", category: "Tech", currentVotes: 850, votesNeeded: 1000 },
  { id: "i2", name: "Charli XCX", avatar: "", category: "Music", currentVotes: 720, votesNeeded: 1000 },
  { id: "i3", name: "Kai Cenat", avatar: "", category: "Creator", currentVotes: 945, votesNeeded: 1000 },
  { id: "i4", name: "Sabrina Carpenter", avatar: "", category: "Music", currentVotes: 680, votesNeeded: 1000 },
  { id: "i5", name: "xQc", avatar: "", category: "Creator", currentVotes: 590, votesNeeded: 1000 },
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

const discourseTopics: DiscourseTopicData[] = [
  { 
    id: "d1", 
    headline: "Elon buys Twitter", 
    description: "Was the $44B acquisition a smart move?",
    category: "Tech", 
    approvePercent: 35, 
    neutralPercent: 20, 
    disapprovePercent: 45,
    totalVotes: 89432
  },
  { 
    id: "d2", 
    headline: "AI replacing jobs", 
    description: "Should we embrace or regulate AI in the workplace?",
    category: "Tech", 
    approvePercent: 28, 
    neutralPercent: 32, 
    disapprovePercent: 40,
    totalVotes: 156789
  },
  { 
    id: "d3", 
    headline: "Taylor's Eras Tour pricing", 
    description: "Are dynamic ticket prices fair to fans?",
    category: "Music", 
    approvePercent: 15, 
    neutralPercent: 25, 
    disapprovePercent: 60,
    totalVotes: 234567
  },
];

interface XPFloater {
  id: number;
  x: number;
  y: number;
  amount: number;
}

function InductionCard({ 
  candidate, 
  onVote 
}: { 
  candidate: InductionCandidate; 
  onVote: (id: string) => void;
}) {
  const progress = (candidate.currentVotes / candidate.votesNeeded) * 100;
  const [hasVoted, setHasVoted] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const handleVote = () => {
    if (!hasVoted) {
      setHasVoted(true);
      setShowConfetti(true);
      onVote(candidate.id);
      setTimeout(() => setShowConfetti(false), 1000);
    }
  };

  return (
    <div className="px-2">
      <Card 
        className="p-5 hover:translate-y-[-2px] hover:shadow-lg hover:border-cyan-500/40 transition-all duration-200 relative overflow-hidden"
        data-testid={`card-induction-${candidate.id}`}
      >
        {showConfetti && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-2 left-1/4 w-2 h-2 bg-cyan-400 rounded-full animate-ping" />
            <div className="absolute top-4 right-1/3 w-2 h-2 bg-cyan-300 rounded-full animate-ping delay-100" />
            <div className="absolute top-3 right-1/4 w-2 h-2 bg-cyan-500 rounded-full animate-ping delay-200" />
          </div>
        )}
        
        <div className="flex flex-col items-center text-center mb-4">
          <PersonAvatar name={candidate.name} avatar={candidate.avatar} size="lg" />
          <h3 className="font-semibold mt-3">{candidate.name}</h3>
          <CategoryPill category={candidate.category} data-testid={`badge-category-${candidate.id}`} />
        </div>
        
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Progress</span>
            <span className="text-cyan-400 font-mono">{candidate.currentVotes.toLocaleString()} / {candidate.votesNeeded.toLocaleString()}</span>
          </div>
          <div className="h-3 w-full bg-muted/30 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        
        <Button 
          onClick={handleVote}
          disabled={hasVoted}
          className={`w-full ${hasVoted ? 'bg-cyan-600' : 'bg-cyan-500'} text-white`}
          data-testid={`button-induct-${candidate.id}`}
        >
          <Vote className="h-4 w-4 mr-2" />
          {hasVoted ? 'Voted!' : 'Vote to Induct (+1)'}
        </Button>
      </Card>
    </div>
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

  const handlePick = (choice: 'a' | 'b') => {
    if (!selectedChoice) {
      setSelectedChoice(choice);
      onVote();
      setTimeout(() => {
        setIsExiting(true);
        setTimeout(onComplete, 300);
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
        className="p-4 transition-all duration-200"
        data-testid={`card-curate-${poll.id}`}
      >
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
                className="absolute inset-0 bg-green-500/20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              />
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
                className="absolute inset-0 bg-green-500/20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              />
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
      className="pt-6 px-5 pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full flex flex-col"
      data-testid={`card-discourse-${topic.id}`}
    >
      <CategoryPill category={topic.category} className="mb-3" data-testid={`badge-category-${topic.id}`} />
      <h3 className="font-serif font-bold text-lg mb-1">{topic.headline}</h3>
      <p className="text-sm text-muted-foreground mb-5 flex-grow">{topic.description}</p>
      
      {!voted ? (
        <div className="flex justify-center gap-3">
          <button
            onClick={() => handleVote('oppose')}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
            data-testid={`button-oppose-${topic.id}`}
          >
            <ThumbsDown className="h-4 w-4" />
            Oppose
          </button>
          <button
            onClick={() => handleVote('neutral')}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15"
            data-testid={`button-neutral-${topic.id}`}
          >
            <Minus className="h-4 w-4" />
            Neutral
          </button>
          <button
            onClick={() => handleVote('support')}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
            data-testid={`button-support-${topic.id}`}
          >
            <ThumbsUp className="h-4 w-4" />
            Support
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex h-10 rounded-xl overflow-hidden border border-white/20 bg-white/5 backdrop-blur-sm">
            <div 
              className="flex items-center justify-center text-xs font-bold text-white border-r border-red-400/60 bg-red-500/40 shadow-[inset_0_0_12px_rgba(239,68,68,0.3)] transition-all duration-500"
              style={{ width: `${topic.disapprovePercent}%` }}
            >
              {topic.disapprovePercent}%
            </div>
            <div 
              className="flex items-center justify-center text-xs font-bold text-white border-r border-slate-400/60 bg-slate-500/40 shadow-[inset_0_0_12px_rgba(100,116,139,0.3)] transition-all duration-500"
              style={{ width: `${topic.neutralPercent}%` }}
            >
              {topic.neutralPercent}%
            </div>
            <div 
              className="flex items-center justify-center text-xs font-bold text-white bg-emerald-500/40 shadow-[inset_0_0_12px_rgba(16,185,129,0.3)] transition-all duration-500"
              style={{ width: `${topic.approvePercent}%` }}
            >
              {topic.approvePercent}%
            </div>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            {topic.totalVotes.toLocaleString()} total votes
          </p>
          <button
            onClick={handleChangeVote}
            className="block mx-auto text-xs text-slate-400 hover:text-white transition-colors underline-offset-4 hover:underline"
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
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestCategory, setSuggestCategory] = useState("");
  const [totalVotes] = useState(127843);
  const [countdown, setCountdown] = useState("2d 14h 32m");
  
  const [xp, setXp] = useState(120);
  const [rank] = useState("Citizen");
  const [xpFloaters, setXpFloaters] = useState<XPFloater[]>([]);
  const floaterIdRef = useRef(0);
  
  const [currentCurateIndex, setCurrentCurateIndex] = useState(0);

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

  const handleInductionVote = (candidateId: string, event?: React.MouseEvent) => {
    addXP(10, event as React.MouseEvent);
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
              <Link href="/me">
                <Button variant="ghost" size="sm" data-testid="link-nav-me">Me</Button>
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="sticky top-16 z-40 border-b bg-gradient-to-r from-cyan-500/10 via-background/95 to-cyan-500/10 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-center gap-6 sm:gap-10">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-400" />
              <span className="text-sm text-muted-foreground">Rank:</span>
              <span className="font-bold text-foreground" data-testid="text-user-rank">{rank}</span>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-cyan-400" />
              <span className="text-sm text-muted-foreground">XP:</span>
              <motion.span 
                key={xp}
                className="font-bold font-mono text-cyan-400"
                initial={{ scale: 1.3 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2 }}
                data-testid="text-user-xp"
              >
                {xp.toLocaleString()}
              </motion.span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden">
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
                <p className="text-xs text-muted-foreground">Next Induction In</p>
                <p className="text-lg font-bold font-mono text-cyan-400" data-testid="text-countdown">{countdown}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <CarouselSection
          title="The Induction Queue"
          subtitle="Vote on which celebrity joins the main leaderboard next."
          icon={Vote}
        >
          {inductionCandidates.map((candidate) => (
            <InductionCard 
              key={candidate.id} 
              candidate={candidate} 
              onVote={(id) => handleInductionVote(id)} 
            />
          ))}
        </CarouselSection>

        <section className="mb-10">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
              <Camera className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-xl font-serif font-bold">Curate the Profile</h2>
              <p className="text-sm text-muted-foreground">Decide the official photo displayed across FameDex. Which look defines them?</p>
            </div>
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

        <section className="mb-10">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
              <MessageSquare className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-xl font-serif font-bold">The People's Voice</h2>
              <p className="text-sm text-muted-foreground">You, The People, decide the narrative. Weigh in on the topics that matter.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {discourseTopics.map((topic) => (
              <DiscourseCard 
                key={topic.id} 
                topic={topic} 
                onVote={(choice) => handleDiscourseVote(topic.id, choice)} 
              />
            ))}
          </div>
        </section>
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
              <label className="text-sm font-medium mb-1 block">Name</label>
              <CelebrityAutocomplete 
                value={suggestName}
                onChange={setSuggestName}
                onSelect={setSuggestName}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Category</label>
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
    </div>
  );
}
