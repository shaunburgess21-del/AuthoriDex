import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Target, 
  Users, 
  Trophy, 
  Wallet, 
  ListChecks,
  HelpCircle,
  X,
  ChevronRight,
  Clock,
  Search
} from "lucide-react";
import { useLocation, Link } from "wouter";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

interface PredictionMarket {
  id: string;
  personId: string;
  personName: string;
  personAvatar: string;
  currentScore: number;
  change7d: number;
  upMultiplier: number;
  downMultiplier: number;
  endTime: string;
  totalPool: number;
  upPoolPercent: number;
}

const mockMarkets: PredictionMarket[] = [
  {
    id: "market-1",
    personId: "1",
    personName: "Elon Musk",
    personAvatar: "",
    currentScore: 515809,
    change7d: 4.78,
    upMultiplier: 1.7,
    downMultiplier: 2.3,
    endTime: "Sun 23:59 UTC",
    totalPool: 15420,
    upPoolPercent: 58,
  },
  {
    id: "market-2",
    personId: "2",
    personName: "Taylor Swift",
    personAvatar: "",
    currentScore: 489234,
    change7d: -3.2,
    upMultiplier: 2.1,
    downMultiplier: 1.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 12350,
    upPoolPercent: 45,
  },
  {
    id: "market-3",
    personId: "3",
    personName: "MrBeast",
    personAvatar: "",
    currentScore: 504734,
    change7d: -4.95,
    upMultiplier: 1.5,
    downMultiplier: 2.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 9870,
    upPoolPercent: 65,
  },
  {
    id: "market-4",
    personId: "4",
    personName: "Donald Trump",
    personAvatar: "",
    currentScore: 484531,
    change7d: -3.35,
    upMultiplier: 1.4,
    downMultiplier: 3.2,
    endTime: "Sun 23:59 UTC",
    totalPool: 22100,
    upPoolPercent: 72,
  },
  {
    id: "market-5",
    personId: "5",
    personName: "Kim Kardashian",
    personAvatar: "",
    currentScore: 398456,
    change7d: -1.8,
    upMultiplier: 2.2,
    downMultiplier: 1.7,
    endTime: "Sun 23:59 UTC",
    totalPool: 8540,
    upPoolPercent: 42,
  },
  {
    id: "market-6",
    personId: "6",
    personName: "Cristiano Ronaldo",
    personAvatar: "",
    currentScore: 445678,
    change7d: 2.1,
    upMultiplier: 1.9,
    downMultiplier: 2.0,
    endTime: "Sun 23:59 UTC",
    totalPool: 11200,
    upPoolPercent: 51,
  },
];

interface HeadToHeadMarket {
  id: string;
  title: string;
  person1: { name: string; avatar: string };
  person2: { name: string; avatar: string };
  category: string;
  endTime: string;
  totalPool: number;
  person1Percent: number;
}

