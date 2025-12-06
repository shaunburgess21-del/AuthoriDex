import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ArrowLeft, ChevronRight, TrendingUp, TrendingDown, Zap } from "lucide-react";
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

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-serif font-bold" data-testid="text-predict-title">
              Prediction Markets
            </h1>
          </div>
          <p className="text-muted-foreground">
            Back your insight on who's really moving the world. Currently running in test mode with virtual credits.
          </p>
        </div>

        <Card className="p-4 mb-6 bg-primary/5 border-primary/20">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              TEST MODE
            </Badge>
            <span className="text-sm text-muted-foreground">
              Predictions use virtual credits only. No real money involved.
            </span>
          </div>
        </Card>

        <div className="space-y-3">
          {mockMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            More markets coming soon. Check back regularly for new prediction opportunities.
          </p>
        </div>
      </div>
    </div>
  );
}
