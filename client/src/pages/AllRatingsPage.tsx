import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { goBack } from "@/lib/goBack";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Search, Trophy, Medal, Users, ThumbsUp, Scale, Star,
} from "lucide-react";
import { getRatingTileColor } from "@/lib/ratingColors";
import { getFilterCategoryIcon } from "@/components/interests/categoryIcons";
import {
  BASE_CATEGORY_FILTER_OPTIONS,
  getMarketCategoryLabel,
  matchesCategoryFilter,
  normalizeMarketCategory,
  type FilterCategory,
} from "@shared/constants";

interface RatedPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  secondaryCategories?: string[] | null;
  fameIndex: number | null;
  trendScore: number;
  isInduction: boolean;
  approvalAvgRating: number | null;
  approvalPct: number | null;
  approvalVotesCount: number;
  userApprovalRating: number | null;
  ratingDistribution: number[];
  imageSlug?: string | null;
}

type RatedPersonWithWeighted = RatedPerson & { weightedRating: number | null };

type SortMetric = "average" | "weighted";

const ZONE_LABELS = ["Hate", "Dislike", "Neutral", "Like", "Love"];
const RATING_COLORS = [1, 2, 3, 4, 5].map((r) => getRatingTileColor(r));

/** Five-segment Hate→Love distribution strip. */
function DistributionBar({ distribution, height = "h-2" }: { distribution: number[]; height?: string }) {
  const total = distribution.reduce((a, b) => a + b, 0);
  return (
    <div className={`${height} rounded-full overflow-hidden flex bg-white/5`}>
      {total > 0 &&
        distribution.map((count, i) =>
          count > 0 ? (
            <div
              key={i}
              className="h-full transition-all duration-700"
              style={{ width: `${(count / total) * 100}%`, backgroundColor: RATING_COLORS[i] }}
            />
          ) : null,
        )}
    </div>
  );
}

function ratingColorFor(avg: number | null): string | undefined {
  if (avg == null) return undefined;
  return RATING_COLORS[Math.max(1, Math.min(5, Math.round(avg))) - 1];
}

