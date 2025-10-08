import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { TrendWidget } from "@/components/TrendWidget";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { UpdateIndicator } from "@/components/UpdateIndicator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Filter } from "lucide-react";
import { useState } from "react";
import { TrendingPerson } from "@shared/schema";

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");

  const mockPeople: TrendingPerson[] = [
    { id: "1", name: "Taylor Swift", rank: 1, trendScore: 9850, change24h: 12.5, change7d: 45.3, category: "Music", avatar: null },
    { id: "2", name: "Elon Musk", rank: 2, trendScore: 9720, change24h: -3.2, change7d: 18.7, category: "Tech", avatar: null },
    { id: "3", name: "Cristiano Ronaldo", rank: 3, trendScore: 9650, change24h: 8.9, change7d: 22.1, category: "Sports", avatar: null },
    { id: "4", name: "Kim Kardashian", rank: 4, trendScore: 9480, change24h: 5.4, change7d: -12.3, category: "Entertainment", avatar: null },
    { id: "5", name: "Lionel Messi", rank: 5, trendScore: 9350, change24h: 15.8, change7d: 38.9, category: "Sports", avatar: null },
    { id: "6", name: "Beyoncé", rank: 6, trendScore: 9210, change24h: 7.2, change7d: 15.6, category: "Music", avatar: null },
    { id: "7", name: "Donald Trump", rank: 7, trendScore: 9180, change24h: -8.5, change7d: -22.4, category: "Politics", avatar: null },
    { id: "8", name: "LeBron James", rank: 8, trendScore: 9050, change24h: 4.3, change7d: 9.8, category: "Sports", avatar: null },
    { id: "9", name: "Rihanna", rank: 9, trendScore: 8920, change24h: 10.1, change7d: 28.5, category: "Music", avatar: null },
    { id: "10", name: "Jeff Bezos", rank: 10, trendScore: 8850, change24h: -2.7, change7d: 5.3, category: "Tech", avatar: null },
  ];

  const topGainers = [...mockPeople].sort((a, b) => b.change7d - a.change7d);
  const topDroppers = [...mockPeople].sort((a, b) => a.change7d - b.change7d);
  const dailyMovers = [...mockPeople].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));

  const filteredPeople = mockPeople.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-filter">
                <Filter className="h-4 w-4" />
                Filter
              </Button>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-sort">
                <ArrowUpDown className="h-4 w-4" />
                Sort
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="px-6 py-4 border-b bg-muted/30">
              <SearchBar 
                onSearch={setSearchQuery} 
                placeholder="Search by name or category..."
              />
            </div>
            <div>
              {filteredPeople.map((person) => (
                <LeaderboardRow
                  key={person.id}
                  person={person}
                  onClick={() => console.log('View person:', person.name)}
                />
              ))}
            </div>
            <div className="p-6 border-t text-center">
              <Button variant="outline" data-testid="button-load-more">
                Load More
              </Button>
            </div>
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
