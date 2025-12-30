import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { VotingModal } from "@/components/VotingModal";
import { UserMenu } from "@/components/UserMenu";
import { FilterDropdown } from "@/components/FilterDropdown";
import { SortDropdown } from "@/components/SortDropdown";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { WeeklyJackpotCard } from "@/components/predict/WeeklyJackpotCard";
import { InductionLeaderboardSlice, INDUCTION_CANDIDATES } from "@/components/vote/InductionLeaderboardSlice";
import { PeoplesVoicePoll, DISCOURSE_TOPICS } from "@/components/vote/PeoplesVoicePoll";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, RefreshCw, TrendingUp, TrendingDown, Activity, ChevronRight, LineChart, Vote, Trophy, Zap, Users, Sparkles, Target, Crown, Check, ThumbsUp, ThumbsDown, Minus, Flame } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
  const iconColor = type === "daily" ? "text-blue-400" : type === "gainer" ? "text-green-400" : "text-red-400";
  
  const borderClass = type === "daily" 
    ? "pulse-border-blue" 
    : type === "gainer" 
      ? "pulse-border-green" 
      : "pulse-border-red";
  
  return (
    <Card 
      className={`min-w-[280px] md:min-w-0 shrink-0 md:shrink bg-slate-900/60 border-0 backdrop-blur-sm h-full ${borderClass}`}
      data-testid={`pulse-card-${type}`}
    >
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          <CardTitle className="text-sm font-medium text-slate-200">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {people.slice(0, 5).map((person, idx) => {
          const changeValue = type === "daily" ? person.change24h : person.change7d;
          if (changeValue === undefined || changeValue === null || isNaN(changeValue)) return null;
          const isPositive = changeValue >= 0;
          return (
            <div
              key={person.id}
              className="flex items-center gap-2 p-2 rounded-lg hover-elevate cursor-pointer bg-slate-800/40"
              onClick={() => onPersonClick(person.id)}
              data-testid={`pulse-item-${person.id}`}
            >
              <span className="font-mono text-xs font-bold text-slate-500 w-4">{idx + 1}</span>
              <PersonAvatar name={person.name} avatar={person.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs truncate text-slate-200">{person.name}</p>
                <p className="text-[10px] text-slate-500">{person.category}</p>
              </div>
              <span 
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  isPositive 
                    ? "bg-green-500/20 text-green-400 border border-green-500/30" 
                    : "bg-red-500/20 text-red-400 border border-red-500/30"
                }`}
              >
                {isPositive ? "+" : ""}{changeValue.toFixed(1)}%
              </span>
            </div>
          );
        })}
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

  const historyQueries = useQueries({
    queries: filteredPeople.map(person => ({
      queryKey: [`/api/trending/${person.id}/history`, 7],
      queryFn: async () => {
        const res = await fetch(`/api/trending/${person.id}/history?days=7`);
        if (!res.ok) return [];
        return res.json();
      },
      enabled: open && filteredPeople.length > 0,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoadingHistory = historyQueries.some(q => q.isLoading);

  const trendData = useMemo(() => {
    if (historyQueries.some(q => q.isLoading) || filteredPeople.length === 0) return [];
    
    const allTimestamps = new Map<string, Record<string, string | number>>();
    
    filteredPeople.forEach((person, idx) => {
      const data = historyQueries[idx]?.data || [];
      data.forEach((point: { date: string; time: string; trendScore: number }) => {
        const key = point.date;
        if (!allTimestamps.has(key)) {
          allTimestamps.set(key, { date: key });
        }
        const entry = allTimestamps.get(key)!;
        entry[person.id] = point.trendScore;
      });
    });
    
    return Array.from(allTimestamps.values())
      .sort((a, b) => {
        const dateA = new Date(a.date as string);
        const dateB = new Date(b.date as string);
        return dateA.getTime() - dateB.getTime();
      })
      .slice(-14);
  }, [historyQueries, filteredPeople]);

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
              {isLoadingHistory ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent"></div>
                    <p className="mt-4 text-sm text-muted-foreground">Loading trend history...</p>
                  </div>
                </div>
              ) : trendData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-muted-foreground">No trend data available yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis 
                      dataKey="date" 
                      stroke="rgba(255,255,255,0.5)" 
                      fontSize={12}
                      tickFormatter={(value) => {
                        const parts = value.split('/');
                        if (parts.length >= 2) {
                          return `${parts[0]}/${parts[1]}`;
                        }
                        return value;
                      }}
                    />
                    <YAxis 
                      stroke="rgba(255,255,255,0.5)" 
                      fontSize={12}
                      tickFormatter={(value) => {
                        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                        if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                        return value;
                      }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(0,0,0,0.9)', 
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number, name: string) => {
                        const formatted = value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value;
                        return [formatted, name];
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
                          dot={{ fill: lineColors[idx % lineColors.length], strokeWidth: 0, r: 3 }}
                          activeDot={{ r: 6, stroke: lineColors[idx % lineColors.length], strokeWidth: 2 }}
                          connectNulls
                        />
                      )
                    ))}
                  </RechartsLineChart>
                </ResponsiveContainer>
              )}
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

function PredictHookView({ 
  trendingPeople, 
  isLoading, 
  onExplore 
}: { 
  trendingPeople: TrendingPerson[]; 
  isLoading: boolean;
  onExplore: () => void;
}) {
  const marketState = useMarketCycle();
  const [selectedPerson, setSelectedPerson] = useState<TrendingPerson | null>(null);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-2xl mx-auto space-y-6"
    >
      <MarketCycleHero marketState={marketState} />
      
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-violet-500/10 text-violet-300 border-violet-400/30">
            <Flame className="h-3 w-3 mr-1" />
            Hot
          </Badge>
          <span className="text-sm text-muted-foreground">Featured Market</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-amber-400" />
          <span>247 predicting now</span>
        </div>
      </div>
      
      <WeeklyJackpotCard
        onEnterJackpot={onExplore}
        isMarketClosed={marketState.status === "CLOSED"}
        timeRemaining={marketState.timeRemaining}
        trendingPeople={trendingPeople}
        selectedPerson={selectedPerson}
        onSelectPerson={setSelectedPerson}
        isLoading={isLoading}
        compact={true}
      />

      <div className="flex flex-col items-center gap-3 pt-2">
        <Button 
          size="lg"
          className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold px-8 shadow-lg shadow-violet-500/20"
          onClick={onExplore}
          data-testid="button-explore-markets"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Explore All Prediction Markets
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
        <p className="text-xs text-muted-foreground">
          Up/Down • Head-to-Head • Category Races • Community Markets
        </p>
      </div>
    </motion.div>
  );
}

function VoteHookView({ 
  onExplore 
}: { 
  onExplore: () => void;
}) {
  const [votedCandidates, setVotedCandidates] = useState<Set<string>>(new Set());
  
  const handleToggleVote = (id: string) => {
    setVotedCandidates(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  
  const handlePollVote = (topicId: string, choice: 'support' | 'neutral' | 'oppose') => {
    console.log(`Voted ${choice} on topic ${topicId}`);
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-3xl mx-auto space-y-6"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-cyan-500/10 text-cyan-300 border-cyan-400/30">
            <Flame className="h-3 w-3 mr-1" />
            Active
          </Badge>
          <span className="text-sm text-muted-foreground">Community Governance</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-cyan-400" />
          <span>1.2M+ total votes</span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InductionLeaderboardSlice
          candidates={INDUCTION_CANDIDATES}
          limit={3}
          votedCandidates={votedCandidates}
          onToggleVote={handleToggleVote}
        />
        
        <PeoplesVoicePoll
          topic={DISCOURSE_TOPICS[0]}
          onVote={handlePollVote}
        />
      </div>

      <div className="flex flex-col items-center gap-3 pt-2">
        <Button 
          size="lg"
          className="bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-semibold px-8 shadow-lg shadow-cyan-500/20"
          onClick={onExplore}
          data-testid="button-explore-governance"
        >
          <Vote className="h-4 w-4 mr-2" />
          Go to Governance Hub
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
        <p className="text-xs text-muted-foreground">
          Inductions • Profile Curation • Community Polls
        </p>
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
            </div>
            <UserMenu />
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
              trendingPeople={allPeople} 
              isLoading={isLoading}
              onExplore={() => setLocation("/predict")} 
            />
          )}

          {activeView === "vote" && (
            <VoteHookView 
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