function SpotlightCard({
  title,
  person,
  icon: Icon,
  value,
  valueSuffix,
  valueColor,
  subValue,
}: {
  title: string;
  person: RatedPersonWithWeighted | null;
  icon: React.ComponentType<{ className?: string }>;
  value: string | null;
  valueSuffix?: string;
  valueColor?: string;
  subValue?: string | null;
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
  return (
    <Card
      className="relative p-5 bg-card/60 backdrop-blur-sm border border-cyan-500/25 flex flex-col cursor-pointer hover:bg-card/80 transition-all group"
      onClick={() => setLocation(`/person/${person.id}`)}
      data-testid={`spotlight-${title.toLowerCase().replace(/\s/g, "-")}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">{title}</span>
        <div className="h-7 w-7 rounded-full bg-cyan-500/15 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <PersonAvatar name={person.name} avatar={person.avatar} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">{person.name}</h3>
          {person.category && <CategoryPill category={person.category} size="sm" className="mt-0.5" />}
        </div>
        <span className="text-right">
          <span className="text-2xl font-bold tabular-nums" style={{ color: valueColor }}>
            {value ?? "—"}
            {value != null && valueSuffix && <span className="text-sm font-medium text-muted-foreground">{valueSuffix}</span>}
          </span>
          {subValue != null && (
            <span className="block text-[10px] text-muted-foreground tabular-nums">{subValue}</span>
          )}
        </span>
      </div>
      <DistributionBar distribution={person.ratingDistribution ?? [0, 0, 0, 0, 0]} />
    </Card>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/25 dark:bg-amber-500/20 border border-amber-500/50 dark:border-amber-500/40"><Trophy className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /></div>;
  if (rank === 2) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-400/20 border border-slate-500/50 dark:border-slate-400/40"><Medal className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" /></div>;
  if (rank === 3) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-orange-700/20 border border-orange-700/40"><Medal className="h-3.5 w-3.5 text-orange-600" /></div>;
  return <span className="w-7 text-center font-mono text-xs text-muted-foreground tabular-nums">{rank}</span>;
}

function RankingRow({
  person,
  rank,
  focusId,
  sortMetric,
}: {
  person: RatedPersonWithWeighted;
  rank: number;
  focusId: string | null;
  sortMetric: SortMetric;
}) {
  const [, setLocation] = useLocation();
  const isFocused = person.id === focusId;
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isFocused]);

  // Always display the true average; Weighted mode only changes ranking order.
  const primary = person.approvalAvgRating;
  const primaryColor = ratingColorFor(primary);
  const userRating = person.userApprovalRating;

  // Podium card variants follow displayed order (tracks the active sort mode).
  const rowVariantClass =
    rank === 1 ? "lb-row-gold" : rank === 2 ? "lb-row-silver" : rank === 3 ? "lb-row-bronze" : "lb-row-neutral";

  return (
    <button
      ref={rowRef}
      type="button"
      onClick={() => setLocation(`/person/${person.id}`)}
      // No-op touch handler: iOS Safari only applies :active (the press
      // glow/expand in .lb-row-card) to elements with a touch listener.
      onTouchStart={() => {}}
      className={`lb-row-enter lb-row-card ${rowVariantClass} ${isFocused ? "lb-row-selected" : ""} w-full text-left px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      data-testid={`row-rating-${person.id}`}
    >
      <div className="shrink-0"><RankBadge rank={rank} /></div>
      <PersonAvatar name={person.name} avatar={person.avatar} imageSlug={person.imageSlug} className="h-9 w-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm truncate">{person.name}</span>
          {person.category && <span className="hidden sm:inline-flex items-center"><CategoryPill category={person.category} size="sm" /></span>}
          {person.isInduction && (
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Induction
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 max-w-[200px]">
            <DistributionBar distribution={person.ratingDistribution ?? [0, 0, 0, 0, 0]} />
          </div>
          <span className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums shrink-0">
            <Users className="h-3 w-3" />
            {person.approvalVotesCount.toLocaleString("en-US")}
          </span>
        </div>
        {userRating != null && (
          <span className="text-[10px] text-muted-foreground mt-0.5 inline-block">
            You rated <span style={{ color: ratingColorFor(userRating) }}>{userRating}/5 – {ZONE_LABELS[userRating - 1]}</span>
          </span>
        )}
      </div>
      <div className="shrink-0 text-right">
        {primary != null ? (
          <>
            <span className="text-sm font-bold font-mono tabular-nums" style={{ color: primaryColor }}>
              {primary.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/5</span>
            {sortMetric === "weighted" && person.weightedRating != null && (
              <p className="text-[10px] text-muted-foreground tabular-nums">weighted {person.weightedRating.toFixed(2)}</p>
            )}
            <p className="sm:hidden text-[10px] text-muted-foreground tabular-nums">{person.approvalVotesCount.toLocaleString("en-US")} votes</p>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">--</span>
        )}
      </div>
    </button>
  );
}

function SkeletonRow() {
  return (
    <div className="lb-row-card lb-row-neutral flex items-center gap-3 px-4 py-3 rounded-xl">
      <Skeleton className="w-7 h-7 rounded-full shrink-0" />
      <Skeleton className="w-9 h-9 rounded-md shrink-0" />
      <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-2 w-48 rounded-full" /></div>
      <Skeleton className="h-4 w-10" />
    </div>
  );
}

export default function AllRatingsPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { favoriteIds } = useFavorites();
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMetric, setSortMetric] = useState<SortMetric>("average");
  const filterScrollRef = useRef<HTMLDivElement>(null);

  const focusId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("focus");
  }, []);

  const { data: ratingsData, isLoading, error, refetch } = useQuery<{ data: RatedPerson[]; totalCount: number }>({
    queryKey: ["/api/vote/overall-ratings?limit=500"],
    staleTime: 60 * 1000,
  });

  const rawPeople = ratingsData?.data ?? [];

  // Bayesian/confidence-adjusted rating: shrinks low-sample averages toward
  // the global mean so a 4.6 on 10,000 votes can outrank a 4.9 on 500.
  // weighted = (v / (v + m)) * avg + (m / (v + m)) * globalAvg, with the prior
  // m derived from the median vote count of rated people (min 10).
  const allPeople: RatedPersonWithWeighted[] = useMemo(() => {
    const rated = rawPeople.filter((p) => p.approvalAvgRating != null && p.approvalVotesCount > 0);
    const totalVotes = rated.reduce((s, p) => s + p.approvalVotesCount, 0);
    const globalAvg = totalVotes > 0
      ? rated.reduce((s, p) => s + (p.approvalAvgRating ?? 0) * p.approvalVotesCount, 0) / totalVotes
      : 3;
    const sortedCounts = rated.map((p) => p.approvalVotesCount).sort((a, b) => a - b);
    const median = sortedCounts.length > 0 ? sortedCounts[Math.floor(sortedCounts.length / 2)] : 0;
    const m = Math.max(10, median);
    return rawPeople.map((p) => {
      if (p.approvalAvgRating == null || p.approvalVotesCount <= 0) {
        return { ...p, weightedRating: null };
      }
      const v = p.approvalVotesCount;
      const weighted = (v / (v + m)) * p.approvalAvgRating + (m / (v + m)) * globalAvg;
      return { ...p, weightedRating: weighted };
    });
  }, [rawPeople]);

  const filtered = useMemo(() => {
    let list = allPeople;
    if (categoryFilter === "favorites") {
      list = list.filter((p) => favoriteIds.has(p.id));
    } else if (categoryFilter !== "all" && categoryFilter !== "trending") {
      list = list.filter((p) => matchesCategoryFilter(p.category, p.secondaryCategories ?? undefined, categoryFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    const metric = (p: RatedPersonWithWeighted) =>
      sortMetric === "average" ? p.approvalAvgRating : p.weightedRating;
    list = [...list].sort((a, b) => {
      const diff = (metric(b) ?? -999) - (metric(a) ?? -999);
      if (diff !== 0) return diff;
      return b.approvalVotesCount - a.approvalVotesCount;
    });
    return list;
  }, [allPeople, categoryFilter, searchQuery, sortMetric, favoriteIds]);

  const categoryFilterOptions = useMemo(() => {
    const base = BASE_CATEGORY_FILTER_OPTIONS;
    const known = new Set(base.map((o) => o.id as string));
    const extras: { id: FilterCategory; label: string }[] = [];
    for (const person of allPeople) {
      const ids = [person.category, ...(person.secondaryCategories ?? [])];
      for (const raw of ids) {
        if (!raw) continue;
        const id = normalizeMarketCategory(raw);
        if (id === "all" || id === "trending" || known.has(id)) continue;
        known.add(id);
        extras.push({ id: id as FilterCategory, label: getMarketCategoryLabel(id) });
      }
    }
    return extras.length > 0 ? [...base, ...extras] : base;
  }, [allPeople]);

  const spotlightHighestRated = useMemo(
    () => [...allPeople].sort((a, b) => (b.approvalAvgRating ?? -999) - (a.approvalAvgRating ?? -999))[0] ?? null,
    [allPeople],
  );
  const spotlightTopWeighted = useMemo(
    () => [...allPeople].sort((a, b) => (b.weightedRating ?? -999) - (a.weightedRating ?? -999))[0] ?? null,
    [allPeople],
  );
  const spotlightMostVotes = useMemo(
    () => [...allPeople].sort((a, b) => b.approvalVotesCount - a.approvalVotesCount)[0] ?? null,
    [allPeople],
  );

  const handleFilterScroll = useCallback((e: React.WheelEvent) => {
    if (filterScrollRef.current) filterScrollRef.current.scrollLeft += e.deltaY;
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => goBack(setLocation, "/vote")} className="shrink-0" aria-label="Go back" data-testid="button-back-vote">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link href="/"><VoxDexLogo size={24} /></Link>
          </div>
          <HeaderUserActions />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/15 dark:bg-cyan-500/10 flex items-center justify-center">
              <ThumbsUp className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <h1 className="text-2xl font-serif font-bold">Overall Rating Rankings</h1>
          </div>
          <p className="text-sm text-muted-foreground ml-[46px]">See who the community rates highest — by raw average or adjusted for vote volume</p>
        </div>

        <div className="flex items-center gap-4 mb-5 text-xs text-muted-foreground ml-1">
          {ZONE_LABELS.map((zone, i) => (
            <span key={zone} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RATING_COLORS[i] }} />
              {zone}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <SpotlightCard
            title="Highest Rated"
            person={spotlightHighestRated}
            icon={Star}
            value={spotlightHighestRated?.approvalAvgRating != null ? spotlightHighestRated.approvalAvgRating.toFixed(1) : null}
            valueSuffix="/5"
            valueColor={ratingColorFor(spotlightHighestRated?.approvalAvgRating ?? null)}
          />
          <SpotlightCard
            title="Top Weighted"
            person={spotlightTopWeighted}
            icon={Scale}
            value={spotlightTopWeighted?.approvalAvgRating != null ? spotlightTopWeighted.approvalAvgRating.toFixed(1) : null}
            valueSuffix="/5"
            valueColor={ratingColorFor(spotlightTopWeighted?.approvalAvgRating ?? null)}
            subValue={spotlightTopWeighted?.weightedRating != null ? `weighted ${spotlightTopWeighted.weightedRating.toFixed(2)}` : null}
          />
          <SpotlightCard
            title="Most Votes"
            person={spotlightMostVotes}
            icon={Users}
            value={spotlightMostVotes ? spotlightMostVotes.approvalVotesCount.toLocaleString("en-US") : null}
            valueColor="hsl(var(--foreground))"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div ref={filterScrollRef} onWheel={handleFilterScroll} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0 sm:flex-1 sm:min-w-0">
            {categoryFilterOptions.map(({ id, label }) => {
              const isFavorites = id === "favorites";
              const Icon = getFilterCategoryIcon(id);
              const isActive = categoryFilter === id;
              return (
                <button key={id} onClick={() => { if (isFavorites && !user) { navigateToLogin(setLocation); return; } setCategoryFilter(id); }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap ${isActive ? "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-500 dark:text-cyan-300" : "bg-slate-800/30 border-slate-700/40 text-slate-600 dark:text-slate-400 hover:border-slate-600"}`}
                  data-testid={`filter-rating-${id}`}
                >
                  {Icon && <Icon className="h-3 w-3" />}{label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 w-40 text-xs" data-testid="input-rating-search" />
            </div>
            <div className="flex items-center rounded-lg border border-border/50 bg-muted/30 p-0.5" role="group" aria-label="Ranking metric">
              <button
                type="button"
                onClick={() => setSortMetric("average")}
                className={`px-2.5 h-7 rounded-md text-xs font-medium transition-all ${sortMetric === "average" ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="toggle-sort-average"
              >
                Top Rated
              </button>
              <button
                type="button"
                onClick={() => setSortMetric("weighted")}
                className={`px-2.5 h-7 rounded-md text-xs font-medium transition-all ${sortMetric === "weighted" ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="toggle-sort-weighted"
              >
                Weighted
              </button>
            </div>
          </div>
        </div>

        {sortMetric === "weighted" && (
          <p className="text-[11px] text-muted-foreground mb-3 px-1">
            Weighted mode re-orders by a volume-adjusted score — a 4.6 from thousands of votes can outrank a 4.9 from a handful. Ratings shown are still each person's true average.
          </p>
        )}

        {!isLoading && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 px-1">
            <Users className="h-3 w-3" /><span>{filtered.length.toLocaleString("en-US")} celebrit{filtered.length === 1 ? "y" : "ies"}</span>
          </div>
        )}

        {isLoading ? (
          <div className="pt-2 sm:pt-3 space-y-1.5">
            {Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : error ? (
          <Card className="border-border/40 overflow-hidden bg-card/60 backdrop-blur-sm">
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="h-16 w-16 rounded-full bg-red-500/15 dark:bg-red-500/10 border border-red-500/30 dark:border-red-500/20 flex items-center justify-center mb-4"><ThumbsUp className="h-8 w-8 text-red-600/60 dark:text-red-400/60" /></div>
              <h3 className="text-lg font-semibold mb-1">Couldn&apos;t load ratings</h3>
              <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-rating">Retry</Button>
            </div>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="border-border/40 overflow-hidden bg-card/60 backdrop-blur-sm">
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="h-16 w-16 rounded-full bg-slate-500/15 dark:bg-slate-500/10 border border-slate-500/30 dark:border-slate-500/20 flex items-center justify-center mb-4"><Search className="h-8 w-8 text-slate-600/60 dark:text-slate-400/60" /></div>
              <h3 className="text-lg font-semibold mb-1">No results</h3>
              <p className="text-muted-foreground text-sm">Try adjusting your filters or search.</p>
            </div>
          </Card>
        ) : (
          <div className="lb-row-list pt-2 sm:pt-3 space-y-1.5">
            {filtered.map((person, idx) => <RankingRow key={person.id} person={person} rank={idx + 1} focusId={focusId} sortMetric={sortMetric} />)}
          </div>
        )}

        <div className="text-center mt-8 pb-20">
          <Button variant="ghost" onClick={() => goBack(setLocation, "/vote")} className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300" data-testid="button-back-vote-bottom">
            <ArrowLeft className="h-4 w-4 mr-1" />Back to Vote
          </Button>
        </div>
      </main>
    </div>
  );
}
