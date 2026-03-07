import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { BattleCard, HeadToHeadBattle } from "@/components/BattleCard";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination, A11y } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";

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

      <div className="predict-carousel w-screen relative left-1/2 -ml-[50vw] md:w-auto md:relative md:left-0 md:ml-0 md:-mx-2 authoridex-swiper authoridex-swiper-multi" data-dot-active="violet">
        <Swiper
          modules={[Pagination, A11y]}
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
          pagination={{ clickable: true }}
          a11y={{ enabled: true, prevSlideMessage: "Previous slide", nextSlideMessage: "Next slide" }}
        >
          {trendingBattles.map((battle) => (
            <SwiperSlide key={battle.id}>
              <BattleCard battle={battle} />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </section>
  );
}
