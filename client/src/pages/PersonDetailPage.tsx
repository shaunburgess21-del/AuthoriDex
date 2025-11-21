import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TrendBadge } from "@/components/TrendBadge";
import { RankBadge } from "@/components/RankBadge";
import { TrendChart } from "@/components/TrendChart";
import { StatCard } from "@/components/StatCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PlatformInsightsSection } from "@/components/PlatformInsightsSection";
import { AnimatedSentimentVotingWidget } from "@/components/AnimatedSentimentVotingWidget";
import { ArrowLeft, Share2, Star, TrendingUp, Users, Eye, DollarSign, Globe, MessageSquare, Trophy } from "lucide-react";
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
              <span className="font-serif font-bold text-xl">FameDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-6xl">
        {/* 1. Header: Name + Category */}
        <div className="mb-8">
          <div className="flex items-start gap-6">
            <PersonAvatar name={person.name} avatar={person.avatar} size="lg" />
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl font-serif font-bold" data-testid="text-person-name">
                  {person.name}
                </h1>
                <RankBadge rank={person.rank} />
              </div>
              <p className="text-lg text-muted-foreground mb-2">{person.category}</p>
              {person.bio && (
                <p className="text-sm text-muted-foreground mb-4 max-w-md leading-relaxed" data-testid="text-person-bio">
                  {person.bio}
                </p>
              )}
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
          </div>
        </div>

        {/* 2. Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="text-center p-4">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              Trend Score
            </p>
            <p className="text-3xl font-mono font-bold" data-testid="text-trend-score">
              {person.trendScore.toFixed(0)}
            </p>
          </Card>
          <Card className="text-center p-4">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              24h Change
            </p>
            <div className="flex justify-center mt-2">
              <TrendBadge value={person.change24h} />
            </div>
          </Card>
          <Card className="text-center p-4">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              7d Change
            </p>
            <div className="flex justify-center mt-2">
              <TrendBadge value={person.change7d} />
            </div>
          </Card>
          <Card className="text-center p-4">
            <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
              Rank
            </p>
            <p className="text-3xl font-mono font-bold">
              #{person.rank}
            </p>
          </Card>
        </div>

        {/* 3. Sentiment Voting Widget - PROMINENT PLACEMENT */}
        <div className="mb-8">
          <AnimatedSentimentVotingWidget 
            personId={person.id} 
            personName={person.name}
          />
        </div>

        {/* 4. Trend History Chart */}
        <TrendChart personId={person.id} personName={person.name} />
        
        {/* 4. Platform Insights (stacked blocks) */}
        <PlatformInsightsSection personId={person.id} />

        {/* 5. Future Widgets - Placeholder Section */}
        <div className="mt-12 space-y-6">
          <h2 className="text-2xl font-serif font-bold mb-6">Additional Insights</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Net Worth Placeholder */}
            <Card className="p-6 opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">Net Worth</h3>
              </div>
              <p className="text-sm text-muted-foreground">Coming soon: Forbes & Knowledge Graph data</p>
            </Card>

            {/* Social Reach Summary Placeholder */}
            <Card className="p-6 opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <Globe className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">Social Reach</h3>
              </div>
              <p className="text-sm text-muted-foreground">Coming soon: Total followers across platforms</p>
            </Card>

            {/* AI Sentiment Summary Placeholder */}
            <Card className="p-6 opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">AI Sentiment</h3>
              </div>
              <p className="text-sm text-muted-foreground">Coming soon: AI-powered sentiment analysis</p>
            </Card>

            {/* Engagement Rank Placeholder */}
            <Card className="p-6 opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">Category Rank</h3>
              </div>
              <p className="text-sm text-muted-foreground">Coming soon: Engagement vs. peers</p>
            </Card>

            {/* Most Talked About Topic Placeholder */}
            <Card className="p-6 opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">Trending Topics</h3>
              </div>
              <p className="text-sm text-muted-foreground">Coming soon: Keywords from latest posts</p>
            </Card>

            {/* Search Volume Detail Placeholder */}
            <Card className="p-6 opacity-50">
              <div className="flex items-center gap-3 mb-3">
                <Eye className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">Search Trends</h3>
              </div>
              <p className="text-sm text-muted-foreground">Coming soon: Geographic search distribution</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
