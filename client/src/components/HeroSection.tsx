import { Button } from "@/components/ui/button";
import { TrendingUp, Search } from "lucide-react";
import heroImage from "@assets/generated_images/Hero_background_network_visualization_1293b14e.png";

export function HeroSection() {
  return (
    <div className="relative h-96 md:h-[500px] w-full overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImage})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background" />
      
      <div className="relative h-full flex flex-col items-center justify-center px-4 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 backdrop-blur-sm border border-primary/20 mb-6">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-primary">
            Live Trending Data
          </span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-serif font-bold mb-6 tracking-tight max-w-4xl">
          Track Fame in <span className="text-primary">Real-Time</span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl">
          Discover the top 100 trending people worldwide with live data from social media, search engines, and more.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <Button 
            size="lg" 
            className="gap-2"
            data-testid="button-explore-leaderboard"
          >
            <TrendingUp className="h-5 w-5" />
            Explore Leaderboard
          </Button>
          <Button 
            size="lg" 
            variant="outline" 
            className="gap-2 backdrop-blur-sm bg-background/50"
            data-testid="button-search-people"
          >
            <Search className="h-5 w-5" />
            Search People
          </Button>
        </div>
      </div>
    </div>
  );
}
