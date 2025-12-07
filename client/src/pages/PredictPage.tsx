import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ArrowLeft, ChevronRight, TrendingUp, TrendingDown, Zap, Target, Users, Trophy, Wallet, ListChecks } from "lucide-react";
import { useLocation, Link } from "wouter";

interface PredictionMarket {
  id: string;
  personId: string;
  personName: string;
  personAvatar: string;
  currentScore: number;
  change7d: number;
  upOdds: number;
  downOdds: number;
  endTime: string;
  totalPool: number;
}

const mockMarkets: PredictionMarket[] = [
  {
    id: "market-1",
    personId: "7426f0ee-1d7b-4fde-8db8-b5bc0fc92bba",
    personName: "Elon Musk",
    personAvatar: "",
    currentScore: 487234,
    change7d: 12.5,
    upOdds: 1.7,
    downOdds: 2.3,
    endTime: "Sun 23:59 UTC",
    totalPool: 15420,
  },
  {
    id: "market-2",
    personId: "2",
    personName: "Taylor Swift",
    personAvatar: "",
    currentScore: 425891,
    change7d: -3.2,
    upOdds: 2.1,
    downOdds: 1.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 12350,
  },
  {
    id: "market-3",
    personId: "3",
    personName: "MrBeast",
    personAvatar: "",
    currentScore: 398456,
    change7d: 8.7,
    upOdds: 1.5,
    downOdds: 2.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 9870,
  },
  {
    id: "market-4",
    personId: "4",
    personName: "Donald Trump",
    personAvatar: "",
    currentScore: 356789,
    change7d: 15.3,
    upOdds: 1.4,
    downOdds: 3.2,
    endTime: "Sun 23:59 UTC",
    totalPool: 22100,
  },
  {
    id: "market-5",
    personId: "5",
    personName: "Kim Kardashian",
    personAvatar: "",
    currentScore: 312456,
    change7d: -1.8,
    upOdds: 2.2,
    downOdds: 1.7,
    endTime: "Sun 23:59 UTC",
    totalPool: 8540,
  },
];

interface HeadToHeadMarket {
  id: string;
  title: string;
  participants: string[];
  category: string;
  window: string;
  endTime: string;
}

const headToHeadMarkets: HeadToHeadMarket[] = [
  {
    id: "h2h-1",
    title: "Who will gain more this week?",
    participants: ["Drake", "The Weeknd", "Travis Scott"],
    category: "Music",
    window: "7-day window",
    endTime: "Ends Sun 23:59 UTC",
  },
  {
    id: "h2h-2",
    title: "Tech Titans Showdown",
    participants: ["Elon Musk", "Jensen Huang", "Mark Zuckerberg"],
    category: "Tech",
    window: "7-day window",
    endTime: "Ends Sun 23:59 UTC",
  },
];

interface CategoryRaceMarket {
  id: string;
  title: string;
  participants: string[];
  category: string;
  window: string;
  endTime: string;
}

const categoryRaceMarkets: CategoryRaceMarket[] = [
  {
    id: "race-1",
    title: "Which Music artist will have the biggest Trend Score increase?",
    participants: ["Taylor Swift", "Drake", "The Weeknd", "Bad Bunny", "Beyoncé"],
    category: "Music",
    window: "7-day window",
    endTime: "Ends Sun 23:59 UTC",
  },
  {
    id: "race-2",
    title: "Which Tech leader will move the most?",
    participants: ["Elon Musk", "Sam Altman", "Jensen Huang", "Satya Nadella", "Mark Zuckerberg"],
    category: "Tech",
    window: "7-day window",
    endTime: "Ends Sun 23:59 UTC",
  },
];

function MarketCard({ market }: { market: PredictionMarket }) {
  const [, setLocation] = useLocation();

  const handleViewMarket = () => {
    setLocation(`/person/${market.personId}?tab=predict`);
  };

  return (
    <Card 
      className="p-4 hover-elevate cursor-pointer transition-all"
      onClick={handleViewMarket}
      data-testid={`card-market-${market.id}`}
    >
      <div className="flex items-center gap-4">
        <PersonAvatar name={market.personName} avatar={market.personAvatar} size="md" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold truncate">{market.personName}</h3>
            <Badge variant="outline" className="text-xs shrink-0">
              {market.change7d >= 0 ? "+" : ""}{market.change7d.toFixed(1)}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Weekly Trend Score · Ends {market.endTime}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Score: <span className="font-mono">{market.currentScore.toLocaleString()}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <Badge 
            className="bg-green-500/20 text-green-500 border-green-500/30 hover:bg-green-500/30"
            data-testid={`badge-up-${market.id}`}
          >
            <TrendingUp className="h-3 w-3 mr-1" />
            Up {market.upOdds}x
          </Badge>
          <Badge 
            className="bg-red-500/20 text-red-500 border-red-500/30 hover:bg-red-500/30"
            data-testid={`badge-down-${market.id}`}
          >
            <TrendingDown className="h-3 w-3 mr-1" />
            Down {market.downOdds}x
          </Badge>
        </div>

        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>
    </Card>
  );
}

