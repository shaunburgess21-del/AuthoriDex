import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { VotingModal } from "@/components/VotingModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FilterDropdown } from "@/components/FilterDropdown";
import { SortDropdown } from "@/components/SortDropdown";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TrendBadge } from "@/components/TrendBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, RefreshCw, TrendingUp, TrendingDown, Activity, ChevronRight, LineChart, Vote, Trophy, Zap, Users, Sparkles, Target, ArrowUpRight } from "lucide-react";
import { useState, useEffect, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type HomeView = "leaderboard" | "predict" | "vote";
const CATEGORY_OPTIONS = ["All", "Tech", "Music", "Politics", "Sports", "Creator"] as const;

function MarketPulseCard({ 
  title, 
  icon: Icon, 
  people, 
  type,
  onPersonClick 
}: { 
  title: string; 
  icon: typeof TrendingUp; 
  people: TrendingPerson[]; 
  type: "daily" | "gainer" | "dropper";
  onPersonClick: (id: string) => void;
}) {
  const colorClass = type === "daily" ? "text-blue-400" : type === "gainer" ? "text-sky-400" : "text-blue-300";
  const bgClass = type === "daily" ? "bg-blue-500/10 border-blue-500/20" : type === "gainer" ? "bg-sky-500/10 border-sky-500/20" : "bg-blue-400/10 border-blue-400/20";
  
  return (
    <Card className={`min-w-[280px] md:min-w-0 shrink-0 md:shrink border ${bgClass} bg-card/50 backdrop-blur-sm`} data-testid={`pulse-card-${type}`}>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${colorClass}`} />
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {people.slice(0, 3).map((person, idx) => (
          <div
            key={person.id}
            className="flex items-center gap-2 p-2 rounded-lg hover-elevate cursor-pointer bg-muted/30"
            onClick={() => onPersonClick(person.id)}
            data-testid={`pulse-item-${person.id}`}
          >
            <span className="font-mono text-xs font-bold text-muted-foreground w-4">{idx + 1}</span>
            <PersonAvatar name={person.name} avatar={person.avatar} size="xs" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-xs truncate">{person.name}</p>
            </div>
            <TrendBadge value={type === "daily" ? person.change24h : person.change7d} size="sm" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TrendGraphOverlay({
  open,
  onClose,
  allPeople
}: {
  open: boolean;
  onClose: () => void;
  allPeople: TrendingPerson[];
}) {
  const [selectedCategory, setSelectedCategory] = useState<typeof CATEGORY_OPTIONS[number]>("All");
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({});

  const filteredPeople = selectedCategory === "All" 
    ? allPeople.slice(0, 5)
    : allPeople.filter(p => p.category?.toLowerCase() === selectedCategory.toLowerCase()).slice(0, 5);

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    filteredPeople.forEach(p => { initial[p.id] = true; });
    setVisibleLines(initial);
  }, [selectedCategory, allPeople]);

  const lineColors = ["#3b82f6", "#60a5fa", "#2563eb", "#1d4ed8", "#93c5fd"];

  const generateMockTrendData = () => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days.map((day, dayIdx) => {
      const dataPoint: Record<string, string | number> = { day };
      filteredPeople.forEach((person, personIdx) => {
        const baseScore = person.trendScore || 50;
        const variation = Math.sin((dayIdx + personIdx) * 0.5) * 15 + Math.random() * 10;
        dataPoint[person.id] = Math.round(baseScore + variation);
      });
      return dataPoint;
    });
  };

  const trendData = generateMockTrendData();

  const toggleLine = (id: string) => {
    setVisibleLines(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl overflow-y-auto"
    >
      <div className="container mx-auto px-4 py-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-serif font-bold">Compare Momentum</h2>
            <p className="text-sm text-muted-foreground">7-Day Trend Analysis</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-trends">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-4 mb-6">
          {CATEGORY_OPTIONS.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? "bg-blue-500/20 text-blue-300 border border-blue-400/40"
                  : "bg-muted/50 border border-border/50 text-muted-foreground hover:bg-muted/80"
              }`}
              data-testid={`trend-category-${cat.toLowerCase()}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <Card className="mb-6">
          <CardContent className="p-4 md:p-6">
            <div className="h-[350px] md:h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="day" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                  <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(0,0,0,0.9)', 
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px'
                    }}
                  />
                  {filteredPeople.map((person, idx) => (
                    visibleLines[person.id] && (
                      <Line
                        key={person.id}
                        type="monotone"
                        dataKey={person.id}
                        name={person.name}
                        stroke={lineColors[idx % lineColors.length]}
                        strokeWidth={2}
                        dot={{ fill: lineColors[idx % lineColors.length], strokeWidth: 0, r: 4 }}
                        activeDot={{ r: 6, stroke: lineColors[idx % lineColors.length], strokeWidth: 2 }}
                      />
                    )
                  ))}
                </RechartsLineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2 justify-center">
          {filteredPeople.map((person, idx) => (
            <button
              key={person.id}
              onClick={() => toggleLine(person.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                visibleLines[person.id]
                  ? "bg-muted/80 border border-border"
                  : "bg-muted/30 border border-border/30 opacity-50"
              }`}
              data-testid={`legend-toggle-${person.id}`}
            >
              <span 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: lineColors[idx % lineColors.length] }}
              />
              {person.name}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function PredictHookView({ topGainer, onExplore }: { topGainer?: TrendingPerson; onExplore: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <Card className="relative overflow-hidden border-blue-500/20 bg-gradient-to-br from-blue-500/5 via-card to-card">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-transparent" />
        <CardContent className="relative p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="flex-shrink-0">
              <div className="h-20 w-20 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <Trophy className="h-10 w-10 text-blue-400" />
              </div>
            </div>
            <div className="flex-1 text-center md:text-left">
              <Badge className="mb-2 bg-blue-500/20 text-blue-300 border-blue-400/40">Weekly Jackpot</Badge>
              <h3 className="text-2xl md:text-3xl font-serif font-bold mb-2">Predict the Top Gainer</h3>
              <p className="text-muted-foreground mb-4">
                Stake your credits on who will rise the most this week. Winners share the pool!
              </p>
              <div className="flex items-center gap-4 justify-center md:justify-start">
                <div className="text-center">
                  <p className="text-2xl font-mono font-bold text-blue-400">25,000</p>
                  <p className="text-xs text-muted-foreground">Credit Pool</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-2xl font-mono font-bold text-blue-400">3d 14h</p>
                  <p className="text-xs text-muted-foreground">Time Left</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {topGainer && (
        <Card className="border-sky-500/20" data-testid="top-gainer-card">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-sky-400" />
              <CardTitle className="text-sm font-medium">Current Leader</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-center gap-4 p-3 rounded-lg bg-sky-500/5 border border-sky-500/20">
              <PersonAvatar name={topGainer.name} avatar={topGainer.avatar} size="lg" />
              <div className="flex-1">
                <p className="font-semibold text-lg">{topGainer.name}</p>
                <p className="text-sm text-muted-foreground">{topGainer.category}</p>
              </div>
              <div className="text-right">
                <TrendBadge value={topGainer.change7d} size="lg" />
                <p className="text-xs text-muted-foreground mt-1">This Week</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-center">
        <Button onClick={onExplore} className="bg-blue-600 hover:bg-blue-700" data-testid="button-explore-predict">
          Explore All Markets
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </motion.div>
  );
}

function VoteHookView({ 
  topCandidate, 
  onExplore 
}: { 
  topCandidate?: TrendingPerson;
  onExplore: () => void;
}) {
  const mockPoll = {
    question: "Who will dominate headlines next month?",
    options: [
      { label: "Taylor Swift", votes: 2847 },
      { label: "Elon Musk", votes: 2156 },
      { label: "MrBeast", votes: 1923 }
    ],
    totalVotes: 6926
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <Card className="border-blue-500/20" data-testid="induction-hook-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" />
              <CardTitle className="text-sm font-medium">Induction Queue</CardTitle>
            </div>
            <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/40">#1 Candidate</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {topCandidate ? (
            <div className="flex items-center gap-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <PersonAvatar name={topCandidate.name} avatar={topCandidate.avatar} size="lg" />
              <div className="flex-1">
                <p className="font-semibold text-lg">{topCandidate.name}</p>
                <p className="text-sm text-muted-foreground">{topCandidate.category}</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: '78%' }} />
                  </div>
                  <span className="text-xs text-muted-foreground">78% to induction</span>
                </div>
              </div>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Vote className="h-4 w-4 mr-1" />
                Vote
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">No candidates available</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-blue-500/20" data-testid="trending-poll-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-sm font-medium">Trending Poll</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <p className="font-medium mb-4">{mockPoll.question}</p>
          <div className="space-y-2">
            {mockPoll.options.map((option, idx) => {
              const percent = Math.round((option.votes / mockPoll.totalVotes) * 100);
              return (
                <div key={idx} className="relative">
                  <div className="absolute inset-0 bg-blue-500/10 rounded-lg" style={{ width: `${percent}%` }} />
                  <div className="relative flex items-center justify-between p-3 rounded-lg border border-blue-500/20 hover-elevate cursor-pointer">
                    <span className="font-medium text-sm">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{percent}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">{mockPoll.totalVotes.toLocaleString()} votes</p>
        </CardContent>
      </Card>

      <div className="text-center">
        <Button onClick={onExplore} className="bg-blue-600 hover:bg-blue-700" data-testid="button-explore-vote">
          Explore All Voting
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </motion.div>
  );
}

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("rank");
  const [visibleCount, setVisibleCount] = useState(20);
  const [, setLocation] = useLocation();
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const [votingPersonId, setVotingPersonId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HomeView>("leaderboard");
  const [trendOverlayOpen, setTrendOverlayOpen] = useState(false);

  const queryParams = new URLSearchParams();
  if (searchQuery) queryParams.set('search', searchQuery);
  if (category !== 'all') queryParams.set('category', category);
  if (sort) queryParams.set('sort', sort);

  const { data: allPeople = [], isLoading, error } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending', searchQuery, category, sort],
    queryFn: async () => {
      const response = await fetch(`/api/trending?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: topGainers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/gainers'],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: topDroppers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/droppers'],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: dailyMovers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/daily'],
    refetchInterval: 5 * 60 * 1000,
  });

  const handleVisitProfile = (personId: string) => {
    setLocation(`/person/${personId}`);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setCategory("all");
    setSort("rank");
    setVisibleCount(20);
  };

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + 20, allPeople.length));
  };

  const handleVoteClick = (personId: string) => {
    setVotingPersonId(personId);
    setVotingModalOpen(true);
  };

  const handleHeroCastVote = () => {
    if (allPeople.length > 0) {
      setVotingPersonId(allPeople[0].id);
      setVotingModalOpen(true);
    }
  };

  useEffect(() => {
    setVisibleCount(20);
  }, [searchQuery, category, sort]);

  const hasActiveFilters = searchQuery || category !== "all" || sort !== "rank";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent"></div>
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
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold font-serif text-lg">F</span>
            </div>
            <span className="font-serif font-bold text-xl">FameDex</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" className="text-blue-400" data-testid="nav-home-desktop">
                Home
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/vote")} data-testid="nav-vote-desktop">
                Vote
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/me")} data-testid="nav-me-desktop">
                Me
              </Button>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <HeroSection onCastVoteClick={handleHeroCastVote} />

      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 md:grid md:grid-cols-3 md:overflow-visible" data-testid="market-pulse-row">
          <MarketPulseCard 
            title="Daily Movers" 
            icon={Activity} 
            people={dailyMovers} 
            type="daily"
            onPersonClick={handleVisitProfile}
          />
          <MarketPulseCard 
            title="Weekly Gainers" 
            icon={TrendingUp} 
            people={topGainers} 
            type="gainer"
            onPersonClick={handleVisitProfile}
          />
          <MarketPulseCard 
            title="Weekly Droppers" 
            icon={TrendingDown} 
            people={topDroppers} 
            type="dropper"
            onPersonClick={handleVisitProfile}
          />
        </div>
      </div>

      <div className="sticky top-16 z-40 border-b bg-gradient-to-r from-blue-500/5 via-background/95 to-blue-500/5 backdrop-blur-xl">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-2 py-3">
            {(["leaderboard", "predict", "vote"] as HomeView[]).map((view) => {
              const icons = { leaderboard: Target, predict: LineChart, vote: Vote };
              const labels = { leaderboard: "Leaderboard", predict: "Predict", vote: "Vote" };
              const Icon = icons[view];
              return (
                <button
                  key={view}
                  onClick={() => setActiveView(view)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                    activeView === view
                      ? "bg-blue-500/20 text-blue-300 border border-blue-400/40 shadow-sm shadow-blue-500/20"
                      : "bg-background/50 border border-border/50 text-muted-foreground hover:bg-muted/80 hover:border-blue-400/20"
                  }`}
                  data-testid={`toggle-view-${view}`}
                >
                  <Icon className="h-4 w-4" />
                  {labels[view]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <AnimatePresence mode="wait">
          {activeView === "leaderboard" && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Card id="leaderboard">
                <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-4 space-y-0 pb-4">
                  <div className="flex-1">
                    <CardTitle className="text-2xl font-serif">Leaderboard</CardTitle>
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60">
                      <RefreshCw className="h-3 w-3" />
                      <span>Last updated a few seconds ago</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setTrendOverlayOpen(true)}
                      className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                      data-testid="button-compare-momentum"
                    >
                      <LineChart className="h-4 w-4 mr-2" />
                      Compare Momentum
                    </Button>
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
                    {allPeople.slice(0, visibleCount).map((person) => (
                      <LeaderboardRow
                        key={person.id}
                        person={person}
                        onVisitProfile={() => handleVisitProfile(person.id)}
                        onVoteClick={() => handleVoteClick(person.id)}
                      />
                    ))}
                  </div>
                  {allPeople.length > visibleCount && (
                    <div className="p-6 border-t text-center">
                      <Button 
                        variant="outline" 
                        onClick={handleLoadMore}
                        data-testid="button-load-more"
                      >
                        Load More ({allPeople.length - visibleCount} remaining)
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
            </motion.div>
          )}

          {activeView === "predict" && (
            <PredictHookView 
              topGainer={topGainers[0]} 
              onExplore={() => setLocation("/predict")} 
            />
          )}

          {activeView === "vote" && (
            <VoteHookView 
              topCandidate={allPeople[0]} 
              onExplore={() => setLocation("/vote")} 
            />
          )}
        </AnimatePresence>
      </div>

      <footer className="border-t mt-24 py-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            FameDex - Real-time celebrity trending tracker powered by live data APIs
          </p>
        </div>
      </footer>

      <AnimatePresence>
        {trendOverlayOpen && (
          <TrendGraphOverlay 
            open={trendOverlayOpen} 
            onClose={() => setTrendOverlayOpen(false)}
            allPeople={allPeople}
          />
        )}
      </AnimatePresence>

      <VotingModal 
        open={votingModalOpen} 
        onOpenChange={setVotingModalOpen}
        initialPersonId={votingPersonId}
        peopleList={allPeople}
      />
    </div>
  );
}