const headToHeadMarkets: HeadToHeadMarket[] = [
  {
    id: "h2h-1",
    title: "Drake vs Kendrick",
    person1: { name: "Drake", avatar: "" },
    person2: { name: "Kendrick Lamar", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 28450,
    person1Percent: 42,
  },
  {
    id: "h2h-2",
    title: "Musk vs Zuckerberg",
    person1: { name: "Elon Musk", avatar: "" },
    person2: { name: "Mark Zuckerberg", avatar: "" },
    category: "Tech",
    endTime: "Sun 23:59 UTC",
    totalPool: 19200,
    person1Percent: 68,
  },
  {
    id: "h2h-3",
    title: "Swift vs Beyoncé",
    person1: { name: "Taylor Swift", avatar: "" },
    person2: { name: "Beyoncé", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 15780,
    person1Percent: 55,
  },
  {
    id: "h2h-4",
    title: "Ronaldo vs Messi",
    person1: { name: "Cristiano Ronaldo", avatar: "" },
    person2: { name: "Lionel Messi", avatar: "" },
    category: "Sports",
    endTime: "Sun 23:59 UTC",
    totalPool: 34100,
    person1Percent: 48,
  },
];

interface CategoryRaceMarket {
  id: string;
  title: string;
  category: string;
  topContenders: { name: string; avatar: string }[];
  endTime: string;
  totalPool: number;
  timeRemaining: string;
}

const categoryRaceMarkets: CategoryRaceMarket[] = [
  {
    id: "race-1",
    title: "Top Music Gainer",
    category: "Music",
    topContenders: [
      { name: "Taylor Swift", avatar: "" },
      { name: "Drake", avatar: "" },
      { name: "The Weeknd", avatar: "" },
    ],
    endTime: "Sun 23:59 UTC",
    totalPool: 18900,
    timeRemaining: "2d 14h",
  },
  {
    id: "race-2",
    title: "Tech Leader Race",
    category: "Tech",
    topContenders: [
      { name: "Elon Musk", avatar: "" },
      { name: "Jensen Huang", avatar: "" },
      { name: "Sam Altman", avatar: "" },
    ],
    endTime: "Sun 23:59 UTC",
    totalPool: 22400,
    timeRemaining: "2d 14h",
  },
  {
    id: "race-3",
    title: "Sports Star Showdown",
    category: "Sports",
    topContenders: [
      { name: "Cristiano Ronaldo", avatar: "" },
      { name: "LeBron James", avatar: "" },
      { name: "Lionel Messi", avatar: "" },
    ],
    endTime: "Sun 23:59 UTC",
    totalPool: 16500,
    timeRemaining: "2d 14h",
  },
];

interface TopGainerMarket {
  id: string;
  category: string;
  leaders: { name: string; avatar: string; currentGain: number }[];
  totalPool: number;
  endTime: string;
}

const topGainerMarkets: TopGainerMarket[] = [
  {
    id: "gainer-1",
    category: "Music",
    leaders: [
      { name: "Taylor Swift", avatar: "", currentGain: 12450 },
      { name: "Drake", avatar: "", currentGain: 8920 },
      { name: "Bad Bunny", avatar: "", currentGain: 7340 },
    ],
    totalPool: 14200,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-2",
    category: "Tech",
    leaders: [
      { name: "Jensen Huang", avatar: "", currentGain: 15780 },
      { name: "Elon Musk", avatar: "", currentGain: 11200 },
      { name: "Sam Altman", avatar: "", currentGain: 9850 },
    ],
    totalPool: 19800,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-3",
    category: "Entertainment",
    leaders: [
      { name: "MrBeast", avatar: "", currentGain: 18900 },
      { name: "Logan Paul", avatar: "", currentGain: 12100 },
      { name: "KSI", avatar: "", currentGain: 8750 },
    ],
    totalPool: 11500,
    endTime: "Sun 23:59 UTC",
  },
];

const FIRST_VISIT_KEY = "famedex_predict_first_visit";

function FirstTimeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-6 w-6 text-violet-500" />
            Welcome to Prediction Markets
          </DialogTitle>
          <DialogDescription>
            Use virtual credits to predict who's trending next
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <Target className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">1. Pick a Market</h4>
              <p className="text-xs text-muted-foreground">
                Choose from Weekly Up/Down, Head-to-Head battles, or Category Races
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">2. Back Your Prediction</h4>
              <p className="text-xs text-muted-foreground">
                Stake virtual credits on your pick. Your potential return depends on the pool.
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">3. Win from the Pool</h4>
              <p className="text-xs text-muted-foreground">
                If you're right, you share the pool with other winners based on your stake.
              </p>
            </div>
          </div>
          
          <Card className="p-3 bg-violet-500/5 border-violet-500/20">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-violet-500">Parimutuel System:</span> You're betting against other users, not the house. The bigger the pool, the bigger the potential returns!
            </p>
          </Card>
        </div>
        
        <Button onClick={onClose} className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white" data-testid="button-get-started">
          Get Started
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ViewAllModal({ 
  open, 
  onClose, 
  title, 
  children 
}: { 
  open: boolean; 
  onClose: () => void; 
  title: string;
  children: React.ReactNode;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search markets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            data-testid="input-search-markets"
          />
        </div>
        
        <div className="flex-1 overflow-y-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PredictCard({ children, className = "", testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className="relative p-[1px] rounded-xl bg-gradient-to-br from-violet-500/80 via-purple-500/30 to-transparent">
      <Card 
        className={`p-4 bg-card rounded-xl hover:translate-y-[-2px] hover:shadow-lg hover:shadow-violet-500/20 transition-all duration-200 relative z-0 hover:z-10 ${className}`}
        data-testid={testId}
      >
        {children}
      </Card>
    </div>
  );
}

function WeeklyUpDownCard({ market }: { market: PredictionMarket }) {
  return (
    <PredictCard testId={`card-market-${market.id}`} className="min-w-[280px]">
      <div className="flex items-center gap-3 mb-3">
        <PersonAvatar name={market.personName} avatar={market.personAvatar} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{market.personName}</h3>
          <p className="text-xs text-muted-foreground font-mono">
            {market.currentScore.toLocaleString()} pts
          </p>
        </div>
        <Badge 
          variant="outline" 
          className={market.change7d >= 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}
        >
          {market.change7d >= 0 ? "+" : ""}{market.change7d.toFixed(1)}%
        </Badge>
      </div>
      
      <div className="h-8 w-full bg-muted/30 rounded-lg mb-3 overflow-hidden flex">
        <div 
          className="h-full bg-gradient-to-r from-green-500/20 to-green-500/40 flex items-center justify-center"
          style={{ width: `${market.upPoolPercent}%` }}
        >
          <span className="text-[10px] font-mono text-green-500">{market.upPoolPercent}%</span>
        </div>
        <div 
          className="h-full bg-gradient-to-r from-red-500/40 to-red-500/20 flex items-center justify-center"
          style={{ width: `${100 - market.upPoolPercent}%` }}
        >
          <span className="text-[10px] font-mono text-red-500">{100 - market.upPoolPercent}%</span>
        </div>
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground font-semibold">
          Pool: {market.totalPool.toLocaleString()} credits
        </span>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {market.endTime}
        </span>
      </div>
      
      <div className="flex gap-2">
        <Button 
          size="sm" 
          className="flex-1 bg-green-600 text-white"
          data-testid={`button-up-${market.id}`}
        >
          <TrendingUp className="h-4 w-4 mr-1" />
          Up {market.upMultiplier}x
        </Button>
        <Button 
          size="sm" 
          className="flex-1 bg-red-600 text-white"
          data-testid={`button-down-${market.id}`}
        >
          <TrendingDown className="h-4 w-4 mr-1" />
          Down {market.downMultiplier}x
        </Button>
      </div>
    </PredictCard>
  );
}

function HeadToHeadCard({ market }: { market: HeadToHeadMarket }) {
  return (
    <PredictCard testId={`card-h2h-${market.id}`} className="min-w-[300px]">
      <div className="flex items-center justify-between mb-3">
        <Badge variant="secondary" className="text-xs">{market.category}</Badge>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {market.endTime}
        </span>
      </div>
      
      <div className="flex items-center justify-center gap-4 mb-4">
        <div className="text-center">
          <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} size="md" />
          <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{market.person1.name}</p>
          <p className="text-xs text-green-500 font-mono">{market.person1Percent}%</p>
        </div>
        
        <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center">
          <span className="text-sm font-bold text-violet-500">VS</span>
        </div>
        
        <div className="text-center">
          <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} size="md" />
          <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{market.person2.name}</p>
          <p className="text-xs text-red-500 font-mono">{100 - market.person1Percent}%</p>
        </div>
      </div>
      
      <div className="h-2 w-full bg-muted/30 rounded-full mb-3 overflow-hidden flex">
        <div 
          className="h-full bg-green-500"
          style={{ width: `${market.person1Percent}%` }}
        />
        <div 
          className="h-full bg-red-500"
          style={{ width: `${100 - market.person1Percent}%` }}
        />
      </div>
      
      <div className="text-center mb-3">
        <span className="text-sm font-semibold text-violet-500">
          Pool: {market.totalPool.toLocaleString()} credits
        </span>
      </div>
      
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 border-green-500/30 text-green-500">
          {market.person1.name.split(" ")[0]}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 border-red-500/30 text-red-500">
          {market.person2.name.split(" ")[0]}
        </Button>
      </div>
    </PredictCard>
  );
}

