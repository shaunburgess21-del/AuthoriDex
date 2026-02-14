import { Button } from "@/components/ui/button";
import { TrendingUp, CheckSquare, LineChart } from "lucide-react";
import heroImage from "@assets/generated_images/Hero_background_network_visualization_1293b14e.png";

interface HeroSectionProps {
  onCastVoteClick?: () => void;
  onPredictClick?: () => void;
}

export function HeroSection({ onCastVoteClick, onPredictClick }: HeroSectionProps) {
  return (
    <div className="relative h-96 md:h-[500px] w-full overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImage})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background" />
      <div className="relative h-full flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-5xl md:text-7xl font-serif font-bold mb-6 tracking-tight max-w-4xl">
          Global Fame <span className="text-primary">Index</span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl">Discover real-time insights, cast your vote and make your prediction on the world's most influential people</p>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <Button 
            size="lg" 
            className="gap-2"
            onClick={() => document.getElementById('leaderboard')?.scrollIntoView({ behavior: 'smooth' })}
            data-testid="button-explore-leaderboard"
          >
            <TrendingUp className="h-5 w-5" />
            Explore Leaderboard
          </Button>
          <Button 
            size="lg" 
            className="gap-2 bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-semibold shadow-lg shadow-cyan-500/20"
            onClick={onCastVoteClick}
            data-testid="button-cast-vote"
          >
            <CheckSquare className="h-5 w-5" />
            Cast Your Vote
          </Button>
          <Button 
            size="lg" 
            className="gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold shadow-lg shadow-violet-500/20"
            onClick={onPredictClick}
            data-testid="button-prediction-markets"
          >
            <LineChart className="h-5 w-5" />
            Prediction Markets
          </Button>
        </div>
      </div>
    </div>
  );
}
