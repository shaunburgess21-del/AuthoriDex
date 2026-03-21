import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { UserMenu } from "@/components/UserMenu";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, ArrowUp, ArrowDown, Minus, Search, Trophy, Medal,
  Users, BarChart3, Star, Heart, LayoutGrid, Flame, Crown, TrendingUp,
} from "lucide-react";
import { BASE_FILTER_CATEGORIES, type FilterCategory } from "@shared/constants";

interface ValuePerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  trendScore: number;
  fameIndex: number | null;
  underratedPct: number | null;
  overratedPct: number | null;
  fairlyRatedPct: number | null;
  valueScore: number | null;
  userValueVote: string | null;
  leaderboardRank: number;
  imageSlug?: string | null;
}

type SortField = "valueScore" | "underratedPct" | "overratedPct" | "fairlyRatedPct";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "valueScore", label: "Value Score" },
  { value: "underratedPct", label: "Most Underrated" },
  { value: "overratedPct", label: "Most Overrated" },
  { value: "fairlyRatedPct", label: "Most Fairly Rated" },
];

const VOTE_CATEGORY_ICONS: Record<string, React.ComponentType<any>> = {
  All: LayoutGrid, Favorites: Heart, Trending: Flame, Tech: BarChart3,
  Business: TrendingUp, Music: Star, Creator: Crown,
};

function PerceptionBar({ uPct, fPct, oPct, height = "h-2.5" }: { uPct: number; fPct: number; oPct: number; height?: string }) {
  return (
    <div className={`${height} rounded-full overflow-hidden flex bg-white/5`}>
      {uPct > 0 && <div className="h-full bg-[#00C853] transition-all duration-700" style={{ width: `${uPct}%` }} />}
      {fPct > 0 && <div className="h-full bg-slate-500 transition-all duration-700" style={{ width: `${fPct}%` }} />}
      {oPct > 0 && <div className="h-full bg-[#FF0000] transition-all duration-700" style={{ width: `${oPct}%` }} />}
    </div>
  );
}

function SpotlightCard({
  title, person, accentColor, accentBg, accentBorder,
  icon: Icon, pctField,
}: {
  title: string;
  person: ValuePerson | null;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  icon: React.ComponentType<{ className?: string }>;
  pctField: "underratedPct" | "overratedPct" | "fairlyRatedPct";
}) {
  const [, setLocation] = useLocation();
  if (!person) {
    return (
      <Card className="p-5 bg-card/60 backdrop-blur-sm border-border/40 flex flex-col items-center gap-3 min-h-[180px] justify-center">
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </Card>
    );
  }
  const pct = person[pctField] ?? 0;
  return (
    <Card
      className={`relative p-5 bg-card/60 backdrop-blur-sm border ${accentBorder} flex flex-col cursor-pointer hover:bg-card/80 transition-all group`}
      onClick={() => setLocation(`/person/${person.id}`)}
      data-testid={`spotlight-${pctField}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold uppercase tracking-wider ${accentColor}`}>{title}</span>
        <div className={`h-7 w-7 rounded-full ${accentBg} flex items-center justify-center`}>
          <Icon className={`h-3.5 w-3.5 ${accentColor}`} />
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <PersonAvatar name={person.name} avatar={person.avatar} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm truncate group-hover:text-cyan-400 transition-colors">{person.name}</h3>
          {person.category && <CategoryPill category={person.category} size="sm" className="mt-0.5" />}
        </div>
        <span className={`text-2xl font-bold tabular-nums ${accentColor}`}>{Math.round(pct)}%</span>
      </div>
      <PerceptionBar uPct={person.underratedPct ?? 0} fPct={person.fairlyRatedPct ?? 0} oPct={person.overratedPct ?? 0} />
    </Card>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/40"><Trophy className="h-3.5 w-3.5 text-amber-400" /></div>;
  if (rank === 2) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-400/20 border border-slate-400/40"><Medal className="h-3.5 w-3.5 text-slate-400" /></div>;
  if (rank === 3) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-orange-700/20 border border-orange-700/40"><Medal className="h-3.5 w-3.5 text-orange-600" /></div>;
  return <span className="w-7 text-center font-mono text-xs text-muted-foreground tabular-nums">{rank}</span>;
}

function ValueScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">--</span>;
  const color = score > 0 ? "text-[#00C853]" : score < 0 ? "text-[#FF0000]" : "text-slate-400";
  return <span className={`text-sm font-bold font-mono tabular-nums ${color}`}>{score > 0 ? "+" : ""}{Math.round(score)}</span>;
}

