import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/PersonAvatar";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { Users, Loader2, BarChart2, ChevronRight } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getRatingTileColor } from "@/lib/ratingColors";
import { useAnonBudget, applyBudgetFromVoteResponse } from "@/hooks/useAnonBudget";
import { checkVoteGate } from "@/lib/voteGate";
import { isBudgetExhaustedVoteError, parseVoteError } from "@/lib/voteErrors";
import { navigateToLogin } from "@/lib/authReturn";
import { toast } from "sonner";
import { showVoteToast } from "@/lib/vote-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation } from "wouter";
import { trackVoteCast } from "@/lib/funnelTelemetry";

const ZONE_LABELS = ["Hate", "Dislike", "Neutral", "Like", "Love"] as const;
const RATING_COLORS = [1, 2, 3, 4, 5].map((r) => getRatingTileColor(r));

export interface OverallRatingPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  fameIndex: number | null;
  trendScore: number;
  isInduction?: boolean;
  approvalAvgRating?: number | null;
  approvalPct?: number | null;
  approvalVotesCount?: number | null;
  userApprovalRating?: number | null;
  ratingDistribution?: number[];
}

export interface OverallRatingCardProps {
  person: OverallRatingPerson;
  onVisitProfile?: () => void;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onBrowseFullScreen?: () => void;
  categoryMenuDisabled?: boolean;
}

