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
          <span>Authority</span> <span className="text-primary">Index</span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl">Discover real-time insights, cast your vote and make your prediction on the world's most influential people</p>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={() => document.getElementById('leaderboard')?.scrollIntoView({ behavior: 'smooth' })}
            className="group relative inline-flex items-center justify-center gap-2 rounded-md px-8 min-h-10 text-sm font-semibold border border-[#4C5567] text-white transition-all duration-300 overflow-hidden"
            data-testid="button-explore-leaderboard"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <TrendingUp className="h-5 w-5 relative z-10" />
            <span className="relative z-10">Explore Leaderboard</span>
          </button>
          <button
            onClick={onCastVoteClick}
            className="group relative inline-flex items-center justify-center gap-2 rounded-md px-8 min-h-10 text-sm font-semibold border border-[#4C5567] text-white transition-all duration-300 overflow-hidden"
            data-testid="button-cast-vote"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <CheckSquare className="h-5 w-5 relative z-10" />
            <span className="relative z-10">Cast Your Vote</span>
          </button>
          <button
            onClick={onPredictClick}
            className="group relative inline-flex items-center justify-center gap-2 rounded-md px-8 min-h-10 text-sm font-semibold border border-[#4C5567] text-white transition-all duration-300 overflow-hidden"
            data-testid="button-prediction-markets"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <LineChart className="h-5 w-5 relative z-10" />
            <span className="relative z-10">Prediction Markets</span>
          </button>
        </div>
      </div>
    </div>
  );
}
