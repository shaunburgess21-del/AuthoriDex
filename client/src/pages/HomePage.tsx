import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { TrendWidget } from "@/components/TrendWidget";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { UpdateIndicator } from "@/components/UpdateIndicator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FilterDropdown } from "@/components/FilterDropdown";
import { SortDropdown } from "@/components/SortDropdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useLocation } from "wouter";

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("rank");
  const [, setLocation] = useLocation();

  // Build query params
  const queryParams = new URLSearchParams();
  if (searchQuery) queryParams.set('search', searchQuery);
  if (category !== 'all') queryParams.set('category', category);
  if (sort) queryParams.set('sort', sort);

  // Fetch all trending people with filters
  const { data: allPeople = [], isLoading, error } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending', searchQuery, category, sort],
    queryFn: async () => {
      const response = await fetch(`/api/trending?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // Fetch top gainers
  const { data: topGainers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/gainers'],
    refetchInterval: 5 * 60 * 1000,
  });

  // Fetch top droppers
  const { data: topDroppers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/droppers'],
    refetchInterval: 5 * 60 * 1000,
  });

  // Fetch daily movers
  const { data: dailyMovers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/daily'],
    refetchInterval: 5 * 60 * 1000,
  });

  const handlePersonClick = (personId: string) => {
    setLocation(`/person/${personId}`);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setCategory("all");
    setSort("rank");
  };

  const hasActiveFilters = searchQuery || category !== "all" || sort !== "rank";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading trending data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Failed to load trending data</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
            </div>
            <span className="font-serif font-bold text-xl">FameDex</span>
          </div>
          <div className="flex items-center gap-3">
            <UpdateIndicator />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <HeroSection />

      <div className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <TrendWidget title="Daily Movers" people={dailyMovers} type="daily" />
          <TrendWidget title="Weekly Gainers" people={topGainers} type="gainer" />
          <TrendWidget title="Weekly Droppers" people={topDroppers} type="dropper" />
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-4 space-y-0 pb-4">
            <CardTitle className="text-2xl font-serif flex-1">
              Top 1000 Leaderboard
            </CardTitle>
            <div className="flex gap-2">
              <FilterDropdown value={category} onChange={setCategory} />
              <SortDropdown value={sort} onChange={setSort} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="px-6 py-4 border-b bg-muted/30">
              <div className="space-y-3">
                <SearchBar 
                  onSearch={setSearchQuery} 
                  placeholder="Search by name or category..."
                />
                {hasActiveFilters && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">Active filters:</span>
                    {searchQuery && (
                      <Badge variant="secondary" className="gap-1">
                        Search: {searchQuery}
                        <X 
                          className="h-3 w-3 cursor-pointer" 
                          onClick={() => setSearchQuery("")}
                        />
                      </Badge>
                    )}
                    {category !== "all" && (
                      <Badge variant="secondary" className="gap-1">
                        Category: {category}
                        <X 
                          className="h-3 w-3 cursor-pointer" 
                          onClick={() => setCategory("all")}
                        />
                      </Badge>
                    )}
                    {sort !== "rank" && (
                      <Badge variant="secondary" className="gap-1">
                        Sort: {sort}
                        <X 
                          className="h-3 w-3 cursor-pointer" 
                          onClick={() => setSort("rank")}
                        />
                      </Badge>
                    )}
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleClearFilters}
                      className="h-6 text-xs"
                    >
                      Clear all
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div>
              {allPeople.slice(0, 20).map((person) => (
                <LeaderboardRow
                  key={person.id}
                  person={person}
                  onClick={() => handlePersonClick(person.id)}
                />
              ))}
            </div>
            {allPeople.length > 20 && (
              <div className="p-6 border-t text-center">
                <Button variant="outline" data-testid="button-load-more">
                  Load More
                </Button>
              </div>
            )}
            {allPeople.length === 0 && !isLoading && (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">
                  {searchQuery || category !== "all" 
                    ? "No results found matching your filters" 
                    : "No trending people available"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <footer className="border-t mt-24 py-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            FameDex - Real-time celebrity trending tracker powered by LunarCrush
          </p>
        </div>
      </footer>
    </div>
  );
}
