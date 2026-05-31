import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, RefreshCw, Star, Users, X, HelpCircle, Vote, Swords, MessageSquare, BarChart3, UserPlus, ImageIcon, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { LeaderboardRow } from "@/components/LeaderboardRow";
import { VotingModal } from "@/components/VotingModal";
import { SearchBar } from "@/components/SearchBar";
import { FilterDropdown } from "@/components/FilterDropdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

import { getAuthHeaders } from "@/lib/queryClient";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { normalizeMarketCategory } from "@shared/constants";
import { VOTE_HUB_DEEP_LINKS, type VoteHubSectionToggle } from "@/lib/voteHubDeepLinks";
import type { TrendingPerson } from "@shared/schema";

const PAGE_SIZE = 20;

interface TrendingResponse {
  data: TrendingPerson[];
  totalCount: number;
  hasMore: boolean;
}

type SortDirection = "desc" | "asc";

const VOTE_HUB_LINK_ICONS: Record<VoteHubSectionToggle, LucideIcon> = {
  "Sentiment Polls": MessageSquare,
  Matchups: Swords,
  "Opinion Polls": Vote,
  "Underrated/Overrated": BarChart3,
  "Induction Queue": UserPlus,
  "Curate Profile": ImageIcon,
};

function ApprovalSnapshot() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Star className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
        <h3 className="text-sm font-semibold">Approval rating</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The <span className="font-medium text-foreground">Approval</span> score on each row is an aggregate from the community (shown out of 5).
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Use <span className="font-medium text-foreground">Rate</span> on a row to cast your own 1–5 vote—it feeds into that person&apos;s approval rating.
      </p>
    </div>
  );
}

function DrawerNavList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40">
      {children}
    </div>
  );
}