function HeadToHeadCard({ market }: { market: HeadToHeadMarket }) {
  const handleOpenMarket = () => {
    console.log("Opening head-to-head market:", market.id);
  };

  return (
    <Card 
      className="p-4 hover-elevate transition-all"
      data-testid={`card-h2h-${market.id}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-semibold mb-2">{market.title}</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {market.participants.map((name, i) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name}
                  {i < market.participants.length - 1 && <span className="ml-1 text-muted-foreground">vs</span>}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {market.category} · {market.window} · {market.endTime}
            </p>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleOpenMarket}
          className="w-full sm:w-auto"
          data-testid={`button-open-h2h-${market.id}`}
        >
          Open Market
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  );
}

function CategoryRaceCard({ market }: { market: CategoryRaceMarket }) {
  const handleOpenMarket = () => {
    console.log("Opening category race market:", market.id);
  };

  return (
    <Card 
      className="p-4 hover-elevate transition-all"
      data-testid={`card-race-${market.id}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-semibold mb-2">{market.title}</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {market.participants.map((name) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {market.category} · {market.window} · {market.endTime}
            </p>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleOpenMarket}
          className="w-full sm:w-auto"
          data-testid={`button-open-race-${market.id}`}
        >
          Open Market
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  );
}

function StepCard({ step, icon: Icon, title, subtitle }: { step: number; icon: typeof Target; title: string; subtitle: string }) {
  return (
    <div className="flex-1 flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="text-xs text-muted-foreground mb-1">Step {step}</div>
      <h4 className="font-semibold text-sm mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export default function PredictPage() {
  const [, setLocation] = useLocation();

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
              <Link href="/predict">
                <Button variant="ghost" size="sm" className="text-primary">Predict</Button>
              </Link>
              <Link href="/me">
                <Button variant="ghost" size="sm">Me</Button>
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <Zap className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-serif font-bold" data-testid="text-predict-title">
              Prediction Markets
            </h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Back your insight on who's really moving the world. Make test-mode predictions using virtual credits – no real money.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <StepCard 
            step={1} 
            icon={Target} 
            title="Pick a market" 
            subtitle="Weekly Up/Down, Head-to-Head, or Category Races."
          />
          <StepCard 
            step={2} 
            icon={Users} 
            title="Choose a person & direction" 
            subtitle="Up or Down, or pick a single winner."
          />
          <StepCard 
            step={3} 
            icon={Trophy} 
            title="Place a test prediction" 
            subtitle="Use virtual credits and see your potential payout."
          />
        </div>

        <Card className="p-4 mb-8 bg-primary/5 border-primary/20">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              TEST MODE
            </Badge>
            <span className="text-sm text-muted-foreground">
              Predictions use virtual credits only. No real money involved.
            </span>
          </div>
        </Card>

        <Card className="p-4 mb-8 bg-muted/30 border-muted">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Test Wallet Balance</div>
                <div className="text-xl font-bold font-mono">10,000 <span className="text-sm font-normal text-muted-foreground">credits</span></div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <ListChecks className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">My Predictions</div>
                <div className="text-xl font-bold font-mono">0 <span className="text-sm font-normal text-muted-foreground">active</span></div>
              </div>
            </div>
          </div>
        </Card>

        <section className="mb-10" data-testid="section-weekly-updown">
          <div className="mb-4">
            <h2 className="text-xl font-serif font-bold mb-1">Weekly Up / Down</h2>
            <p className="text-sm text-muted-foreground">
              Predict if a person's FameDex Trend Score will be higher or lower at the end of this week.
            </p>
          </div>
          <div className="space-y-3">
            {mockMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        </section>

        <section className="mb-10" data-testid="section-head-to-head">
          <div className="mb-4">
            <h2 className="text-xl font-serif font-bold mb-1">Head-to-Head & Group Battles</h2>
            <p className="text-sm text-muted-foreground">
              Predict who will gain more Trend Score this week in curated matchups.
            </p>
          </div>
          <div className="space-y-3">
            {headToHeadMarkets.map((market) => (
              <HeadToHeadCard key={market.id} market={market} />
            ))}
          </div>
        </section>

        <section className="mb-10" data-testid="section-category-races">
          <div className="mb-4">
            <h2 className="text-xl font-serif font-bold mb-1">Category Races</h2>
            <p className="text-sm text-muted-foreground">
              Pick who you think will be the biggest mover in a category this week.
            </p>
          </div>
          <div className="space-y-3">
            {categoryRaceMarkets.map((market) => (
              <CategoryRaceCard key={market.id} market={market} />
            ))}
          </div>
        </section>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            More markets coming soon. Check back regularly for new prediction opportunities.
          </p>
        </div>
      </div>
    </div>
  );
}
