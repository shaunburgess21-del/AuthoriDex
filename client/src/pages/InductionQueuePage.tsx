import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { showVoteToast } from "@/lib/vote-toast";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import { useAnonBudget, applyBudgetFromVoteResponse } from "@/hooks/useAnonBudget";
import { checkVoteGate } from "@/lib/voteGate";
import { isBudgetExhaustedVoteError } from "@/lib/voteErrors";
import { writeVoteHubReturnState } from "@/lib/voteListNavigation";
import { searchByName } from "@/lib/inductionSearch";
import { hapticSuccess } from "@/lib/haptic";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { useXpBurst } from "@/components/XpBurstProvider";
import { getMarketCategoryLabel } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { cn } from "@/lib/utils";
import { FILTER_ACTIVE_CHIP_VOTE, FILTER_INACTIVE_PILL_VOTE, CATEGORY_CHIP_RADIUS } from "@/lib/filterControlStyles";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Plus, Search, Trophy, UserPlus, Vote, X } from "lucide-react";
import { SuggestCandidateModal } from "@/components/suggest/SuggestCandidateModal";
import { CandidateSpotlight } from "@/components/induction/CandidateSpotlight";
import { CandidateTile } from "@/components/induction/CandidateTile";
import { InductionPodium } from "@/components/induction/InductionPodium";
import { InductionSearchResults, type LeaderboardMatch } from "@/components/induction/InductionSearchResults";
import type { InductionAPIResponse, RankedCandidate } from "@/components/induction/types";

const ALL_CATEGORIES = "all";
const INITIAL_GRID_COUNT = 30;
const GRID_PAGE_SIZE = 60;
const SEARCH_RESULT_LIMIT = 30;
const SPOTLIGHT_HISTORY_KEY = "induction-spotlight";
const CARD_HASH_PREFIX = "#induction-card-";

const HOW_IT_WORKS = [
  { icon: Search, title: "Find them", body: "Search the queue for someone you think belongs on VoxDex." },
  { icon: Vote, title: "Vote them up", body: "One vote per person. The more votes, the higher they climb." },
  {
    icon: Trophy,
    title: "Join the leaderboard",
    body: "Top-voted candidates are reviewed for induction onto the live leaderboard with tracked Trend Scores.",
  },
] as const;

type TrendingResponse = { data: LeaderboardMatch[] } | LeaderboardMatch[];

