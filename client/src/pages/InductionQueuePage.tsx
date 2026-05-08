import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import { useAnonBudget, applyBudgetFromVoteResponse } from "@/hooks/useAnonBudget";
import { checkVoteGate } from "@/lib/voteGate";
import { isBudgetExhaustedVoteError } from "@/lib/voteErrors";
import { goBack } from "@/lib/goBack";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { useXpBurst } from "@/components/XpBurstProvider";
import { PersonAvatar } from "@/components/PersonAvatar";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { normalizeMarketCategory, type FilterCategory, CATEGORIES_WITH_FILTERS } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Crown,
  Vote,
  Check,
  Users,
  BarChart3,
  Trophy,
  Search,
  Info,
  TrendingUp,
  Loader2,
} from "lucide-react";

interface InductionCandidate {
  id: string;
  displayName: string;
  category: string;
  imageSlug: string | null;
  seedVotes: number;
  wikiSlug: string | null;
  isActive: boolean;
}

interface InductionAPIResponse {
  data: InductionCandidate[];
  totalCount: number;
}

function getRankStyle(rank: number) {
  if (rank === 1) return "bg-yellow-500/20 dark:bg-yellow-500/15 border-yellow-500/50 dark:border-yellow-500/40 text-yellow-500 dark:text-yellow-300";
  if (rank === 2) return "bg-slate-400/10 border-slate-400/30 text-slate-500 dark:text-slate-300";
  if (rank === 3) return "bg-orange-500/15 dark:bg-orange-500/10 border-orange-500/40 dark:border-orange-500/30 text-orange-500 dark:text-orange-300";
  return "bg-slate-800/40 border-slate-700/30 text-slate-600 dark:text-slate-400";
}

function getRankBg(rank: number) {
  if (rank === 1) return "from-yellow-500/5 via-transparent to-transparent";
  if (rank === 2) return "from-slate-400/5 via-transparent to-transparent";
  if (rank === 3) return "from-orange-500/5 via-transparent to-transparent";
  return "";
}

const FILTER_CATEGORIES = CATEGORIES_WITH_FILTERS
  .filter(c => c.id !== "favorites" && c.id !== "trending")
  .map(c => ({ value: c.id, label: c.label }));

