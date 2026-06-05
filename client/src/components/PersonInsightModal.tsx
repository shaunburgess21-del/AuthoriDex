import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Star, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { getCategoryStyle, getCategoryTextColor } from "@/components/CategoryPill";
import { useFavorites } from "@/hooks/useFavorites";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { navigateToLogin } from "@/lib/authReturn";
import { queryClient } from "@/lib/queryClient";
import { toast } from "sonner";

/**
 * Snapshot-of-a-person modal shown when clicking a leaderboard / mover row.
 *
 * Extracted from HomePage so the home leaderboard, Hot Movers, and the
 * Insights "Movers" card all open the exact same UI. Self-manages its
 * `/api/people/:id/momentum` query, signal derivation, and the
 * mobile-drawer / desktop-dialog shell.
 */

export interface InsightPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number | null;
  change24h: number | null;
  rankChange: number | null;
  hotMover: boolean;
}

interface InsightWhyTrendingData {
  hasContext: boolean;
  summary?: string;
}

interface PersonMomentumResponse {
  signals?: {
    news?: { deltaPct?: number };
    wiki?: { deltaPct?: number };
    momentum?: { deltaPct?: number; ratio?: number };
    wikiMomentum?: { deltaPct?: number; ratio?: number };
    trends?: { deltaPct?: number };
  };
  categoryRank?: {
    overall?: number | null;
    category?: string | null;
    categoryRank?: number | null;
  } | null;
}

/** Signed % from 24h-vs-baseline ratio (news/wiki momentum chips). */
function momentumRatioDeltaPct(ratio: number, deadZonePct = 5): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const raw = Math.round((ratio - 1) * 100);
  return Math.abs(raw) <= deadZonePct ? 0 : raw;
}

interface InsightSignal {
  label: "Wiki" | "News" | "News Momentum" | "Wiki Momentum" | "Search Momentum";
  deltaPct: number;
}

// Hide chips for signals between ±5% so tiny noise doesn't pile up.
const INSIGHT_SIGNAL_DEAD_ZONE_PCT = 5;

function InsightWhyTrendingSnippet({
  personId,
  hotMover,
  onReadMore,
}: {
  personId: string;
  hotMover: boolean;
  onReadMore: () => void;
}) {
  const url = hotMover
    ? `/api/why-trending/${personId}?hotMover=true`
    : `/api/why-trending/${personId}`;
  const queryKey = ["/api/why-trending", personId, hotMover ? "hot" : "default"];
  const { data, isLoading, isError } = useQuery<InsightWhyTrendingData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    retry: 1,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60 space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">WHY THEY'RE TRENDING</p>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  if (isError || !data?.hasContext || !data.summary) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60 min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">WHY THEY'RE TRENDING</p>
      <p className="text-xs leading-snug text-muted-foreground line-clamp-3 break-words" data-testid="text-insight-why-trending">
        {data.summary}
      </p>
      <div className="flex justify-end mt-1.5">
        <button
          type="button"
          onClick={onReadMore}
          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          data-testid="button-insight-why-trending-read-more"
        >
          Read more {"\u2192"}
        </button>
      </div>
    </div>
  );
}