function DrawerNavLink({
  href,
  label,
  icon: Icon,
  onNavigateLink,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  onNavigateLink: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={() => onNavigateLink()}
      className="flex min-h-10 items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40" aria-hidden>
          <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden />
        </span>
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}

function ApprovalInfoBody({ onNavigateLink }: { onNavigateLink: () => void }) {
  return (
    <>
      <ApprovalSnapshot />
      <div className="mt-6 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">More on Vote</p>
        <DrawerNavList>
          {VOTE_HUB_DEEP_LINKS.map(({ label, href, sectionToggle }) => (
            <DrawerNavLink
              key={href}
              href={href}
              label={label}
              icon={VOTE_HUB_LINK_ICONS[sectionToggle]}
              onNavigateLink={onNavigateLink}
            />
          ))}
        </DrawerNavList>
      </div>
    </>
  );
}

export function ApprovalTab() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const leaderboardCategories = useLeaderboardCategories();
  const categoryRegistry = useCategoryRegistry();

  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState(() => {
    if (typeof window === "undefined") return "all";
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("category");
    if (!raw) return "all";
    const lowered = raw.toLowerCase();
    if (lowered === "trending") return "all";
    if (lowered === "all" || lowered === "favorites") return lowered;
    return normalizeMarketCategory(raw);
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const [votingPersonId, setVotingPersonId] = useState<string | null>(null);
  const [voteLeaderboardInfoOpen, setVoteLeaderboardInfoOpen] = useState(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery<TrendingResponse>({
    queryKey: ["/api/leaderboard", searchQuery, category, "approval", sortDirection],
    queryFn: async ({ pageParam = 0 }) => {
      const queryParams = new URLSearchParams();
      if (searchQuery) queryParams.set("search", searchQuery);
      if (category !== "all") queryParams.set("category", category);
      queryParams.set("limit", String(PAGE_SIZE));
      queryParams.set("offset", String(pageParam));
      queryParams.set("tab", "approval");
      queryParams.set("sortDir", sortDirection);

      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/leaderboard?${queryParams}`, {
        credentials: "include",
        headers: authHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.data.length, 0);
      return loadedCount < lastPage.totalCount ? loadedCount : undefined;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const allPeople = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);
  const totalCount = data?.pages[0]?.totalCount ?? 0;

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const sentinel = document.getElementById("approval-infinite-sentinel");
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, allPeople.length]);

  const hasActiveFilters = !!searchQuery || category !== "all";

  const resolveCategoryLabel = useCallback(
    (id: string): string => {
      const registryHit = categoryRegistry.byId.get(id);
      if (registryHit?.label) return registryHit.label;
      return categoryRegistry.getDisplayLabel(id);
    },
    [categoryRegistry],
  );

  const leaderboardFilterCategories = useMemo(() => {
    const pinned = [
      { value: "all", label: "All Categories" },
      { value: "favorites", label: "Favorites" },
    ];
    const dynamic = Array.from(leaderboardCategories ?? [])
      .filter((id) => id && id !== "all" && id !== "favorites" && id !== "trending")
      .sort((a, b) => resolveCategoryLabel(a).localeCompare(resolveCategoryLabel(b)))
      .map((id) => ({ value: id, label: resolveCategoryLabel(id) }));
    if (
      category !== "all" &&
      category !== "favorites" &&
      category !== "trending" &&
      !dynamic.some((c) => c.value === category)
    ) {
      dynamic.unshift({ value: category, label: resolveCategoryLabel(category) });
    }
    return [...pinned, ...dynamic];
  }, [leaderboardCategories, category, resolveCategoryLabel]);

  const activeCategoryLabel = useMemo(() => {
    if (category === "all") return "All Categories";
    if (category === "favorites") return "Favorites";
    return resolveCategoryLabel(category);
  }, [category, resolveCategoryLabel]);

  const handleClearFilters = () => {
    setSearchQuery("");
    setCategory("all");
  };

  const handleVoteClick = (personId: string) => {
    setVotingPersonId(personId);
    setVotingModalOpen(true);
  };

  const handleRowOpenInsight = (person: TrendingPerson) => {
    setLocation(`/person/${person.id}`);
  };

  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Failed to load approval leaderboard.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-visible">
        <div className="relative isolate overflow-hidden rounded-t-xl">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-[linear-gradient(90deg,transparent_0%,rgb(34,211,238)_50%,transparent_100%)]"
            aria-hidden
          />
          <CardHeader className="relative z-[2] flex flex-col gap-4 space-y-0 bg-card/95 pb-4 pt-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-2xl font-serif flex items-center gap-2">
                    <Star className="h-5 w-5 text-[#22D3EE]" aria-hidden />
                    Approval Leaderboard
                  </CardTitle>
                </div>
                <p className="mt-1 text-xs text-muted-foreground/70 max-w-xl">
                  Ranked by community approval. Tap <span className="font-medium text-foreground">Rate</span> on any row to cast a 1–5 vote.
                </p>
              </div>
            </div>
          </CardHeader>
        </div>

        <div
          className="border-b border-border/60 bg-card/95"
          data-testid="approval-leaderboard-toolbar"
        >
          <div className="pl-3 pr-4 sm:pr-6 py-4 bg-muted/30">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FilterDropdown
                  value={category}
                  onChange={setCategory}
                  categories={leaderboardFilterCategories}
                  sortDirection={sortDirection}
                  onSortDirectionChange={setSortDirection}
                />
                <div className="flex-1 min-w-0 lg:max-w-[400px]">
                  <SearchBar onSearch={setSearchQuery} placeholder="Search..." />
                </div>
                {allPeople.length > 0 && (
                  <div
                    className="hidden lg:flex items-center gap-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ml-auto shrink-0"
                    data-testid="approval-leaderboard-column-header"
                  >
                    <div className="text-right w-[100px]">Vote Count</div>
                    <div className="text-right w-[120px]">Approval</div>
                    <div className="text-right w-[120px]">Trend Score</div>
                    <div className="flex justify-end w-[88px]">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 min-h-9 w-auto shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                        aria-label="About approval rating and Rate on the leaderboard"
                        data-testid="button-approval-your-vote-info"
                        onClick={() => setVoteLeaderboardInfoOpen(true)}
                      >
                        Your Vote
                      </Button>
                    </div>
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="lg:hidden h-9 min-h-9 w-auto shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  aria-label="About approval rating and Rate on the leaderboard"
                  data-testid="label-mobile-approval-your-vote"
                  onClick={() => setVoteLeaderboardInfoOpen(true)}
                >
                  Your Vote
                </Button>
              </div>
              {hasActiveFilters && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Active filters:</span>
                  {searchQuery && (
                    <Badge variant="secondary" className="gap-1">
                      Search: {searchQuery}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setSearchQuery("")} />
                    </Badge>
                  )}
                  {category !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      Category: {activeCategoryLabel}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setCategory("all")} />
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-6 text-xs">
                    Clear all
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <CardContent className="p-0">
          {isLoading && allPeople.length === 0 ? (
            <div className="p-12 text-center">
              <Loader2 className="h-6 w-6 text-muted-foreground/50 mx-auto animate-spin" />
              <p className="mt-3 text-sm text-muted-foreground">Loading approval leaderboard…</p>
            </div>
          ) : (
            <>
              {allPeople.length === 0 && !isLoading && (
                <div className="p-8 text-center">
                  <p className="text-muted-foreground mb-3">
                    {searchQuery ? "No results found" : "No results found for current filters"}
                  </p>
                  {searchQuery && (
                    <Link href="/vote?section=induction">
                      <Button variant="outline" size="sm" data-testid="button-view-induction-list">
                        <Users className="h-4 w-4 mr-2" />
                        View Induction List
                      </Button>
                    </Link>
                  )}
                </div>
              )}

              {allPeople.map((person) => (
                <LeaderboardRow
                  key={person.id}
                  person={person}
                  activeTab="approval"
                  onOpenInsight={() => handleRowOpenInsight(person)}
                  onVoteClick={() => handleVoteClick(person.id)}
                />
              ))}

              {hasNextPage && (
                <div
                  id="approval-infinite-sentinel"
                  className="p-6 border-t text-center"
                  data-testid="approval-infinite-scroll-trigger"
                >
                  {isFetchingNextPage ? (
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading more...</span>
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-sm">
                      Showing {allPeople.length} of {totalCount}
                    </div>
                  )}
                </div>
              )}

              {!hasNextPage && allPeople.length > 0 && (
                <div className="p-4 border-t text-center text-muted-foreground text-sm space-y-2">
                  <p>Showing all {allPeople.length} results</p>
                  <p>
                    Don&apos;t see who you&apos;re looking for? Vote them onto the leaderboard via the{" "}
                    <Link href="/vote/induction" className="text-cyan-600 dark:text-cyan-400 hover:underline font-medium">
                      Induction Queue
                    </Link>
                    {" "}&mdash; the top candidate gets inducted every week.
                  </p>
                </div>
              )}

              {allPeople.length === 0 && !isLoading && !searchQuery && category === "all" && (
                <div className="p-12 text-center">
                  <RefreshCw className="h-6 w-6 text-muted-foreground/50 mx-auto animate-spin" />
                  <p className="text-muted-foreground font-medium mt-3">Leaderboard is updating...</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Data refreshes automatically. Check back shortly.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {isMobile ? (
        <Drawer open={voteLeaderboardInfoOpen} onOpenChange={setVoteLeaderboardInfoOpen}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader className="space-y-1.5 text-left">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5 shrink-0 text-cyan-500" aria-hidden />
                <DrawerTitle>Your vote on the leaderboard</DrawerTitle>
              </div>
              <DrawerDescription className="text-sm text-muted-foreground">
                How approval works here, plus jump to a section on Vote.
              </DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-6 pt-0">
              <ApprovalInfoBody onNavigateLink={() => setVoteLeaderboardInfoOpen(false)} />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={voteLeaderboardInfoOpen} onOpenChange={setVoteLeaderboardInfoOpen}>
          <DialogContent className={cn("flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-md")}>
            <DialogHeader className="shrink-0 space-y-1.5 text-left">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5 shrink-0 text-cyan-500" aria-hidden />
                <DialogTitle>Your vote on the leaderboard</DialogTitle>
              </div>
              <DialogDescription className="text-sm text-muted-foreground">
                How approval works here, plus jump to a section on Vote.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-2">
              <ApprovalInfoBody onNavigateLink={() => setVoteLeaderboardInfoOpen(false)} />
            </div>
          </DialogContent>
        </Dialog>
      )}

      <VotingModal
        open={votingModalOpen}
        onOpenChange={setVotingModalOpen}
        initialPersonId={votingPersonId}
        peopleList={allPeople}
      />
    </>
  );
}
