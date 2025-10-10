import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TrendBadge } from "@/components/TrendBadge";
import { RankBadge } from "@/components/RankBadge";
import { TrendChart } from "@/components/TrendChart";
import { StatCard } from "@/components/StatCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ArrowLeft, Share2, Star, TrendingUp, Users, Eye } from "lucide-react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";

export default function PersonDetailPage() {
  const [, params] = useRoute("/person/:id");
  const [, setLocation] = useLocation();

  const { data: person, isLoading, error } = useQuery<TrendingPerson>({
    queryKey: [`/api/trending/${params?.id}`],
    enabled: !!params?.id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading person data...</p>
        </div>
      </div>
    );
  }

  if (error || (!person && !isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Person not found</p>
          <Button className="mt-4" onClick={() => setLocation("/")}>
            Back to Leaderboard
          </Button>
        </div>
      </div>
    );
  }

  if (!person) {
    return null;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation("/")}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">FameStreem</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <Card className="mb-8">
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row gap-8">
              <div className="flex flex-col items-center md:items-start gap-4">
                <PersonAvatar name={person.name} avatar={person.avatar} size="lg" />
                <RankBadge rank={person.rank} />
              </div>
              
              <div className="flex-1">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                  <div>
                    <h1 className="text-4xl font-serif font-bold mb-2" data-testid="text-person-name">
                      {person.name}
                    </h1>
                    <p className="text-lg text-muted-foreground">{person.category}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-2" data-testid="button-share">
                      <Share2 className="h-4 w-4" />
                      Share
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" data-testid="button-favorite">
                      <Star className="h-4 w-4" />
                      Favorite
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
                      Trend Score
                    </p>
                    <p className="text-3xl font-mono font-bold" data-testid="text-trend-score">
                      {person.trendScore.toFixed(0)}
                    </p>
                  </div>
                  <div className="text-center p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
                      24h Change
                    </p>
                    <div className="flex justify-center mt-2">
                      <TrendBadge value={person.change24h} />
                    </div>
                  </div>
                  <div className="text-center p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
                      7d Change
                    </p>
                    <div className="flex justify-center mt-2">
                      <TrendBadge value={person.change7d} />
                    </div>
                  </div>
                  <div className="text-center p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
                      Rank
                    </p>
                    <p className="text-3xl font-mono font-bold">
                      #{person.rank}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard 
            title="Social Mentions" 
            value="1.2M" 
            icon={Users} 
            subtitle="Past 7 days" 
          />
          <StatCard 
            title="Engagement Rate" 
            value="8.5%" 
            icon={TrendingUp} 
            subtitle="Above average" 
          />
          <StatCard 
            title="Search Volume" 
            value="850K" 
            icon={Eye} 
            subtitle="Weekly searches" 
          />
        </div>

        <TrendChart personName={person.name} />
      </div>
    </div>
  );
}