function CategoryRaceCard({ market }: { market: CategoryRaceMarket }) {
  return (
    <PredictCard testId={`card-race-${market.id}`} className="min-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <Badge variant="secondary" className="text-xs">{market.category}</Badge>
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {market.timeRemaining}
        </Badge>
      </div>
      
      <h3 className="font-semibold mb-3">{market.title}</h3>
      
      <div className="flex items-center gap-2 mb-3">
        {market.topContenders.map((contender, i) => (
          <div key={contender.name} className="flex items-center">
            <div className="relative">
              <PersonAvatar name={contender.name} avatar={contender.avatar} size="sm" />
              <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-violet-500 text-white text-[10px] flex items-center justify-center font-bold">
                {i + 1}
              </div>
            </div>
          </div>
        ))}
        <span className="text-xs text-muted-foreground">+more</span>
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-violet-500">
          Pool: {market.totalPool.toLocaleString()}
        </span>
      </div>
      
      <Button size="sm" className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white">
        Enter Race
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </PredictCard>
  );
}

function TopGainerCard({ market }: { market: TopGainerMarket }) {
  return (
    <PredictCard testId={`card-gainer-${market.id}`} className="min-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <Badge variant="secondary" className="text-xs">{market.category}</Badge>
        <span className="text-xs text-muted-foreground">7-day gain</span>
      </div>
      
      <h3 className="font-semibold mb-3">Top Gainer: {market.category}</h3>
      
      <div className="space-y-2 mb-3">
        {market.leaders.map((leader, i) => (
          <div key={leader.name} className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground w-4">#{i + 1}</span>
            <PersonAvatar name={leader.name} avatar={leader.avatar} size="xs" />
            <span className="text-sm flex-1 truncate">{leader.name}</span>
            <span className="text-xs font-mono text-green-500">+{leader.currentGain.toLocaleString()}</span>
          </div>
        ))}
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-violet-500">
          Pool: {market.totalPool.toLocaleString()}
        </span>
      </div>
      
      <Button size="sm" className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white">
        Place Prediction
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </PredictCard>
  );
}