export default function InductionQueuePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();
  const { trigger: triggerXpBurst } = useXpBurst();
  const budget = useAnonBudget();
  const inputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState(() =>
    new URLSearchParams(window.location.search).get("search")?.trim() ?? "",
  );
  const deferredQuery = useDeferredValue(searchQuery);
  const trimmedQuery = deferredQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [gridCount, setGridCount] = useState(INITIAL_GRID_COUNT);
  const [activeIndex, setActiveIndex] = useState(0);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestPrefillName, setSuggestPrefillName] = useState("");
  // Kept after close (open: false) so the dialog's exit animation still has content.
  const [spotlight, setSpotlight] = useState<{ ids: string[]; index: number; open: boolean } | null>(null);
  const pendingNavRef = useRef<string | null>(null);
  // Read before the spotlight pushes entries of its own, which would otherwise
  // make a directly-opened page look like it has somewhere to go back to.
  const hadHistoryOnArrivalRef = useRef(window.history.length > 1);

  // Keep ?search= in sync so the view stays shareable and survives the
  // sign-in round trip.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get("search") ?? "";
    const next = searchQuery.trim();
    if (next === current) return;
    if (next) {
      url.searchParams.set("search", next);
    } else {
      url.searchParams.delete("search");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [searchQuery]);

  const { data: inductionData, isLoading, isError, refetch } = useQuery<InductionAPIResponse>({
    queryKey: ["/api/vote/induction"],
    staleTime: 60_000,
  });

  const { data: myVoteIds } = useQuery<string[]>({
    queryKey: ["/api/me/induction-votes"],
    enabled: isLoggedIn,
  });

  // Only needed to tell people "they're already on the leaderboard".
  const { data: trendingResponse } = useQuery<TrendingResponse>({
    queryKey: ["/api/trending"],
    enabled: trimmedQuery.length >= 2,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!isLoggedIn) {
      setVotedIds(new Set());
      return;
    }
    if (myVoteIds) setVotedIds(new Set(myVoteIds));
  }, [isLoggedIn, myVoteIds]);

  const ranked = useMemo<RankedCandidate[]>(() => {
    if (!inductionData?.data) return [];
    return [...inductionData.data]
      .sort((a, b) => b.seedVotes - a.seedVotes || a.displayName.localeCompare(b.displayName))
      .map((c, i) => ({ ...c, rank: i + 1 }));
  }, [inductionData]);

  const byId = useMemo(() => new Map(ranked.map((c) => [c.id, c])), [ranked]);
  const isVoted = useCallback((id: string) => votedIds.has(id), [votedIds]);
  const myVoteCount = useMemo(() => ranked.filter((c) => votedIds.has(c.id)).length, [ranked, votedIds]);

  // ── Search ────────────────────────────────────────────────────────────
  // Result order is frozen per query so a vote that bumps someone's rank
  // can't slide a different row under the user's finger.
  const searchOrderRef = useRef<{ query: string; order: Map<string, number> } | null>(null);
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    if (searchOrderRef.current?.query !== trimmedQuery) {
      searchOrderRef.current = { query: trimmedQuery, order: new Map(ranked.map((c, i) => [c.id, i])) };
    }
    const order = searchOrderRef.current.order;
    const stable = [...ranked].sort(
      (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    return searchByName(stable, trimmedQuery, (c) => c.displayName);
  }, [trimmedQuery, ranked]);

  const leaderboardMatches = useMemo(() => {
    if (trimmedQuery.length < 2 || !trendingResponse) return [];
    const people = Array.isArray(trendingResponse) ? trendingResponse : trendingResponse.data ?? [];
    return searchByName(people, trimmedQuery, (p) => p.name).slice(0, 4);
  }, [trimmedQuery, trendingResponse]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery]);

  // ── Browse ────────────────────────────────────────────────────────────
  // Chips come from the categories candidates actually carry ("Film & TV",
  // "Media & Podcast", …), biggest first — not every one has a canonical id.
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of ranked) {
      if (c.category) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: getMarketCategoryLabel(value), count }));
  }, [ranked]);

  const browseList = useMemo(() => {
    if (categoryFilter === ALL_CATEGORIES) return ranked;
    return ranked.filter((c) => c.category === categoryFilter);
  }, [ranked, categoryFilter]);

  const activeCategoryLabel = categoryOptions.find((c) => c.value === categoryFilter)?.label ?? "All";
  const showPodium = browseList.length >= 3;
  const gridSource = showPodium ? browseList.slice(3) : browseList;
  const gridOffset = showPodium ? 3 : 0;
  const gridShown = gridSource.slice(0, gridCount);

  const selectCategory = (value: string) => {
    setCategoryFilter(value);
    setGridCount(INITIAL_GRID_COUNT);
  };

  // ── Spotlight (pushes a history entry so Android/browser back closes it) ──
  const hideSpotlight = useCallback(() => {
    setSpotlight((s) => (s ? { ...s, open: false } : s));
  }, []);

  const openSpotlight = useCallback((list: RankedCandidate[], index: number) => {
    if (!list[index]) return;
    setSpotlight({ ids: list.map((c) => c.id), index, open: true });
    window.history.pushState({ overlay: SPOTLIGHT_HISTORY_KEY }, "");
  }, []);

  const closeSpotlight = useCallback(() => {
    if (window.history.state?.overlay === SPOTLIGHT_HISTORY_KEY) {
      window.history.back();
    } else {
      hideSpotlight();
    }
  }, [hideSpotlight]);

  const viewProfileFromSpotlight = useCallback(
    (personId: string) => {
      const target = `/person/${personId}`;
      if (window.history.state?.overlay === SPOTLIGHT_HISTORY_KEY) {
        pendingNavRef.current = target;
        window.history.back();
      } else {
        hideSpotlight();
        setLocation(target);
      }
    },
    [hideSpotlight, setLocation],
  );

  useEffect(() => {
    const onPop = () => {
      if (window.history.state?.overlay !== SPOTLIGHT_HISTORY_KEY) hideSpotlight();
      const pending = pendingNavRef.current;
      if (pending) {
        pendingNavRef.current = null;
        setLocation(pending);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [hideSpotlight, setLocation]);

  const spotlightSequence = useMemo(
    () => (spotlight ? spotlight.ids.map((id) => byId.get(id)).filter((c): c is RankedCandidate => !!c) : []),
    [spotlight, byId],
  );

  // Vote hub cards deep-link here as /vote/induction#induction-card-<id>.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || ranked.length === 0) return;
    deepLinkHandledRef.current = true;
    const hash = window.location.hash;
    if (!hash.startsWith(CARD_HASH_PREFIX)) return;
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
    const index = ranked.findIndex((c) => c.id === hash.slice(CARD_HASH_PREFIX.length));
    if (index >= 0) openSpotlight(ranked, index);
  }, [ranked, openSpotlight]);

  // Desktop: land with the cursor in the search box. Skipped on touch so the
  // keyboard doesn't cover the page on arrival.
  useEffect(() => {
    if (window.location.hash.startsWith(CARD_HASH_PREFIX)) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // ── Suggest ───────────────────────────────────────────────────────────
  const openSuggest = useCallback(
    (prefillName = "") => {
      if (!isLoggedIn) {
        toast("Sign in to suggest someone", {
          description: "Create a free account to nominate people for the Induction Queue.",
          action: {
            label: "Sign in",
            onClick: () => {
              // Return URL carries ?suggest=1 so the form reopens after sign-in.
              const url = new URL(window.location.href);
              url.searchParams.set("suggest", "1");
              window.history.replaceState(window.history.state, "", url.toString());
              navigateToLogin(setLocation);
            },
          },
        });
        return;
      }
      setSuggestPrefillName(prefillName);
      setSuggestOpen(true);
    },
    [isLoggedIn, setLocation],
  );

  useEffect(() => {
    if (!isLoggedIn) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("suggest") !== "1") return;
    url.searchParams.delete("suggest");
    window.history.replaceState(window.history.state, "", url.toString());
    setSuggestPrefillName(url.searchParams.get("search")?.trim() ?? "");
    setSuggestOpen(true);
  }, [isLoggedIn]);

  // ── Voting ────────────────────────────────────────────────────────────
  const voteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/vote/induction/${id}/vote`);
      return res.json();
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["/api/vote/induction"] });
      queryClient.setQueryData<InductionAPIResponse>(["/api/vote/induction"], (prev) =>
        prev
          ? { ...prev, data: prev.data.map((c) => (c.id === id ? { ...c, seedVotes: c.seedVotes + 1 } : c)) }
          : prev,
      );
    },
    onSuccess: (data) => {
      hapticSuccess();
      // Phase 4 — sync the anon-budget cache from the server-authoritative
      // snapshot in the response.
      applyBudgetFromVoteResponse(queryClient, data);
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
    },
    onError: (err: any, id: string) => {
      setVotedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (isUnauthorizedApiError(err)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      } else if (isBudgetExhaustedVoteError(err)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          resumeAction: {
            surfaceType: "induction",
            targetId: id,
            cardRoute: window.location.pathname,
            pendingVote: { intent: "induct" },
          },
        });
      } else {
        toast.error("Vote failed", { description: err.message || "Something went wrong" });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/induction-votes"] });
    },
  });

  /** `silent` skips the success toast — inside the spotlight it would cover the close button. */
  const handleVote = (id: string, opts?: { silent?: boolean }) => {
    if (votedIds.has(id)) return;
    // Phase 4 — anon-budget gate. isUpsert hardcoded false: votedIds.has()
    // above filters re-votes for authed; anon users start with empty votedIds
    // (server-side anon induction history not surfaced to client until signup).
    const decision = checkVoteGate(budget, "induction", id, false);
    if (!decision.proceed) {
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        resumeAction: {
          ...decision.resumeAction,
          cardRoute: window.location.pathname,
          pendingVote: { intent: "induct" },
        },
      });
      return;
    }
    setVotedIds((prev) => new Set(prev).add(id));
    if (!opts?.silent) {
      showVoteToast("induction", "Vote recorded!", { description: "Your Induction Queue vote has been counted." });
    }
    voteMutation.mutate(id);
  };

  const handleBack = () => {
    if (hadHistoryOnArrivalRef.current) {
      window.history.back();
      return;
    }
    writeVoteHubReturnState({ activeSection: "All", anchorHashId: "vote-induction" });
    setLocation("/vote");
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && searchQuery) {
      e.preventDefault();
      setSearchQuery("");
      return;
    }
    if (!isSearching) return;
    const lastIndex = Math.min(searchResults.length, SEARCH_RESULT_LIMIT) - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(lastIndex, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchResults.length > 0) {
        openSpotlight(searchResults, Math.min(activeIndex, lastIndex));
      } else if (leaderboardMatches.length > 0) {
        setLocation(`/person/${leaderboardMatches[0].id}`);
      } else {
        openSuggest(searchQuery.trim());
      }
    }
  };

  const header = (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Link href="/">
            <VoxDexLogo size={24} />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openSuggest(searchQuery.trim())}
            className="hidden items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-1.5 text-sm font-medium text-cyan-600 transition-colors hover:bg-cyan-500/25 sm:flex dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-400 dark:hover:bg-cyan-500/20"
            data-testid="button-suggest-induction-header"
          >
            <Plus className="h-4 w-4" />
            Suggest
          </button>
          <HeaderUserActions />
        </div>
      </div>
    </header>
  );

  if (isLoading && inductionData === undefined) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <main className="mx-auto max-w-5xl px-4 py-8 md:py-12">
          <Skeleton className="mb-3 h-4 w-32" />
          <Skeleton className="mb-6 h-10 w-full max-w-md" />
          <Skeleton className="mb-10 h-14 w-full rounded-2xl" />
          <Skeleton className="mb-8 h-56 w-full rounded-2xl" />
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-xl" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {header}

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-8 md:pb-16 md:pt-12">
        {/* Hero + search */}
        <section className="relative mb-8">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl"
            aria-hidden
          />
          <p className="relative mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">
            Induction Queue
          </p>
          <h1 className="relative font-serif text-[28px] font-bold leading-tight tracking-tight md:text-4xl">
            Who&apos;s missing from the leaderboard?
          </h1>
          <p className="relative mt-2 text-sm text-muted-foreground md:text-base">
            Find someone and vote them in. Can&apos;t find them? Suggest them.
          </p>

          <div className="relative mt-6">
            <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={ranked.length > 0 ? `Search ${ranked.length} candidates…` : "Search candidates…"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label="Search the Induction Queue"
              className="h-14 rounded-2xl border-border/70 bg-card/70 pl-12 pr-12 text-base shadow-lg md:text-base shadow-black/5 backdrop-blur focus-visible:border-cyan-500/60 focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:hidden"
              data-testid="input-induction-search"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="relative mt-3 flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            <span>
              {ranked.length} in the queue
              {myVoteCount > 0 && (
                <>
                  {" · "}
                  <span className="text-[#00C853]">{myVoteCount} voted by you</span>
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => openSuggest(searchQuery.trim())}
              className="inline-flex items-center gap-1 font-medium text-cyan-600 hover:underline dark:text-cyan-400"
              data-testid="button-suggest-induction"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Suggest someone
            </button>
          </div>
        </section>

        <AnimatePresence mode="wait" initial={false}>
          {isSearching ? (
            <motion.div
              key="search"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <InductionSearchResults
                query={trimmedQuery}
                results={searchResults}
                limit={SEARCH_RESULT_LIMIT}
                leaderboardMatches={leaderboardMatches}
                activeIndex={activeIndex}
                isVoted={isVoted}
                onOpen={(index) => openSpotlight(searchResults, index)}
                onVote={handleVote}
                onSuggest={() => openSuggest(searchQuery.trim())}
              />
            </motion.div>
          ) : (
            <motion.div
              key="browse"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="space-y-8"
            >
              {categoryOptions.length > 1 && (
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide">
                  {[{ value: ALL_CATEGORIES, label: "All", count: ranked.length }, ...categoryOptions].map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => selectCategory(cat.value)}
                      aria-pressed={categoryFilter === cat.value}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 whitespace-nowrap border px-3 py-1.5 text-xs font-medium transition-all",
                        CATEGORY_CHIP_RADIUS,
                        categoryFilter === cat.value ? FILTER_ACTIVE_CHIP_VOTE : FILTER_INACTIVE_PILL_VOTE,
                      )}
                      data-testid={`chip-induction-category-${cat.value}`}
                    >
                      {cat.label}
                      <span className="tabular-nums opacity-60">{cat.count}</span>
                    </button>
                  ))}
                </div>
              )}

              {showPodium && (
                <InductionPodium
                  leaders={browseList.slice(0, 3)}
                  label={categoryFilter === ALL_CATEGORIES ? "Whole queue" : activeCategoryLabel}
                  isVoted={isVoted}
                  onOpen={(position) => openSpotlight(browseList, position)}
                />
              )}

              {gridSource.length > 0 && (
                <section>
                  <div className="mb-4 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold">
                      {showPodium ? "Chasing the lead" : "In the queue"}
                    </h2>
                    <span className="text-xs text-muted-foreground">Tap anyone to vote</span>
                  </div>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                    {gridShown.map((candidate, i) => (
                      <CandidateTile
                        key={candidate.id}
                        candidate={candidate}
                        voted={votedIds.has(candidate.id)}
                        onOpen={() => openSpotlight(browseList, i + gridOffset)}
                      />
                    ))}
                  </div>
                  {gridSource.length > gridShown.length && (
                    <div className="mt-8 flex justify-center">
                      <Button
                        variant="outline"
                        onClick={() => setGridCount((n) => n + GRID_PAGE_SIZE)}
                        className="rounded-full px-6"
                        data-testid="button-induction-show-more"
                      >
                        Show more · {gridSource.length - gridShown.length} left
                      </Button>
                    </div>
                  )}
                </section>
              )}

              {isError && ranked.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
                  <p className="text-sm text-muted-foreground">We couldn&apos;t load the queue.</p>
                  <Button variant="outline" onClick={() => refetch()} className="mt-4">
                    Try again
                  </Button>
                </div>
              )}

              {!isError && ranked.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
                  <p className="text-sm text-muted-foreground">The queue is empty right now.</p>
                  <Button onClick={() => openSuggest()} className="mt-4 bg-cyan-500 text-white hover:bg-cyan-400">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Suggest the first candidate
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {!isSearching && (
          <section className="mt-14 grid gap-3 sm:grid-cols-3">
            {HOW_IT_WORKS.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="flex gap-3 rounded-xl border border-border/40 bg-card/30 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                  <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i + 1}</span>
                    {title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      <CandidateSpotlight
        open={!!spotlight?.open && spotlightSequence.length > 0}
        onClose={closeSpotlight}
        sequence={spotlightSequence}
        index={Math.min(spotlight?.index ?? 0, Math.max(spotlightSequence.length - 1, 0))}
        onIndexChange={(index) => setSpotlight((s) => (s ? { ...s, index } : s))}
        ranked={ranked}
        isVoted={isVoted}
        onVote={(id) => handleVote(id, { silent: true })}
        onViewProfile={viewProfileFromSpotlight}
      />

      <SuggestCandidateModal
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        initialDisplayName={suggestPrefillName}
        onSubmitted={() => queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] })}
      />
    </div>
  );
}
