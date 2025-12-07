import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TrendingUp, CheckSquare } from "lucide-react";
import heroImage from "@assets/generated_images/Hero_background_network_visualization_1293b14e.png";
import { VotingModal } from "@/components/VotingModal";

export function HeroSection() {
  const [votingModalOpen, setVotingModalOpen] = useState(false);

  return (
    <div className="relative h-96 md:h-[500px] w-full overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImage})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background" />
      <div className="relative h-full flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-5xl md:text-7xl font-serif font-bold mb-6 tracking-tight max-w-4xl">
          Global Influence <span className="text-primary">Insights</span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl">
          Discover real-time insights and vote on the world's most influential people, powered by live data from verified sources
        </p>
        
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
            variant="outline" 
            className="gap-2 backdrop-blur-sm bg-background/50"
            onClick={() => setVotingModalOpen(true)}
            data-testid="button-cast-vote"
          >
            <CheckSquare className="h-5 w-5" />
            Cast Your Vote
          </Button>
        </div>
      </div>
      <VotingModal 
        open={votingModalOpen} 
        onOpenChange={setVotingModalOpen} 
      />
    </div>
  );
}