function CarouselSection({ 
  title, 
  subtitle, 
  onViewAll, 
  children 
}: { 
  title: string; 
  subtitle: string; 
  onViewAll: () => void;
  children: React.ReactNode;
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
        }
      }
    ]
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-serif font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onViewAll}
          className="text-violet-500"
        >
          View All
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      
      <div className="predict-carousel -mx-2">
        <Slider {...sliderSettings}>
          {children}
        </Slider>
      </div>
    </section>
  );
}

export default function PredictPage() {
  const [, setLocation] = useLocation();
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false);
  const [viewAllCategory, setViewAllCategory] = useState<string | null>(null);
  const [balance] = useState(10000);
  const [activePredictions] = useState(0);

  useEffect(() => {
    const hasVisited = localStorage.getItem(FIRST_VISIT_KEY);
    if (!hasVisited) {
      setShowFirstTimeModal(true);
    }
  }, []);

  const handleCloseFirstTimeModal = () => {
    localStorage.setItem(FIRST_VISIT_KEY, "true");
    setShowFirstTimeModal(false);
  };

  const handleOpenHowItWorks = () => {
    setShowFirstTimeModal(true);
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
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
                <Button variant="ghost" size="sm">Home</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm" className="text-violet-500">Predict</Button>
              </Link>
              <Link href="/me">
                <Button variant="ghost" size="sm">Me</Button>
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-6 bg-gradient-to-r from-violet-500/20 via-violet-500/10 to-transparent rounded-xl p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Zap className="h-8 w-8 text-violet-500" />
              <h1 className="text-3xl font-serif font-bold" data-testid="text-predict-title">
                Prediction Markets
              </h1>
            </div>
            <button 
              onClick={handleOpenHowItWorks}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-violet-500 transition-colors"
              data-testid="button-how-it-works"
            >
              <HelpCircle className="h-4 w-4" />
              How it works
            </button>
          </div>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Back your insight on who's really moving. Pool your predictions with others - the bigger the pot, the bigger the returns.
          </p>
        </div>

        <Card className="p-4 mb-8 bg-muted/30 border-muted">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="bg-violet-500/10 text-violet-500 border-violet-500/30 px-3 py-1">
                TEST MODE
              </Badge>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-violet-500" />
                <span className="font-mono font-bold">{balance.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">credits</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono font-bold">{activePredictions}</span>
              <span className="text-xs text-muted-foreground">active predictions</span>
            </div>
          </div>
        </Card>

        <CarouselSection
          title="Weekly Up / Down"
          subtitle="Will their trend score be higher or lower this week?"
          onViewAll={() => setViewAllCategory("weekly")}
        >
          {mockMarkets.map((market) => (
            <div key={market.id} className="px-2 pt-[10px] pb-[10px]">
              <WeeklyUpDownCard market={market} />
            </div>
          ))}
        </CarouselSection>

        <CarouselSection
          title="Head-to-Head Battles"
          subtitle="Curated matchups - who will gain more?"
          onViewAll={() => setViewAllCategory("h2h")}
        >
          {headToHeadMarkets.map((market) => (
            <div key={market.id} className="px-2">
              <HeadToHeadCard market={market} />
            </div>
          ))}
        </CarouselSection>

        <CarouselSection
          title="Category Races"
          subtitle="Competition within sectors - pick the winner"
          onViewAll={() => setViewAllCategory("races")}
        >
          {categoryRaceMarkets.map((market) => (
            <div key={market.id} className="px-2 mt-[10px] mb-[10px] pt-[0px] pb-[0px]">
              <CategoryRaceCard market={market} />
            </div>
          ))}
        </CarouselSection>

        <CarouselSection
          title="Top Gainer Predictions"
          subtitle="Who will gain the most raw points in 7 days?"
          onViewAll={() => setViewAllCategory("gainers")}
        >
          {topGainerMarkets.map((market) => (
            <div key={market.id} className="px-2">
              <TopGainerCard market={market} />
            </div>
          ))}
        </CarouselSection>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            More markets added daily. Pool sizes update in real-time.
          </p>
        </div>
      </div>
      <FirstTimeModal 
        open={showFirstTimeModal} 
        onClose={handleCloseFirstTimeModal} 
      />
      <ViewAllModal
        open={viewAllCategory === "weekly"}
        onClose={() => setViewAllCategory(null)}
        title="All Weekly Up/Down Markets"
      >
        {mockMarkets.map((market) => (
          <WeeklyUpDownCard key={market.id} market={market} />
        ))}
      </ViewAllModal>
      <ViewAllModal
        open={viewAllCategory === "h2h"}
        onClose={() => setViewAllCategory(null)}
        title="All Head-to-Head Battles"
      >
        {headToHeadMarkets.map((market) => (
          <HeadToHeadCard key={market.id} market={market} />
        ))}
      </ViewAllModal>
      <ViewAllModal
        open={viewAllCategory === "races"}
        onClose={() => setViewAllCategory(null)}
        title="All Category Races"
      >
        {categoryRaceMarkets.map((market) => (
          <CategoryRaceCard key={market.id} market={market} />
        ))}
      </ViewAllModal>
      <ViewAllModal
        open={viewAllCategory === "gainers"}
        onClose={() => setViewAllCategory(null)}
        title="All Top Gainer Predictions"
      >
        {topGainerMarkets.map((market) => (
          <TopGainerCard key={market.id} market={market} />
        ))}
      </ViewAllModal>
      <style>{`
        .predict-carousel .slick-track {
          display: flex;
          gap: 0;
        }
        .predict-carousel .slick-slide {
          height: auto;
        }
        .predict-carousel .slick-slide > div {
          height: 100%;
        }
        .predict-carousel .slick-prev,
        .predict-carousel .slick-next {
          z-index: 10;
          width: 32px;
          height: 32px;
        }
        .predict-carousel .slick-prev {
          left: -8px;
        }
        .predict-carousel .slick-next {
          right: -8px;
        }
        .predict-carousel .slick-prev:before,
        .predict-carousel .slick-next:before {
          color: rgb(139 92 246);
          font-size: 24px;
        }
        .predict-carousel .slick-disabled:before {
          opacity: 0.25;
        }
      `}</style>
    </div>
  );
}
