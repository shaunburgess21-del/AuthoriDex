import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/PersonAvatar";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { normalizeMarketCategory } from "@shared/constants";
import { ArrowUp, ArrowDown, Minus, Users, Loader2, BarChart2, ChevronRight } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import { toast } from "sonner";
import { showVoteToast } from "@/lib/vote-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation } from "wouter";
import { trackVoteCast } from "@/lib/funnelTelemetry";

type VoteType = 'underrated' | 'overrated' | 'fairly_rated';

export interface ValueVotePerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  fameIndex: number | null;
  trendScore: number;
  approvalPct?: number | null;
  approvalAvgRating?: number | null;
  underratedPct?: number | null;
  overratedPct?: number | null;
  fairlyRatedPct?: number | null;
  underratedCount?: number | null;
  overratedCount?: number | null;
  fairlyRatedCount?: number | null;
  userValueVote?: VoteType | null;
}

export interface UnderratedOverratedCardProps {
  person: ValueVotePerson;
  onVisitProfile?: () => void;
  compact?: boolean;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onBrowseFullScreen?: () => void;
  categoryMenuDisabled?: boolean;
}

export function UnderratedOverratedCard({ 
  person, 
  onVisitProfile,
  compact = false,
  onFilterCategory,
  categoryRaceMap,
  onBrowseFullScreen,
  leaderboardCategories,
  categoryMenuDisabled = false,
}: UnderratedOverratedCardProps) {
  const [localVote, setLocalVote] = useState<VoteType | null>(
    person.userValueVote ?? null
  );
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  // Mirror server state across card instances (grid / snap / overlay): when the
  // list refetch delivers a new userValueVote, adopt it. Only reacts to prop
  // *changes* so the local "Change" flow (localVote=null while the prop still
  // holds the old vote) isn't clobbered on unrelated re-renders.
  const prevUserVoteRef = useRef<VoteType | null>(person.userValueVote ?? null);
  useEffect(() => {
    const incoming = person.userValueVote ?? null;
    if (prevUserVoteRef.current !== incoming) {
      prevUserVoteRef.current = incoming;
      setLocalVote(incoming);
    }
  }, [person.userValueVote]);

  const totalVotes = (person.underratedCount ?? 0) + (person.overratedCount ?? 0) + (person.fairlyRatedCount ?? 0);
  const underratedPct = person.underratedPct ?? 33;
  const overratedPct = person.overratedPct ?? 33;
  const fairlyRatedPct = person.fairlyRatedPct ?? 34;

  const valueVoteMutation = useMutation({
    mutationFn: async (voteType: VoteType) => {
      return apiRequest('POST', `/api/celebrity/${person.id}/value-vote`, { vote: voteType });
    },
    onMutate: (voteType) => {
      setLocalVote(voteType);
      const label = voteType === 'underrated' ? 'Underrated' : voteType === 'overrated' ? 'Overrated' : 'Fairly Rated';
      showVoteToast("overrated", "Vote recorded!", { description: `You voted ${person.name} as ${label}.` });
    },
    onSuccess: () => {
      trackVoteCast("celebrity_person", { kind: "value_vote" });
      queryClient.invalidateQueries({ queryKey: ['/api/celebrity', person.id, 'value-vote'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trending'] });
      // Leaderboard is queried under several literal keys ('?tab=value&limit=20',
      // '…=100', '…=1000'), which array-prefix matching can't cover — match any
      // string key that starts with the endpoint so every instance refetches.
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          q.queryKey[0].startsWith("/api/leaderboard"),
      });
    },
    onError: (error: any) => {
      setLocalVote(person.userValueVote ?? null);
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      } else {
        toast.error("Vote failed", { description: error.message || "Something went wrong" });
      }
    },
  });

  const handleVote = (voteType: VoteType) => {
    if (!user) {
      toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      return;
    }
    if (!localVote) {
      valueVoteMutation.mutate(voteType);
    }
  };

  const handleChangeVote = () => {
    setLocalVote(null);
  };

  const isPending = valueVoteMutation.isPending;

  const voteIcon = localVote === 'underrated'
    ? <ArrowUp className="h-4 w-4 text-[#00C853]" />
    : localVote === 'overrated'
      ? <ArrowDown className="h-4 w-4 text-[#FF0000]" />
      : <Minus className="h-4 w-4 text-slate-600 dark:text-slate-400" />;

  const voteColor = localVote === 'underrated'
    ? 'text-[#00C853]'
    : localVote === 'overrated'
      ? 'text-[#FF0000]'
      : 'text-slate-600 dark:text-slate-400';

  const voteLabel = localVote === 'underrated'
    ? 'underrated'
    : localVote === 'overrated'
      ? 'overrated'
      : 'fairly rated';

  return (
    <div className="hub-card-slot relative h-full">
    <Card 
      className="hub-card-hover lb-row-neutral relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 bg-card/80 backdrop-blur-sm h-full min-h-[390px] md:min-h-0 flex flex-col shadow-none md:shadow-sm rounded-[12px] md:rounded-xl"
      data-testid={`card-value-vote-${person.id}`}
    >
      {person.category && (
        <div className="absolute top-3 right-3">
          <InteractiveCategoryPill
            category={person.category}
            onFilter={() => onFilterCategory?.(person.category!)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/vote/value-rankings?focus=${encodeURIComponent(person.id)}`}
            detailLabel="See How They Compare"
            onBrowseFullScreen={onBrowseFullScreen}
            menuDisabled={categoryMenuDisabled}
            data-testid={`badge-category-${person.id}`}
          />
        </div>
      )}
      
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
        <span className={localVote ? "" : "text-slate-600"}>
          {localVote ? `${totalVotes.toLocaleString('en-US')} votes` : "Votes"}
        </span>
      </div>
      
      <div 
        className="flex items-start gap-3 md:gap-3 mb-4 cursor-pointer group"
        onClick={onVisitProfile}
      >
        <PersonAvatar 
          name={person.name} 
          avatar={person.avatar} 
          className="h-20 w-20 md:h-16 md:w-16"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-bold text-xl md:text-lg leading-tight group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
            {person.name}
          </h3>
          <p className="text-[15px] md:text-sm text-muted-foreground mt-1 md:mt-0.5">
            Trend Score: <span className="font-mono text-foreground">{(person.fameIndex ?? 0).toLocaleString('en-US')}</span>
          </p>
          {(person.approvalAvgRating ?? person.approvalPct) != null && (
            <p className="text-sm md:text-xs text-muted-foreground mt-0.5">
              {person.approvalAvgRating != null
                ? <>{person.approvalAvgRating.toFixed(1)}<span className="text-white">/5</span> community rating</>
                : `${Math.round(person.approvalPct!)}% approval`}
            </p>
          )}
        </div>
      </div>
      
      {!localVote ? (
        <div className="flex flex-col gap-3 mt-auto">
          <p className="text-[16px] leading-[1.4] text-muted-foreground text-center mb-2">
            Is {person.name.split(" ")[0]} underrated or overrated?
          </p>
          <button
            onClick={() => handleVote('underrated')}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20 disabled:opacity-50"
            data-testid={`button-underrated-${person.id}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ArrowUp className="h-4 w-4 shrink-0" />
                <span>Underrated</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleVote('fairly_rated')}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-muted/40 border border-border text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white text-sm font-medium transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60 dark:hover:border-white/80 dark:hover:bg-white/15 disabled:opacity-50"
            data-testid={`button-fairly-rated-${person.id}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Minus className="h-4 w-4 shrink-0" />
                <span>Fairly Rated</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleVote('overrated')}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 disabled:opacity-50"
            data-testid={`button-overrated-${person.id}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ArrowDown className="h-4 w-4 shrink-0" />
                <span>Overrated</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-1 items-start justify-center pt-2 pb-0 md:pt-1.5 md:pb-0">
            <Link
              href={`/vote/value-rankings?focus=${encodeURIComponent(person.id)}`}
              className="group inline-flex items-center gap-1.5 text-sm text-cyan-600 dark:text-cyan-400 transition-colors underline-offset-4 hover:underline"
              data-testid={`link-value-compare-${person.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <BarChart2 className="h-4 w-4 shrink-0" aria-hidden />
              <span>See how {person.name.split(" ")[0]} compares</span>
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
          <div className="flex flex-col gap-4 md:gap-3 translate-y-3">
          <div className="flex items-center gap-3 md:gap-2.5">
            <ArrowUp className="h-5 w-5 md:h-4 md:w-4 text-[#00C853] shrink-0" />
            <span className="text-base font-medium md:text-sm text-[#00C853] w-[5.25rem] md:w-20 shrink-0">Underrated</span>
            <div className="flex-1 h-4 md:h-3 bg-white/5 rounded-full overflow-hidden self-center">
              <div 
                className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                style={{ width: `${underratedPct}%` }}
              />
            </div>
            <span className="text-base tabular-nums md:text-sm text-muted-foreground w-11 md:w-10 text-right font-medium">{Math.round(underratedPct)}%</span>
          </div>
          <div className="flex items-center gap-3 md:gap-2.5">
            <Minus className="h-5 w-5 md:h-4 md:w-4 text-slate-600 dark:text-slate-400 shrink-0" />
            <span className="text-base font-medium md:text-sm text-slate-600 dark:text-slate-400 w-[5.25rem] md:w-20 shrink-0">Fair</span>
            <div className="flex-1 h-4 md:h-3 bg-white/5 rounded-full overflow-hidden self-center">
              <div 
                className="h-full bg-slate-500 rounded-full transition-all duration-500"
                style={{ width: `${fairlyRatedPct}%` }}
              />
            </div>
            <span className="text-base tabular-nums md:text-sm text-muted-foreground w-11 md:w-10 text-right font-medium">{Math.round(fairlyRatedPct)}%</span>
          </div>
          <div className="flex items-center gap-3 md:gap-2.5">
            <ArrowDown className="h-5 w-5 md:h-4 md:w-4 text-[#FF0000] shrink-0" />
            <span className="text-base font-medium md:text-sm text-[#FF0000] w-[5.25rem] md:w-20 shrink-0">Overrated</span>
            <div className="flex-1 h-4 md:h-3 bg-white/5 rounded-full overflow-hidden self-center">
              <div 
                className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                style={{ width: `${overratedPct}%` }}
              />
            </div>
            <span className="text-base tabular-nums md:text-sm text-muted-foreground w-11 md:w-10 text-right font-medium">{Math.round(overratedPct)}%</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-white/10">
            <div className="flex items-center gap-2">
              {voteIcon}
              <span className="text-sm text-muted-foreground">
                You voted <span className={voteColor}>
                  {voteLabel}
                </span>
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleChangeVote}
              className="text-xs text-muted-foreground"
              data-testid={`button-change-vote-${person.id}`}
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
