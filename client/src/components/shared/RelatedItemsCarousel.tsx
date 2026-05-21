import { Link } from "wouter";
import { Clock, Sparkles, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MarketThumbCollage,
  type ThumbParticipant,
} from "@/components/predict/MarketThumbCollage";
import { cn } from "@/lib/utils";
import { formatVox } from "@/lib/currency";

export type RelatedCarouselItem = {
  id: string;
  href: string;
  title: string;
  subtitle?: string | null;
  thumbVariant: "single" | "split" | "grid";
  thumbParticipants: ThumbParticipant[];
  typePill: string;
  cardWidthClass: string;
  category?: string | null;
  endAt?: string | null;
  voteCount?: number | null;
  creditPool?: number | null;
};

export type RelatedCountNoun = "market" | "matchup" | "poll";

/** Uniform card height across the carousel row. */
const CARD_BODY_HEIGHT = "h-[9.5rem]";

function subtitleShows(title: string, subtitle: string | null | undefined): boolean {
  if (!subtitle?.trim()) return false;
  const norm = (s: string) => s.trim().toLowerCase();
  return norm(subtitle) !== norm(title);
}

function formatTimeLeft(endAt: string | null | undefined): string | null {
  if (!endAt) return null;
  const ms = new Date(endAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Closing now";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d left`;
  if (hours >= 1) return `${hours}h left`;
  if (minutes >= 1) return `${minutes}m left`;
  return "Closing now";
}

function formatVoteCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M votes`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K votes`;
  return `${count.toLocaleString()} vote${count === 1 ? "" : "s"}`;
}

const DEFAULT_SPARKLES_CLASS = "text-violet-500";

export interface RelatedItemsCarouselProps {
  items: RelatedCarouselItem[];
  isLoading: boolean;
  countNoun: RelatedCountNoun;
  /** Default skeleton/card width when loading */
  skeletonWidthClass: string;
  testIdPrefix: string;
  ariaLabel?: string;
  className?: string;
  /** Sparkles icon color — vote pages use cyan; predict keeps violet default. */
  sparklesClassName?: string;
}

export function RelatedItemsCarousel({
  items,
  isLoading,
  countNoun,
  skeletonWidthClass,
  testIdPrefix,
  ariaLabel = "Related items",
  className,
  sparklesClassName = DEFAULT_SPARKLES_CLASS,
}: RelatedItemsCarouselProps) {
  const countLabel =
    countNoun === "market"
      ? `market${items.length === 1 ? "" : "s"}`
      : countNoun === "matchup"
        ? `matchup${items.length === 1 ? "" : "s"}`
        : `poll${items.length === 1 ? "" : "s"}`;

  if (isLoading) {
    return (
      <section
        className={className}
        aria-label={ariaLabel}
        data-testid={`${testIdPrefix}-loading`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className={cn("h-3.5 w-3.5", sparklesClassName)} />
            More like this
          </h3>
        </div>
        <div className="flex gap-4 overflow-x-auto -mx-4 px-4 pb-2 snap-x snap-mandatory scrollbar-thin">
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              className={cn(CARD_BODY_HEIGHT, "shrink-0 rounded-xl", skeletonWidthClass)}
            />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className={className} aria-label={ariaLabel} data-testid={testIdPrefix}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className={cn("h-3.5 w-3.5", sparklesClassName)} />
          More like this
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {items.length} more {countLabel}
        </span>
      </div>

      <div
        className="flex gap-4 overflow-x-auto -mx-4 px-4 pb-2 snap-x snap-mandatory scrollbar-thin"
        data-testid={`${testIdPrefix}-scroller`}
      >
        {items.map((m) => {
          const timeLeft = formatTimeLeft(m.endAt);
          const showSubtitle = subtitleShows(m.title, m.subtitle);
          return (
            <Link
              key={m.id}
              href={m.href}
              className={cn("shrink-0 snap-start block", CARD_BODY_HEIGHT)}
              data-testid={`${testIdPrefix}-item-${m.id}`}
            >
              <Card
                className={cn(
                  "group h-full cursor-pointer hover-elevate overflow-hidden transition-colors",
                  m.cardWidthClass,
                )}
              >
                <div className={cn("flex items-center gap-3.5 p-3.5 h-full")}>
                  <MarketThumbCollage
                    variant={m.thumbVariant}
                    participants={m.thumbParticipants}
                    size="lg"
                    className="shrink-0"
                  />

                  <div className="flex min-w-0 flex-1 flex-col h-full min-h-0">
                    <div className="flex flex-1 flex-col min-h-0 py-0.5">
                      <div className="min-w-0 w-full space-y-1">
                        <Badge
                          variant="secondary"
                          className="text-[10px] uppercase tracking-wider px-2 py-0"
                        >
                          {m.typePill}
                        </Badge>
                        <p className="text-[15px] font-semibold leading-snug line-clamp-3">
                          {m.title}
                        </p>
                        {showSubtitle && (
                          <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
                            {m.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-auto flex shrink-0 items-center justify-between gap-2 pt-1.5 text-xs text-muted-foreground">
                      {timeLeft ? (
                        <span className="flex items-center gap-1 truncate">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          {timeLeft}
                        </span>
                      ) : (
                        <span className="truncate">{m.category ?? ""}</span>
                      )}
                      {typeof m.creditPool === "number" && m.creditPool > 0 && (
                        <span className="font-mono shrink-0 tabular-nums">
                          {formatVox(m.creditPool)}
                        </span>
                      )}
                      {typeof m.voteCount === "number" &&
                        m.voteCount > 0 &&
                        !(typeof m.creditPool === "number" && m.creditPool > 0) && (
                          <span className="shrink-0 tabular-nums">
                            {formatVoteCount(m.voteCount)}
                          </span>
                        )}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
