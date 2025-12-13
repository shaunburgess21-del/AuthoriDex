import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { BattleCard, HeadToHeadBattle } from "@/components/BattleCard";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

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
