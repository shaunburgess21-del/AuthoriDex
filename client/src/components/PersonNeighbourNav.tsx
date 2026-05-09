import { forwardRef, useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";

interface ExplorePerson {
  id: string;
  name: string;
  avatar: string | null;
  rank: number;
  category: string | null;
  trendScore: number;
  change24h: number | null;
}

interface ExploreResponse {
  people: ExplorePerson[];
  focusIndex: number;
}

async function fetchExploreStrip(personId: string): Promise<ExploreResponse> {
  const res = await fetch(`/api/trending/${personId}/explore`, {
    credentials: "include",
  });
  if (!res.ok) {
    return { people: [], focusIndex: -1 };
  }
  const text = await res.text();
  if (!text) return { people: [], focusIndex: -1 };
  try {
    const parsed = JSON.parse(text) as Partial<ExploreResponse>;
    const people = Array.isArray(parsed?.people) ? parsed.people : [];
    const focusIndex =
      typeof parsed?.focusIndex === "number" ? parsed.focusIndex : -1;
    return { people, focusIndex };
  } catch {
    if (typeof console !== "undefined") {
      console.warn(
        "[PersonNeighbourNav] non-JSON response from /explore; route may not be registered yet",
      );
    }
    return { people: [], focusIndex: -1 };
  }
}

interface PersonNeighbourNavProps {
  personId: string;
}

/**
 * "Continue exploring" — horizontal leaderboard strip on the profile page.
 * Users swipe/scroll through the full trending board (same order as the main
 * leaderboard) and tap a card to open that person's profile.
 */
export function PersonNeighbourNav({ personId }: PersonNeighbourNavProps) {
  const { data, isLoading } = useQuery<ExploreResponse>({
    queryKey: ["/api/trending", personId, "explore"],
    queryFn: () => fetchExploreStrip(personId),
    enabled: !!personId,
    staleTime: 5 * 60 * 1000,
  });

  const focusRef = useRef<HTMLAnchorElement | null>(null);
  const didScrollRef = useRef(false);

  useLayoutEffect(() => {
    if (!data?.people.length || data.focusIndex < 0) return;
    if (didScrollRef.current) return;
    const el = focusRef.current;
    if (!el) return;
    didScrollRef.current = true;
    el.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [data?.people, data?.focusIndex]);

  useLayoutEffect(() => {
    didScrollRef.current = false;
  }, [personId]);

  if (!isLoading && (!data || data.people.length === 0)) {
    return null;
  }

  return (
    <section
      aria-label="Continue exploring the leaderboard"
      className="mt-12 mb-6"
      data-testid="person-neighbour-nav"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Continue exploring
        </span>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {data && data.focusIndex < 0 && data.people.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          Not on this week&apos;s leaderboard — browse everyone below.
        </p>
      )}

      <div
        className={cn(
          "flex gap-3 overflow-x-auto pb-2 -mx-4 px-4",
          "snap-x snap-mandatory scrollbar-thin",
        )}
        data-testid="person-explore-scroller"
      >
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <ExploreCardSkeleton key={i} />
            ))
          : data!.people.map((person, index) => (
              <ExploreCard
                key={person.id}
                person={person}
                isFocused={index === data!.focusIndex}
                ref={index === data!.focusIndex ? focusRef : null}
              />
            ))}
      </div>
    </section>
  );
}

const ExploreCard = forwardRef<
  HTMLAnchorElement,
  { person: ExplorePerson; isFocused: boolean }
>(function ExploreCard({ person, isFocused }, ref) {
  const change = person.change24h ?? 0;
  const isUp = change > 0;
  const isDown = change < 0;
  const TrendIcon = isUp ? TrendingUp : isDown ? TrendingDown : null;

  return (
    <Link
      ref={ref}
      href={`/person/${person.id}`}
      data-testid={`explore-card-${person.id}`}
      data-explore-focus={isFocused ? "true" : undefined}
      aria-label={`${person.name}, rank ${person.rank}`}
      aria-current={isFocused ? "true" : undefined}
      className={cn(
        "group relative shrink-0 snap-start",
        "w-[min(260px,85vw)]",
        "rounded-2xl border bg-card shadow-sm transition-all duration-200",
        "flex flex-col items-center text-center gap-2 p-4",
        "hover:-translate-y-0.5 hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/5",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        isFocused
          ? "border-blue-500/50 ring-2 ring-blue-500/25"
          : "border-border/60",
      )}
    >
      <div className="relative shrink-0">
        <PersonAvatar
          name={person.name}
          avatar={person.avatar}
          size="lg"
          className={cn(
            "rounded-xl ring-2 ring-transparent group-hover:ring-blue-500/30 transition-all",
            "h-20 w-20",
          )}
        />
        <span
          className={cn(
            "absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5",
            "bg-background border border-border/70 text-[11px] font-semibold tabular-nums shadow-sm",
          )}
        >
          #{person.rank}
        </span>
      </div>

      <div className="min-w-0 w-full pt-1">
        <p
          className={cn(
            "font-semibold truncate transition-colors text-base",
            "group-hover:text-blue-600 dark:group-hover:text-blue-400",
          )}
        >
          {person.name}
        </p>
        <div
          className={cn(
            "mt-1 flex flex-col items-center gap-0.5 text-[13px]",
          )}
        >
          <span className="tabular-nums font-medium text-foreground/90">
            {formatNumber(person.trendScore)}
          </span>
          {TrendIcon && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 tabular-nums font-medium",
                isUp && "text-green-600 dark:text-green-400",
                isDown && "text-red-600 dark:text-red-400",
              )}
            >
              <TrendIcon className="h-3.5 w-3.5" />
              {Math.abs(change).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </Link>
  );
});

function ExploreCardSkeleton() {
  return (
    <div
      className={cn(
        "shrink-0 snap-start w-[min(260px,85vw)] rounded-2xl border border-border/60 bg-card",
        "flex flex-col items-center gap-2 p-4",
      )}
    >
      <Skeleton className="h-20 w-20 rounded-xl shrink-0" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
