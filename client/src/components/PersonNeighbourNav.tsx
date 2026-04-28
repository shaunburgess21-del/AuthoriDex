import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";

interface NeighbourPerson {
  id: string;
  name: string;
  avatar: string | null;
  rank: number;
  category: string | null;
  trendScore: number;
  change24h: number | null;
}

interface NeighboursResponse {
  prev: NeighbourPerson | null;
  next: NeighbourPerson | null;
}

/**
 * Dedicated queryFn that reads + JSON-parses the response inside a
 * try/catch. The default global queryFn does `await res.json()` and
 * throws if the body isn't valid JSON — that path triggers when the
 * server route isn't registered (dev-server stale after a restart,
 * deploy window, etc.) and the SPA fallback HTML comes back with a
 * 200. Without this guard a transient HTML response would leave
 * `useQuery` in `isError=true` forever and unmount the entire
 * section. Treating it as an empty payload keeps the UI present
 * with placeholders so the page doesn't visually break.
 */
async function fetchNeighbours(personId: string): Promise<NeighboursResponse> {
  const res = await fetch(`/api/trending/${personId}/neighbours`, {
    credentials: "include",
  });
  if (!res.ok) {
    return { prev: null, next: null };
  }
  const text = await res.text();
  if (!text) return { prev: null, next: null };
  try {
    const parsed = JSON.parse(text) as Partial<NeighboursResponse>;
    return {
      prev: parsed?.prev ?? null,
      next: parsed?.next ?? null,
    };
  } catch {
    if (typeof console !== "undefined") {
      console.warn("[PersonNeighbourNav] non-JSON response from /neighbours; route may not be registered yet");
    }
    return { prev: null, next: null };
  }
}

interface PersonNeighbourNavProps {
  personId: string;
}

/**
 * "Continue exploring" — bottom-of-profile navigator that walks the
 * leaderboard one rank at a time. Mounted on the celebrity profile
 * page below all tab content so it's always reachable.
 *
 * Direction convention:
 * - "Previous" = rank − 1, i.e. one place higher (e.g. on #5 → #4).
 * - "Next"     = rank + 1, i.e. one place lower (e.g. on #5 → #6).
 *
 * The two-column layout is preserved across breakpoints so users
 * keep the same mental model on mobile vs. desktop. Edge cases
 * (top of list / end of list) render a muted placeholder rather
 * than collapsing the grid — the visual symmetry is part of the
 * affordance, and the placeholder text explains the absence.
 */
export function PersonNeighbourNav({ personId }: PersonNeighbourNavProps) {
  const { data, isLoading } = useQuery<NeighboursResponse>({
    queryKey: [`/api/trending/${personId}/neighbours`],
    queryFn: () => fetchNeighbours(personId),
    enabled: !!personId,
    // Neighbours change at the same cadence as the leaderboard
    // itself (hourly ingest). 5min staleTime keeps the navigator
    // responsive without spamming refetches as the user scrolls
    // through profiles.
    staleTime: 5 * 60 * 1000,
  });

  // Note: we deliberately do NOT short-circuit on errors. fetchNeighbours
  // already swallows non-2xx and non-JSON responses to {prev:null,next:null},
  // so the section degrades to edge placeholders rather than vanishing
  // mid-load (which was confusing during dev-server restarts).

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

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        {isLoading ? (
          <>
            <NeighbourSkeleton direction="prev" />
            <NeighbourSkeleton direction="next" />
          </>
        ) : (
          <>
            <NeighbourCard direction="prev" person={data?.prev ?? null} />
            <NeighbourCard direction="next" person={data?.next ?? null} />
          </>
        )}
      </div>
    </section>
  );
}