function RankingRow({ person, rank, focusId }: { person: ValuePerson; rank: number; focusId: string | null }) {
  const [, setLocation] = useLocation();
  const isFocused = person.id === focusId;
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isFocused]);

  const uPct = person.underratedPct ?? 0;
  const fPct = person.fairlyRatedPct ?? 0;
  const oPct = person.overratedPct ?? 0;

  const voteLabel = person.userValueVote === "underrated" ? "underrated"
    : person.userValueVote === "overrated" ? "overrated"
    : person.userValueVote === "fairly_rated" ? "fairly rated" : null;
  const voteColor = person.userValueVote === "underrated" ? "text-[#00C853]"
    : person.userValueVote === "overrated" ? "text-[#FF0000]" : "text-slate-400";

  return (
    <button
      ref={rowRef}
      type="button"
      onClick={() => setLocation(`/person/${person.id}`)}
      className={`w-full text-left px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 border-b border-border/30 transition-colors hover:bg-muted/30 ${isFocused ? "bg-cyan-500/5 ring-1 ring-inset ring-cyan-500/30" : ""}`}
      data-testid={`row-value-${person.id}`}
    >
      <div className="shrink-0"><RankBadge rank={rank} /></div>
      <PersonAvatar name={person.name} avatar={person.avatar} imageSlug={person.imageSlug} className="h-9 w-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm truncate">{person.name}</span>
          {person.category && <span className="hidden sm:inline-flex items-center"><CategoryPill category={person.category} size="sm" /></span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 max-w-[200px]">
            <PerceptionBar uPct={uPct} fPct={fPct} oPct={oPct} height="h-2" />
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums shrink-0">
            <span className="text-[#00C853]">{Math.round(uPct)}%</span>
            <span className="text-slate-500">{Math.round(fPct)}%</span>
            <span className="text-[#FF0000]">{Math.round(oPct)}%</span>
          </div>
        </div>
        {voteLabel && <span className="text-[10px] text-muted-foreground mt-0.5 inline-block">You voted <span className={voteColor}>{voteLabel}</span></span>}
      </div>
      <div className="shrink-0 text-right"><ValueScoreBadge score={person.valueScore} /></div>
    </button>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
      <Skeleton className="w-7 h-7 rounded-full shrink-0" />
      <Skeleton className="w-9 h-9 rounded-md shrink-0" />
      <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-2 w-48 rounded-full" /></div>
      <Skeleton className="h-4 w-10" />
    </div>
  );
}