export default function InductionQueuePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, isLoggedIn } = useAuth();
  const { trigger: triggerXpBurst } = useXpBurst();
  const raceMap = useCategoryRaceMap();
  const leaderboardCats = useLeaderboardCategories();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [showVoteAnim, setShowVoteAnim] = useState<string | null>(null);
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: inductionData, isLoading } = useQuery<InductionAPIResponse>({
    queryKey: ["/api/vote/induction"],
    staleTime: 60_000,
  });

  const { data: myVoteIds } = useQuery<string[]>({
    queryKey: ["/api/me/induction-votes"],
    enabled: isLoggedIn,
  });

  useEffect(() => {
    if (!isLoggedIn) {
      setVotedIds(new Set());
      return;
    }
    if (myVoteIds) setVotedIds(new Set(myVoteIds));
  }, [isLoggedIn, myVoteIds]);

  useEffect(() => {
    return () => { if (animRef.current) clearTimeout(animRef.current); };
  }, []);

  const budget = useAnonBudget();

  const voteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/vote/induction/${id}/vote`);
      return res.json();
    },
    onSuccess: (data) => {
      // Phase 4 — sync the anon-budget cache from the server-authoritative
      // snapshot in the response.
      applyBudgetFromVoteResponse(queryClient, data);
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/induction-votes"] });
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
  });

  const handleVote = (id: string) => {
    if (votedIds.has(id)) return;
    // Phase 4 — anon-budget gate. The pre-Stage-7 anon-block has been
    // removed; anon users with remaining budget hit the server. isUpsert
    // hardcoded false: votedIds.has() above filters re-votes for authed;
    // anon users start with empty votedIds (server-side anon induction
    // history not surfaced to client until signup).
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
    setShowVoteAnim(id);
    animRef.current = setTimeout(() => setShowVoteAnim(null), 800);
    voteMutation.mutate(id);
  };

  const candidates = useMemo(() => {
    if (!inductionData?.data) return [];
    return [...inductionData.data].sort((a, b) => b.seedVotes - a.seedVotes);
  }, [inductionData]);

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const matchesCat = categoryFilter === "all" || c.category?.toLowerCase() === categoryFilter.toLowerCase();
      const matchesSearch = !searchQuery || c.displayName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [candidates, categoryFilter, searchQuery]);

  const candidateRankById = useMemo(
    () => new Map(candidates.map((candidate, index) => [candidate.id, index + 1])),
    [candidates],
  );

  const maxVotes = candidates.length > 0 ? candidates[0].seedVotes : 1;
  const totalVotes = candidates.reduce((sum, c) => sum + c.seedVotes, 0);
  const uniqueCategories = new Set(candidates.map((c) => c.category));

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    candidates.forEach((c) => {
      map.set(c.category, (map.get(c.category) || 0) + c.seedVotes);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [candidates]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-700 dark:text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => goBack(setLocation, "/vote")} aria-label="Back to Vote">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link href="/">
              <VoxDexLogo size={24} />
            </Link>
          </div>
          <HeaderUserActions />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
        {/* Hero */}
        <div className="mb-8 md:mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/30 dark:border-cyan-500/20 flex items-center justify-center">
              <Vote className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-serif font-bold tracking-tight">Induction Queue</h1>
              <p className="text-sm text-muted-foreground">Vote for who joins the leaderboard next</p>
            </div>
          </div>
        </div>

        {/* Stats ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Card className="px-4 py-3 bg-gradient-to-br from-slate-900/60 to-slate-800/60 border-slate-700/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
              Candidates
            </div>
            <p className="text-xl font-bold tabular-nums">{candidates.length}</p>
          </Card>
          <Card className="px-4 py-3 bg-gradient-to-br from-slate-900/60 to-slate-800/60 border-slate-700/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
              Total Votes
            </div>
            <p className="text-xl font-bold tabular-nums">{totalVotes.toLocaleString("en-US")}</p>
          </Card>
          <Card className="px-4 py-3 bg-gradient-to-br from-slate-900/60 to-slate-800/60 border-slate-700/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <BarChart3 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
              Categories
            </div>
            <p className="text-xl font-bold tabular-nums">{uniqueCategories.size}</p>
          </Card>
          <Card className="px-4 py-3 bg-gradient-to-br from-slate-900/60 to-slate-800/60 border-slate-700/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Your Votes
            </div>
            <p className="text-xl font-bold tabular-nums">{votedIds.size}</p>
          </Card>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategoryFilter(cat.value)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  categoryFilter === cat.value
                    ? "bg-cyan-500/20 dark:bg-cyan-500/15 border-cyan-500/60 dark:border-cyan-500/50 text-cyan-600 dark:text-cyan-400"
                    : "bg-muted/30 border-border text-muted-foreground hover:border-cyan-500/40 dark:border-cyan-500/30"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="relative md:ml-auto md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search candidates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          <AnimatePresence mode="popLayout">
            {filteredCandidates.map((candidate, idx) => {
              const globalRank = candidateRankById.get(candidate.id) ?? idx + 1;
              const progressPct = maxVotes > 0 ? (candidate.seedVotes / maxVotes) * 100 : 0;
              const isVoted = votedIds.has(candidate.id);

              return (
                <motion.div
                  key={candidate.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.02 }}
                >
                  <Card className={`relative overflow-hidden border-slate-700/40 bg-gradient-to-br ${getRankBg(globalRank)} from-slate-900/80 via-slate-800/80 to-slate-900/80 hover:border-slate-600/60 transition-all group`}>
                    <AnimatePresence>
                      {showVoteAnim === candidate.id && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 z-10 pointer-events-none"
                        >
                          <motion.div
                            initial={{ x: "-100%" }}
                            animate={{ x: "200%" }}
                            transition={{ duration: 0.6, ease: "easeInOut" }}
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent skew-x-12"
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="p-5">
                      {/* Rank + Category */}
                      <div className="flex items-center justify-between mb-4">
                        <div className={`rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1.5 border ${getRankStyle(globalRank)}`}>
                          {globalRank === 1 && <Crown className="h-3 w-3" />}
                          #{globalRank}
                        </div>
                        <InteractiveCategoryPill
                          category={candidate.category}
                          onFilter={() => setCategoryFilter(candidate.category)}
                          leaderboardCategories={leaderboardCats}
                          detailHref="/vote/induction"
                          detailLabel="View Induction Queue"
                        />
                      </div>

                      {/* Avatar + name */}
                      <div className="flex flex-col items-center text-center mb-4">
                        <div className="relative mb-3">
                          <PersonAvatar
                            name={candidate.displayName}
                            imageSlug={candidate.imageSlug}
                            imageContext="induction"
                            className="h-28 w-28 md:h-24 md:w-24"
                          />
                          {isVoted && (
                            <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                              <Check className="h-3.5 w-3.5 text-white" />
                            </div>
                          )}
                        </div>
                        <h3 className="font-semibold text-base leading-tight">{candidate.displayName}</h3>
                      </div>

                      {/* Progress */}
                      <div className="mb-4">
                        <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${globalRank === 1 ? "bg-gradient-to-r from-yellow-500 to-yellow-400" : globalRank <= 3 ? "bg-gradient-to-r from-cyan-500 to-cyan-400" : "bg-cyan-500/60"}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${progressPct}%` }}
                            transition={{ duration: 0.6, delay: idx * 0.03 }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-xs text-muted-foreground">{candidate.seedVotes.toLocaleString("en-US")} votes</span>
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{Math.round(progressPct)}%</span>
                        </div>
                      </div>

                      {/* Vote button */}
                      {isVoted ? (
                        <Button
                          className="w-full bg-emerald-500/15 dark:bg-emerald-500/10 border border-emerald-500/30 dark:border-emerald-500/20 text-emerald-500 dark:text-emerald-300 hover:bg-emerald-500/25 dark:hover:bg-emerald-500/20"
                          disabled
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Voted
                        </Button>
                      ) : (
                        <button
                          onClick={() => handleVote(candidate.id)}
                          className="group w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-muted/40 border border-border text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white text-sm font-medium transition-all duration-300 hover:border-cyan-500/80 hover:bg-cyan-500/25 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/20 hover:text-cyan-600 dark:hover:text-cyan-400"
                        >
                          <Vote className="h-4 w-4 shrink-0" />
                          <span>Vote to Induct</span>
                        </button>
                      )}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {filteredCandidates.length === 0 && !isLoading && (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No candidates match your filters.</p>
          </div>
        )}

        {/* Category Breakdown + How It Works */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          {/* Category Breakdown */}
          <Card className="p-5 border-slate-700/40 bg-gradient-to-br from-slate-900/60 to-slate-800/60">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              Votes by Category
            </h3>
            <div className="space-y-3">
              {categoryBreakdown.map(([cat, votes]) => {
                const pct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{cat}</span>
                      <span className="font-medium tabular-nums">{votes.toLocaleString("en-US")}</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500/60 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* How It Works */}
          <Card className="p-5 border-slate-700/40 bg-gradient-to-br from-slate-900/60 to-slate-800/60">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
              <Info className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              How It Works
            </h3>
            <div className="space-y-4 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/30 dark:border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">1</span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Community Nominations</p>
                  <p className="text-xs mt-0.5">Candidates are nominated by the community and seeded with initial votes based on popularity.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/30 dark:border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">2</span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Vote for Your Picks</p>
                  <p className="text-xs mt-0.5">Cast your vote on any candidate you think deserves a spot on the official VoxDex leaderboard.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 border border-cyan-500/30 dark:border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">3</span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Leaderboard Entry</p>
                  <p className="text-xs mt-0.5">Top-voted candidates are reviewed and approved for induction into the live VoxDex leaderboard with tracked Trend Scores.</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Top 3 Podium (desktop only) */}
        {candidates.length >= 3 && (
          <Card className="hidden md:block p-6 border-slate-700/40 bg-gradient-to-br from-slate-900/60 to-slate-800/60 mb-10">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-6 justify-center">
              <Trophy className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              Current Leaders
            </h3>
            <div className="flex items-end justify-center gap-6">
              {/* 2nd place */}
              <div className="flex flex-col items-center">
                <PersonAvatar name={candidates[1].displayName} imageSlug={candidates[1].imageSlug} imageContext="induction" className="h-20 w-20 mb-2 ring-2 ring-slate-400/30" />
                <p className="font-medium text-sm mb-1">{candidates[1].displayName}</p>
                <Badge variant="outline" className="text-xs border-slate-500/50 dark:border-slate-400/40 text-slate-500 dark:text-slate-300">#2 · {candidates[1].seedVotes.toLocaleString("en-US")}</Badge>
                <div className="mt-2 w-20 h-16 rounded-t-lg bg-slate-400/10 border border-b-0 border-slate-400/20" />
              </div>
              {/* 1st place */}
              <div className="flex flex-col items-center">
                <Crown className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mb-1" />
                <PersonAvatar name={candidates[0].displayName} imageSlug={candidates[0].imageSlug} imageContext="induction" className="h-24 w-24 mb-2 ring-2 ring-yellow-500/40" />
                <p className="font-semibold text-base mb-1">{candidates[0].displayName}</p>
                <Badge variant="outline" className="text-xs border-yellow-500/50 dark:border-yellow-500/40 text-yellow-500 dark:text-yellow-300">#1 · {candidates[0].seedVotes.toLocaleString("en-US")}</Badge>
                <div className="mt-2 w-24 h-24 rounded-t-lg bg-yellow-500/15 dark:bg-yellow-500/10 border border-b-0 border-yellow-500/30 dark:border-yellow-500/20" />
              </div>
              {/* 3rd place */}
              <div className="flex flex-col items-center">
                <PersonAvatar name={candidates[2].displayName} imageSlug={candidates[2].imageSlug} imageContext="induction" className="h-18 w-18 mb-2 ring-2 ring-orange-500/30" />
                <p className="font-medium text-sm mb-1">{candidates[2].displayName}</p>
                <Badge variant="outline" className="text-xs border-orange-500/50 dark:border-orange-500/40 text-orange-500 dark:text-orange-300">#3 · {candidates[2].seedVotes.toLocaleString("en-US")}</Badge>
                <div className="mt-2 w-18 h-12 rounded-t-lg bg-orange-500/15 dark:bg-orange-500/10 border border-b-0 border-orange-500/30 dark:border-orange-500/20" />
              </div>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