function NeighbourCard({
  direction,
  person,
}: {
  direction: "prev" | "next";
  person: NeighbourPerson | null;
}) {
  const isPrev = direction === "prev";
  const eyebrow = isPrev ? "Previous" : "Next";

  if (!person) {
    return (
      <div
        className={cn(
          // Match the populated card's vertical rhythm so the grid
          // stays balanced when one neighbour exists and the other
          // doesn't (e.g. rank #1 has no "previous").
          "rounded-2xl border border-dashed border-border/60 bg-muted/20",
          "flex flex-col items-center justify-center text-center gap-1.5",
          "p-4 min-h-[210px] md:min-h-[152px] md:p-5",
        )}
        data-testid={`neighbour-card-${direction}-empty`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {eyebrow}
        </p>
        <p className="text-xs text-muted-foreground/80">
          {isPrev ? "Top of the leaderboard" : "End of the leaderboard"}
        </p>
      </div>
    );
  }

  const change = person.change24h ?? 0;
  const isUp = change > 0;
  const isDown = change < 0;
  const TrendIcon = isUp ? TrendingUp : isDown ? TrendingDown : null;

  return (
    <Link
      href={`/person/${person.id}`}
      data-testid={`neighbour-card-${direction}`}
      aria-label={`${eyebrow}: ${person.name}, rank ${person.rank}`}
      className={cn(
        // Two layouts:
        // - Mobile: vertical stack, centered. Eyebrow → avatar →
        //   name → score → change. Avoids the cramped horizontal
        //   collision we saw on narrow viewports.
        // - md+: horizontal with a larger avatar and roomier
        //   typography. Direction is mirrored (next = reversed
        //   row + right-aligned text).
        "group relative rounded-2xl border border-border/60 bg-card",
        "shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/5",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        // Mobile stack
        "flex flex-col items-center text-center gap-2 p-4",
        // Desktop row
        "md:flex-row md:items-center md:text-left md:gap-4 md:p-4",
        !isPrev && "md:flex-row-reverse md:text-right",
      )}
    >
      {/* Eyebrow — on mobile this sits at the top of the stack so the
          ordering reads: Previous → avatar → name → score → change.
          On desktop it lives inside the info column so the avatar
          can hug the edge. */}
      <p
        className={cn(
          "flex items-center gap-1",
          "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80",
          "md:hidden",
        )}
      >
        {isPrev && (
          <ChevronLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
        )}
        <span>{eyebrow}</span>
        {!isPrev && (
          <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        )}
      </p>

      <div className="relative shrink-0">
        <PersonAvatar
          name={person.name}
          avatar={person.avatar}
          size="lg"
          className={cn(
            "rounded-xl ring-2 ring-transparent group-hover:ring-blue-500/30 transition-all",
            // Bigger on both viewports — was 48/56, now 80/72.
            "h-20 w-20 md:h-[72px] md:w-[72px]",
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

      <div className={cn("min-w-0 w-full md:flex-1")}>
        {/* Eyebrow — desktop only, lives next to the name. */}
        <p
          className={cn(
            "hidden md:flex items-center gap-1",
            "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80",
            !isPrev && "justify-end",
          )}
        >
          {isPrev && (
            <ChevronLeft className="h-3.5 w-3.5 -ml-0.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
          )}
          <span>{eyebrow}</span>
          {!isPrev && (
            <ChevronRight className="h-3.5 w-3.5 -mr-0.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          )}
        </p>

        <p
          className={cn(
            "mt-2 md:mt-0.5 font-semibold truncate transition-colors",
            "text-base md:text-lg",
            "group-hover:text-blue-600 dark:group-hover:text-blue-400",
          )}
        >
          {person.name}
        </p>

        {/* Score + change.
            Mobile: stacked (each on its own line) per request.
            Desktop: inline so the eye can scan score → delta. */}
        <div
          className={cn(
            "mt-1 flex flex-col items-center gap-0.5",
            "md:mt-0.5 md:flex-row md:items-center md:gap-2",
            "text-[13px] md:text-sm",
            !isPrev && "md:justify-end",
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
}

function NeighbourSkeleton({ direction }: { direction: "prev" | "next" }) {
  const isPrev = direction === "prev";
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card",
        // Same structural rhythm as the real card so the layout
        // doesn't pop when data resolves.
        "flex flex-col items-center gap-2 p-4",
        "md:flex-row md:items-center md:gap-4 md:p-4",
        !isPrev && "md:flex-row-reverse",
      )}
    >
      <Skeleton className="h-3 w-16 md:hidden" />
      <Skeleton className="h-20 w-20 md:h-[72px] md:w-[72px] rounded-xl shrink-0" />
      <div
        className={cn(
          "w-full md:flex-1 space-y-2 flex flex-col items-center md:items-start",
          !isPrev && "md:items-end",
        )}
      >
        {/* Eyebrow placeholder — desktop only (mobile eyebrow lives
            outside this block, above the avatar). */}
        <Skeleton className="hidden md:block h-3 w-16" />
        {/* Name */}
        <Skeleton className="h-4 w-32" />
        {/* Score */}
        <Skeleton className="h-3 w-20" />
        {/* Change % — mobile only; on desktop score+change collapse
            into a single inline row, so we don't add a third bar. */}
        <Skeleton className="md:hidden h-3 w-14" />
      </div>
    </div>
  );
}