function InsightPanelContent({
  person,
  loading,
  error,
  growthSignals,
  coolingSignals,
  categoryRank,
  onClose,
  onViewProfile,
}: {
  person: InsightPerson;
  loading: boolean;
  error: boolean;
  growthSignals: InsightSignal[];
  coolingSignals: InsightSignal[];
  categoryRank: number | null;
  onClose: () => void;
  onViewProfile: () => void;
}) {
  const formatPct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1).replace(/\.0$/, "")}%`;
  const currentRank = typeof person.rank === "number" ? person.rank : null;
  const hasRankChange = typeof person.rankChange === "number";
  const previousRank =
    currentRank != null && hasRankChange ? currentRank + person.rankChange! : null;
  const showWasNow =
    currentRank != null &&
    currentRank >= 1 &&
    previousRank != null &&
    previousRank >= 1;
  const hasPct = typeof person.change24h === "number";
  const showRankMovement =
    showWasNow || (hasRankChange && currentRank != null) || hasPct;

  const [, setLocation] = useLocation();
  const { session } = useAuth();
  const { isFavorite, isAuthenticated } = useFavorites();
  const favorited = isFavorite(person.id);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  const handleToggleFavorite = async () => {
    if (!isAuthenticated || !session?.access_token) return;
    setFavoriteLoading(true);
    try {
      const method = favorited ? "DELETE" : "POST";
      const res = await fetch(`/api/me/favorites/${person.id}`, {
        method,
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        ...(method === "POST" ? {
          body: JSON.stringify({
            personName: person.name,
            personAvatar: person.avatar,
            personCategory: person.category,
          }),
        } : {}),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/me/favorites"] });
      toast(favorited ? "Removed from favorites" : "Added to favorites", {
        description: favorited
          ? `${person.name} has been removed from your favorites`
          : `${person.name} has been added to your favorites`,
      });
    } catch (err) {
      console.error("Error toggling favorite:", err);
      toast.error("Error", { description: "Failed to update favorite status" });
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleSignInFromTooltip = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigateToLogin(setLocation);
  };

  const favoriteButton = (
    <button
      type="button"
      onClick={handleToggleFavorite}
      disabled={!isAuthenticated || favoriteLoading}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      data-testid="button-insight-favorite"
      className={`shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
        isAuthenticated
          ? "hover:bg-muted text-muted-foreground hover:text-foreground"
          : "text-muted-foreground/60 cursor-not-allowed"
      } ${favorited ? "text-yellow-500 hover:text-yellow-500" : ""}`}
    >
      <Star className={`h-5 w-5 ${favorited ? "fill-yellow-500" : ""}`} />
    </button>
  );

  const categoryStyle = person.category ? getCategoryStyle(person.category) : null;

  return (
    <div className="space-y-3 sm:space-y-4 sm:pt-2 min-w-0 w-full">
      <div className="flex items-center gap-3 px-3 py-2 sm:p-3 rounded-lg bg-muted/40 border border-border/50 min-w-0">
        <button
          type="button"
          onClick={onViewProfile}
          aria-label={`View ${person.name}'s profile`}
          className="shrink-0 rounded-md transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="button-insight-avatar"
        >
          <PersonAvatar
            name={person.name}
            avatar={person.avatar}
            size="lg"
            className="h-16 w-16 sm:h-20 sm:w-20"
          />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onViewProfile}
            className="block max-w-full text-left font-semibold text-xl sm:text-2xl leading-tight truncate hover:underline focus:outline-none focus:underline cursor-pointer"
            data-testid="button-insight-name"
          >
            {person.name}
          </button>
          {person.category && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className={`text-base ${getCategoryTextColor(person.category)}`}>{person.category}</span>
              {categoryRank != null && categoryRank > 0 && categoryStyle && (
                <span
                  data-vaul-no-drag
                  onPointerDown={(e) => e.stopPropagation()}
                  className="inline-flex"
                >
                  <TouchTooltip
                    content={(
                      <div className="space-y-1.5 normal-case tracking-normal">
                        <p className="font-semibold text-sm">{person.category} Rank</p>
                        <p className="text-xs text-muted-foreground">
                          {person.name}'s position within the {person.category} category, ranked against others in the same field.
                        </p>
                      </div>
                    )}
                    side="bottom"
                    align="start"
                    contentClassName="max-w-[240px]"
                    showCloseButton
                  >
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold cursor-help ${categoryStyle.bg} border ${categoryStyle.border} ${categoryStyle.text}`}
                      data-testid="text-insight-category-rank"
                    >
                      <Trophy className="h-3 w-3" />
                      #{categoryRank}
                    </span>
                  </TouchTooltip>
                </span>
              )}
            </div>
          )}
        </div>
        {isAuthenticated ? (
          favoriteButton
        ) : (
          <span
            data-vaul-no-drag
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex shrink-0"
          >
            <TouchTooltip
              content={(
                <span>
                  Sign in to favorite —{" "}
                  <button
                    type="button"
                    onClick={handleSignInFromTooltip}
                    className="underline text-primary hover:text-primary/80"
                  >
                    click here to sign in
                  </button>
                </span>
              )}
              side="left"
            >
              {favoriteButton}
            </TouchTooltip>
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60 min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">24H RANK MOVEMENT</p>
        {showRankMovement ? (
          <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
            {showWasNow ? (
              <p className="text-sm font-medium shrink-0">
                Was #{previousRank} {"\u2192"} Now #{currentRank}
              </p>
            ) : hasRankChange && currentRank != null ? (
              <p className="text-sm font-medium shrink-0">Now #{currentRank}</p>
            ) : (
              <span className="sr-only">24h rank movement</span>
            )}
            <div className="flex items-center gap-1.5 flex-wrap justify-end min-w-0">
              {hasPct && person.change24h !== 0 && (
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium tabular-nums ${
                  person.change24h! > 0
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-red-500/15 text-red-600 dark:text-red-400"
                }`}>
                  {person.change24h! > 0 ? "+" : ""}
                  {person.change24h!.toFixed(1)}%
                </span>
              )}
              {hasRankChange && person.rankChange === 0 ? (
                <span className="text-xs text-muted-foreground italic">No rank change</span>
              ) : hasRankChange && person.rankChange !== 0 ? (
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${
                  person.rankChange! > 0
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-red-500/15 text-red-600 dark:text-red-400"
                }`}>
                  {person.rankChange! > 0 ? "+" : ""}
                  {person.rankChange} rank
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Rank movement unavailable</p>
        )}
      </div>

      <InsightWhyTrendingSnippet
        personId={person.id}
        hotMover={person.hotMover}
        onReadMore={() => {
          setLocation(`/person/${person.id}?scroll=why-trending`);
          onClose();
        }}
      />

      {loading ? (
        <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
          <p className="text-sm text-muted-foreground">Loading signal insights...</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
          <p className="text-sm text-muted-foreground">Unable to load signal insights right now</p>
        </div>
      ) : (
        <>
          {growthSignals.length > 0 && (
            <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">GROWTH SIGNALS</p>
              <div className="flex flex-wrap gap-2 min-w-0">
                {growthSignals.map((signal) => (
                  <span
                    key={signal.label}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400"
                  >
                    {signal.label} {formatPct(signal.deltaPct)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {coolingSignals.length > 0 && (
            <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">COOLING SIGNALS</p>
              <div className="flex flex-wrap gap-2 min-w-0">
                {coolingSignals.map((signal) => (
                  <span
                    key={signal.label}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400"
                  >
                    {signal.label} {formatPct(signal.deltaPct)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:justify-end min-w-0 w-full">
        <div className="flex flex-row gap-2 min-w-0 w-full sm:w-auto">
          <Button
          variant="outline"
          onClick={() => {
            setLocation(`/person/${person.id}?tab=vote`);
            onClose();
          }}
          className="flex-1 sm:flex-none shrink-0 bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20 hover:bg-cyan-500/35 dark:hover:bg-cyan-500/30 hover:text-cyan-600 dark:hover:text-cyan-400"
          data-testid="button-insight-vote"
        >
          Vote
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setLocation(`/person/${person.id}?tab=predict`);
            onClose();
          }}
          className="flex-1 sm:flex-none shrink-0 bg-violet-500/25 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border border-violet-500/50 dark:border-violet-400/40 shadow-sm shadow-violet-500/30 dark:shadow-violet-500/20 hover:bg-violet-500/35 dark:hover:bg-violet-500/30 hover:text-violet-600 dark:hover:text-violet-400"
          data-testid="button-insight-predict"
        >
          Predict
        </Button>
        </div>
        <Button onClick={onViewProfile} className="flex-1 sm:flex-none shrink-0">
          View full profile
        </Button>
      </div>
    </div>
  );
}

/**
 * Self-contained snapshot modal. Pass a person to open; pass null to close.
 */
export function PersonInsightModal({
  person,
  onClose,
}: {
  person: InsightPerson | null;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();

  const {
    data: momentum,
    isLoading,
    isError,
  } = useQuery<PersonMomentumResponse>({
    queryKey: ["/api/people", person?.id, "momentum"],
    queryFn: async () => {
      const response = await fetch(`/api/people/${person!.id}/momentum`);
      if (!response.ok) throw new Error("Failed to fetch momentum insights");
      return response.json();
    },
    enabled: !!person?.id,
    staleTime: 60_000,
  });

  const signals = useMemo<InsightSignal[]>(() => {
    if (!momentum?.signals) return [];
    return [
      { label: "Wiki" as const, deltaPct: momentum.signals.wiki?.deltaPct ?? 0 },
      { label: "News" as const, deltaPct: momentum.signals.news?.deltaPct ?? 0 },
      { label: "News Momentum" as const, deltaPct: momentumRatioDeltaPct(momentum.signals.momentum?.ratio ?? 0) },
      { label: "Wiki Momentum" as const, deltaPct: momentumRatioDeltaPct(momentum.signals.wikiMomentum?.ratio ?? 0) },
      { label: "Search Momentum" as const, deltaPct: momentum.signals.trends?.deltaPct ?? 0 },
    ];
  }, [momentum]);

  const growthSignals = useMemo<InsightSignal[]>(
    () => signals.filter((item) => Number.isFinite(item.deltaPct) && item.deltaPct >= INSIGHT_SIGNAL_DEAD_ZONE_PCT),
    [signals],
  );
  const coolingSignals = useMemo<InsightSignal[]>(
    () => signals.filter((item) => Number.isFinite(item.deltaPct) && item.deltaPct <= -INSIGHT_SIGNAL_DEAD_ZONE_PCT),
    [signals],
  );

  const onViewProfile = () => {
    if (!person) return;
    setLocation(`/person/${person.id}`);
    onClose();
  };

  const content = person && (
    <InsightPanelContent
      person={person}
      loading={isLoading}
      error={isError}
      growthSignals={growthSignals}
      coolingSignals={coolingSignals}
      categoryRank={momentum?.categoryRank?.categoryRank ?? null}
      onClose={onClose}
      onViewProfile={onViewProfile}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={!!person} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DrawerContent>
          {person && (
            <>
              <DrawerHeader className="text-left sr-only">
                <DrawerTitle>{person.name}</DrawerTitle>
                <DrawerDescription>
                  Trend score insight and 24h movement for {person.name}
                </DrawerDescription>
              </DrawerHeader>
              <div className="px-3 pb-3 pt-1">{content}</div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={!!person} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md overflow-x-hidden [&>*]:min-w-0">
        {person && (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{person.name}</DialogTitle>
              <DialogDescription>
                Trend score insight and 24h movement for {person.name}
              </DialogDescription>
            </DialogHeader>
            {content}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