export default function ValueRatingsPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { favoriteIds } = useFavorites();
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("valueScore");
  const filterScrollRef = useRef<HTMLDivElement>(null);

  const focusId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("focus");
  }, []);

  const { data: leaderboardData, isLoading, error, refetch } = useQuery<{ data: ValuePerson[]; totalCount: number }>({
    queryKey: ["/api/leaderboard?tab=value&limit=300"],
  });

  const allPeople = leaderboardData?.data ?? [];

  const filtered = useMemo(() => {
    let list = allPeople;
    if (categoryFilter === "Favorites") {
      list = list.filter((p) => favoriteIds.has(p.id));
    } else if (categoryFilter !== "All" && categoryFilter !== "Trending") {
      list = list.filter((p) => (p.category || "").toLowerCase() === categoryFilter.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => ((b[sortField] ?? -999) as number) - ((a[sortField] ?? -999) as number));
    return list;
  }, [allPeople, categoryFilter, searchQuery, sortField, favoriteIds]);

  const spotlightMostUnderrated = useMemo(() => [...allPeople].sort((a, b) => (b.underratedPct ?? 0) - (a.underratedPct ?? 0))[0] ?? null, [allPeople]);
  const spotlightMostOverrated = useMemo(() => [...allPeople].sort((a, b) => (b.overratedPct ?? 0) - (a.overratedPct ?? 0))[0] ?? null, [allPeople]);
  const spotlightMostFairlyRated = useMemo(() => [...allPeople].sort((a, b) => (b.fairlyRatedPct ?? 0) - (a.fairlyRatedPct ?? 0))[0] ?? null, [allPeople]);

  const handleFilterScroll = useCallback((e: React.WheelEvent) => {
    if (filterScrollRef.current) filterScrollRef.current.scrollLeft += e.deltaY;
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/vote")} className="shrink-0" data-testid="button-back-vote">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link href="/"><VoxDexLogo size="sm" /></Link>
          </div>
          <div className="flex items-center gap-2"><UserMenu /></div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
            </div>
            <h1 className="text-2xl font-serif font-bold">Community Perception Rankings</h1>
          </div>
          <p className="text-sm text-muted-foreground ml-[46px]">See who the community thinks is underrated, overrated, or fairly rated</p>
        </div>

        <div className="flex items-center gap-4 mb-5 text-xs text-muted-foreground ml-1">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#00C853]" />Underrated</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" />Fairly Rated</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#FF0000]" />Overrated</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <SpotlightCard title="Most Underrated" person={spotlightMostUnderrated} accentColor="text-[#00C853]" accentBg="bg-[#00C853]/15" accentBorder="border-[#00C853]/25" icon={ArrowUp} pctField="underratedPct" />
          <SpotlightCard title="Most Overrated" person={spotlightMostOverrated} accentColor="text-[#FF0000]" accentBg="bg-[#FF0000]/15" accentBorder="border-[#FF0000]/25" icon={ArrowDown} pctField="overratedPct" />
          <SpotlightCard title="Most Fairly Rated" person={spotlightMostFairlyRated} accentColor="text-slate-400" accentBg="bg-slate-400/15" accentBorder="border-slate-500/25" icon={Minus} pctField="fairlyRatedPct" />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div ref={filterScrollRef} onWheel={handleFilterScroll} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0 sm:flex-1 sm:min-w-0">
            {BASE_FILTER_CATEGORIES.map((cat) => {
              const isFavorites = cat === "Favorites";
              const Icon = VOTE_CATEGORY_ICONS[cat];
              const isActive = categoryFilter === cat;
              return (
                <button key={cat} onClick={() => { if (isFavorites && !user) { setLocation("/login"); return; } setCategoryFilter(cat as FilterCategory); }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap ${isActive ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300" : "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"}`}
                  data-testid={`filter-value-${cat.toLowerCase()}`}
                >
                  {Icon && <Icon className="h-3 w-3" />}{cat}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 w-40 text-xs bg-muted/30 border-border/50" data-testid="input-value-search" />
            </div>
            <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
              <SelectTrigger className="h-8 w-[150px] text-xs bg-muted/30 border-border/50" data-testid="select-value-sort"><SelectValue /></SelectTrigger>
              <SelectContent>{SORT_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {!isLoading && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 px-1">
            <Users className="h-3 w-3" /><span>{filtered.length.toLocaleString("en-US")} celebrit{filtered.length === 1 ? "y" : "ies"}</span>
          </div>
        )}

        <Card className="border-border/40 overflow-hidden bg-card/60 backdrop-blur-sm">
          {isLoading ? (
            <div>{Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="h-16 w-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4"><BarChart3 className="h-8 w-8 text-red-400/60" /></div>
              <h3 className="text-lg font-semibold mb-1">Couldn&apos;t load rankings</h3>
              <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-value">Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="h-16 w-16 rounded-full bg-slate-500/10 border border-slate-500/20 flex items-center justify-center mb-4"><Search className="h-8 w-8 text-slate-400/60" /></div>
              <h3 className="text-lg font-semibold mb-1">No results</h3>
              <p className="text-muted-foreground text-sm">Try adjusting your filters or search.</p>
            </div>
          ) : (
            <div>{filtered.map((person, idx) => <RankingRow key={person.id} person={person} rank={idx + 1} focusId={focusId} />)}</div>
          )}
        </Card>

        <div className="text-center mt-8 pb-20">
          <Button variant="ghost" onClick={() => setLocation("/vote")} className="text-cyan-400 hover:text-cyan-300" data-testid="button-back-vote-bottom">
            <ArrowLeft className="h-4 w-4 mr-1" />Back to Vote
          </Button>
        </div>
      </main>
    </div>
  );
}
