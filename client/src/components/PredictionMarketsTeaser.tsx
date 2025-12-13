import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ChevronRight, Clock } from "lucide-react";
import { useLocation } from "wouter";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

interface HeadToHeadBattle {
  id: string;
  title: string;
  person1: { name: string; avatar: string };
  person2: { name: string; avatar: string };
  category: string;
  endTime: string;
  totalPool: number;
  person1Percent: number;
}

const trendingBattles: HeadToHeadBattle[] = [
  {
    id: "teaser-1",
    title: "Musk vs Zuckerberg",
    person1: { name: "Elon Musk", avatar: "" },
    person2: { name: "Mark Zuckerberg", avatar: "" },
    category: "Tech",
    endTime: "Sun 23:59 UTC",
    totalPool: 19200,
    person1Percent: 68,
  },
  {
    id: "teaser-2",
    title: "Swift vs Beyoncé",
    person1: { name: "Taylor Swift", avatar: "" },
    person2: { name: "Beyoncé", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 15780,
    person1Percent: 55,
  },
  {
    id: "teaser-3",
    title: "Drake vs Kendrick",
    person1: { name: "Drake", avatar: "" },
    person2: { name: "Kendrick Lamar", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 28450,
    person1Percent: 42,
  },
];

function BattleCard({ battle }: { battle: HeadToHeadBattle }) {
  return (
    <div className="px-2">
      <Card 
        className="p-4 hover:translate-y-[-2px] hover:shadow-lg hover:border-purple-500/40 hover:shadow-purple-500/20 transition-all duration-200 relative z-0 hover:z-10"
        data-testid={`card-battle-${battle.id}`}
      >
        <div className="flex items-center justify-between mb-3">
          <Badge variant="secondary" className="text-xs">{battle.category}</Badge>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {battle.endTime}
          </span>
        </div>
        
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="text-center">
            <PersonAvatar name={battle.person1.name} avatar={battle.person1.avatar} size="md" />
            <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{battle.person1.name}</p>
            <p className="text-xs text-green-500 font-mono">{battle.person1Percent}%</p>
          </div>
          
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-bold text-primary">VS</span>
          </div>
          
          <div className="text-center">
            <PersonAvatar name={battle.person2.name} avatar={battle.person2.avatar} size="md" />
            <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{battle.person2.name}</p>
            <p className="text-xs text-red-500 font-mono">{100 - battle.person1Percent}%</p>
          </div>
        </div>
        
        <div className="h-2 w-full bg-muted/30 rounded-full mb-3 overflow-hidden flex">
          <div 
            className="h-full bg-green-500"
            style={{ width: `${battle.person1Percent}%` }}
          />
          <div 
            className="h-full bg-red-500"
            style={{ width: `${100 - battle.person1Percent}%` }}
          />
        </div>
        
        <div className="text-center mb-3">
          <span className="text-sm font-semibold text-primary">
            Pool: {battle.totalPool.toLocaleString()} credits
          </span>
        </div>
        
        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1 border-green-500/30 text-green-500"
            data-testid={`button-pick-${battle.id}-person1`}
          >
            {battle.person1.name.split(" ")[0]}
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1 border-red-500/30 text-red-500"
            data-testid={`button-pick-${battle.id}-person2`}
          >
            {battle.person2.name.split(" ")[0]}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function PredictionMarketsTeaser() {
  const [, setLocation] = useLocation();

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
    <section className="mb-12" data-testid="prediction-markets-teaser">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-serif font-bold">Prediction Markets</h2>
          <p className="text-sm text-muted-foreground">Predict the next big move. Win reputation.</p>
        </div>
        <Button 
          variant="ghost" 
          onClick={() => setLocation("/predict")}
          className="text-primary"
          data-testid="button-view-all-markets"
        >
          View All Markets
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      
      <div className="predict-carousel -mx-2">
        <Slider {...sliderSettings}>
          {trendingBattles.map((battle) => (
            <BattleCard key={battle.id} battle={battle} />
          ))}
        </Slider>
      </div>
    </section>
  );
}