export function OverallRatingCard({
  person,
  onVisitProfile,
  onFilterCategory,
  categoryRaceMap,
  onBrowseFullScreen,
  leaderboardCategories,
  categoryMenuDisabled = false,
}: OverallRatingCardProps) {
  const [submittedRating, setSubmittedRating] = useState<number | null>(
    person.userApprovalRating ?? null,
  );
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const budget = useAnonBudget();

  // Mirror server state across card instances (grid / snap / overlay / profile
  // widget): when a refetch delivers a new userApprovalRating, adopt it. Only
  // reacts to prop *changes* so the local "Change" flow isn't clobbered on
  // unrelated re-renders.
  const prevUserRatingRef = useRef<number | null>(person.userApprovalRating ?? null);
  useEffect(() => {
    const incoming = person.userApprovalRating ?? null;
    if (prevUserRatingRef.current !== incoming) {
      prevUserRatingRef.current = incoming;
      setSubmittedRating(incoming);
      setIsChanging(false);
    }
  }, [person.userApprovalRating]);

  // Anon (and pre-refetch) fallback: the profile widget persists the last
  // submitted rating in localStorage under this same key.
  useEffect(() => {
    if (person.userApprovalRating != null) return;
    try {
      const saved = localStorage.getItem(`sentiment-vote-${person.id}`);
      if (saved) {
        const n = parseInt(saved, 10);
        if (n >= 1 && n <= 5) setSubmittedRating(n);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id, user?.id]);

  // Same-page sync with the profile widget / other card instances.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.personId !== person.id) return;
      const v = detail.value;
      if (v != null && v >= 1 && v <= 5) {
        setSubmittedRating(v);
        setIsChanging(false);
      } else if (v == null) {
        setSubmittedRating(null);
      }
    };
    window.addEventListener("sentiment-vote-updated", handler);
    return () => window.removeEventListener("sentiment-vote-updated", handler);
  }, [person.id]);

  // Community distribution from the list payload. If the server hasn't seen
  // any votes yet but the user just voted, bump locally so the results view
  // isn't empty while the list refetches.
  const counts = [...(person.ratingDistribution?.length === 5 ? person.ratingDistribution : [0, 0, 0, 0, 0])];
  const serverTotal = counts.reduce((a, b) => a + b, 0);
  if (submittedRating != null && serverTotal === 0) {
    counts[submittedRating - 1] += 1;
  }
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const avgRating = totalVotes > 0
    ? counts.reduce((sum, c, i) => sum + c * (i + 1), 0) / totalVotes
    : null;
  const pcts = counts.map((c) => (totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0));

  const ratingMutation = useMutation({
    mutationFn: async ({ rating }: { rating: number }) => {
      const res = await apiRequest("POST", `/api/celebrity/${person.id}/approval-rating`, { rating });
      return res.json();
    },
    onMutate: ({ rating }) => {
      const voteStorageKey = `sentiment-vote-${person.id}`;
      const snapshot = {
        previousSubmitted: submittedRating,
        previousChanging: isChanging,
        previousStorage: ((): string | null => {
          try { return localStorage.getItem(voteStorageKey); } catch { return null; }
        })(),
      };
      setSubmittedRating(rating);
      setIsChanging(false);
      try {
        localStorage.setItem(voteStorageKey, String(rating));
        localStorage.setItem("authoridex-has-ever-voted", "1");
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent("authoridex-ever-voted"));
      window.dispatchEvent(
        new CustomEvent("sentiment-vote-updated", {
          detail: { personId: person.id, value: rating },
        }),
      );
      showVoteToast("rating", "Vote recorded!", {
        description: `You rated ${person.name} ${rating}/5 – ${ZONE_LABELS[rating - 1]}.`,
      });
      return snapshot;
    },
    onSuccess: async (data) => {
      applyBudgetFromVoteResponse(queryClient, data);
      trackVoteCast("celebrity_person", { kind: "overall_rating" });
      queryClient.invalidateQueries({ queryKey: ["/api/celebrity", person.id, "approval-rating"] });
      queryClient.invalidateQueries({ queryKey: ["/api/celebrity", person.id, "sentiment-stats"] });
      queryClient.invalidateQueries({ queryKey: [`/api/trending/${person.id}`] });
      // Leaderboard + overall-ratings lists are queried under literal string
      // keys with varying params — prefix-match so every instance refetches.
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0].startsWith("/api/leaderboard") ||
            q.queryKey[0].startsWith("/api/vote/overall-ratings")),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
    },
    onError: (error: any, variables, context) => {
      if (context) {
        setSubmittedRating(context.previousSubmitted);
        setIsChanging(context.previousChanging);
        try {
          const voteStorageKey = `sentiment-vote-${person.id}`;
          if (context.previousStorage === null) localStorage.removeItem(voteStorageKey);
          else localStorage.setItem(voteStorageKey, context.previousStorage);
        } catch {
          /* ignore */
        }
        window.dispatchEvent(
          new CustomEvent("sentiment-vote-updated", {
            detail: { personId: person.id, value: context.previousSubmitted },
          }),
        );
      }

      if (isBudgetExhaustedVoteError(error)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          resumeAction: {
            surfaceType: "celebrity_person",
            targetId: person.id,
            cardRoute: window.location.pathname,
            pendingVote: { rating: variables.rating },
          },
        });
        return;
      }

      const parsed = parseVoteError(error);
      toast.error(parsed.retryAfter ? "Slow down" : "Couldn't save your vote", {
        description: parsed.message && parsed.message.length < 160
          ? parsed.message
          : "Please check your connection and try again.",
      });
    },
  });

  const isPending = ratingMutation.isPending;

  const handleSubmit = () => {
    if (!selectedRating || isPending) return;
    const isUpsert = !!user && person.userApprovalRating != null;
    const decision = checkVoteGate(budget, "celebrity_person", person.id, isUpsert);
    if (!decision.proceed) {
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        resumeAction: {
          ...decision.resumeAction,
          cardRoute: window.location.pathname,
          pendingVote: { rating: selectedRating },
        },
      });
      return;
    }
    ratingMutation.mutate({ rating: selectedRating });
  };

  const handleChangeVote = () => {
    setSelectedRating(submittedRating);
    setIsChanging(true);
  };

  const showResults = submittedRating != null && !isChanging;
  const firstName = person.name.split(" ")[0];
  const submittedColor = submittedRating != null ? RATING_COLORS[submittedRating - 1] : undefined;
  const avgColor = avgRating != null ? RATING_COLORS[Math.round(avgRating) - 1] : undefined;

  return (
    <div className="hub-card-slot relative h-full">
    <Card
      className={`hub-card-hover lb-row-neutral relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 ${showResults ? "max-md:pb-2.5 md:pb-[14px]" : ""} bg-card/80 backdrop-blur-sm h-full min-h-[340px] md:min-h-0 flex flex-col shadow-none md:shadow-sm rounded-[12px] md:rounded-xl`}
      data-testid={`card-overall-rating-${person.id}`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
          <span className={showResults ? "" : "text-slate-600"}>
            {showResults ? `${totalVotes.toLocaleString("en-US")} votes` : "Votes"}
          </span>
        </div>
        {person.category && (
          <InteractiveCategoryPill
            category={person.category}
            onFilter={() => onFilterCategory?.(person.category!)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/vote/all-ratings?focus=${encodeURIComponent(person.id)}`}
            detailLabel="See How They Compare"
            onBrowseFullScreen={onBrowseFullScreen}
            reactionTarget={{ surfaceType: "value_person", targetId: String(person.id) }}
            menuDisabled={categoryMenuDisabled}
            data-testid={`badge-category-${person.id}`}
          />
        )}
      </div>

      <div
        className="flex items-start gap-3 md:gap-3 mb-2 cursor-pointer group"
        onClick={onVisitProfile}
      >
        <PersonAvatar
          name={person.name}
          avatar={person.avatar}
          className="h-20 w-20 md:h-16 md:w-16"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-bold text-xl md:text-lg leading-tight group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
            {showResults ? person.name : <>Rate {person.name}</>}
          </h3>
          {!showResults ? (
            <p className="text-[15px] md:text-sm text-muted-foreground mt-1 md:mt-0.5">
              How do you feel about {firstName}?
            </p>
          ) : (
            <>
              {person.fameIndex != null && !person.isInduction && (
                <p className="text-[15px] md:text-sm text-muted-foreground mt-1 md:mt-0.5">
                  Trend Score: <span className="font-mono text-foreground">{(person.fameIndex ?? 0).toLocaleString("en-US")}</span>
                </p>
              )}
              {avgRating != null && (
                <p className="text-sm md:text-xs text-muted-foreground mt-0.5">
                  <span style={{ color: avgColor }}>{avgRating.toFixed(1)}</span>
                  <span className="text-white">/5</span> community rating
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {!showResults ? (
        <div className="flex flex-col gap-3 mt-auto">
          <div className="grid grid-cols-5 gap-1 md:gap-1.5">
            {ZONE_LABELS.map((label, index) => {
              const isActive = selectedRating === index + 1;
              const color = RATING_COLORS[index];
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedRating(index + 1)}
                  disabled={isPending}
                  className={`relative py-1.5 rounded-md border text-[10px] sm:text-[11px] font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    isActive
                      ? "bg-card text-foreground scale-[1.05]"
                      : "bg-transparent text-muted-foreground border-border/40 hover:border-border/70"
                  }`}
                  style={isActive ? { borderColor: `${color}80`, boxShadow: `0 0 4px ${color}15` } : undefined}
                  data-testid={`button-rate-${index + 1}-${person.id}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-5 gap-1 md:gap-1.5">
            {[1, 2, 3, 4, 5].map((value) => {
              const color = RATING_COLORS[value - 1];
              const isActive = selectedRating === value;
              const isFilled = selectedRating !== null && value <= selectedRating;
              return (
                <div
                  key={value}
                  className="flex flex-col items-center cursor-pointer outline-none"
                  onClick={() => !isPending && setSelectedRating(value)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Select ${value} out of 5 - ${ZONE_LABELS[value - 1]}`}
                  data-testid={`segment-${value}-${person.id}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (!isPending) setSelectedRating(value);
                    }
                  }}
                >
                  <div className="relative w-full h-5 md:h-4 flex items-center justify-center">
                    <div
                      className={`absolute inset-0 rounded-full transition-all duration-200 ${isActive ? "scale-y-110" : ""}`}
                      style={{
                        backgroundColor: color,
                        opacity: selectedRating === null ? 1 : isFilled ? 1 : 0.3,
                        boxShadow: isActive
                          ? `0 0 8px ${color}40`
                          : isFilled
                            ? `0 0 4px ${color}25`
                            : "none",
                      }}
                    />
                    {isActive && (
                      <div
                        className="relative z-10 pointer-events-none w-3.5 h-3.5 rounded-full"
                        style={{
                          backgroundColor: color,
                          border: "2.5px solid #ffffff",
                          boxShadow: `0 0 6px ${color}40, 0 2px 4px rgba(0,0,0,0.2)`,
                        }}
                      />
                    )}
                  </div>
                  <span
                    className={`mt-1 text-sm transition-all duration-200 ${
                      isActive ? "font-bold" : "font-medium text-muted-foreground"
                    }`}
                    style={isActive ? { color } : undefined}
                  >
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!selectedRating || isPending}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 border-blue-400/30 text-white shadow-lg shadow-blue-500/20"
            data-testid={`button-submit-rating-${person.id}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : selectedRating ? (
              "Submit Your Vote"
            ) : (
              "Select a Rating"
            )}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex justify-center md:flex-1 md:items-end">
            <Link
              href={`/vote/all-ratings?focus=${encodeURIComponent(person.id)}`}
              className="group inline-flex items-center gap-1.5 mb-2 translate-y-[5px] text-sm text-cyan-600 dark:text-cyan-400 transition-colors underline-offset-4 hover:underline"
              data-testid={`link-rating-compare-${person.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <BarChart2 className="h-4 w-4 shrink-0" aria-hidden />
              <span>See how {firstName} compares</span>
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
          <div className="mt-auto md:mt-0 flex flex-col gap-2 md:gap-1.5 -translate-y-[2px] md:translate-y-3">
            {ZONE_LABELS.map((zone, index) => {
              const color = RATING_COLORS[index];
              const isUserZone = submittedRating === index + 1;
              return (
                <div key={zone} className="flex items-center gap-2.5 md:gap-2" data-testid={`rating-bar-${index + 1}-${person.id}`}>
                  <span
                    className={`text-sm md:text-xs w-[3.75rem] md:w-14 shrink-0 ${isUserZone ? "font-bold" : "font-medium"}`}
                    style={{ color }}
                  >
                    {zone}
                  </span>
                  <div className="flex-1 h-4 md:h-3 bg-white/5 rounded-full overflow-hidden self-center">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pcts[index]}%`,
                        backgroundColor: color,
                        boxShadow: isUserZone ? `0 0 6px ${color}40` : undefined,
                      }}
                    />
                  </div>
                  <span className={`text-sm tabular-nums md:text-xs w-10 md:w-9 text-right ${isUserZone ? "font-bold text-foreground" : "font-medium text-muted-foreground"}`}>
                    {pcts[index]}%
                  </span>
                </div>
              );
            })}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-sm text-muted-foreground">
                You voted{" "}
                <span className="font-semibold" style={{ color: submittedColor }}>
                  {submittedRating}/5 – {submittedRating != null ? ZONE_LABELS[submittedRating - 1] : ""}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleChangeVote}
                className="text-xs text-muted-foreground"
                data-testid={`button-change-rating-${person.id}`}
              >
                Change
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
    </div>
  );
}
