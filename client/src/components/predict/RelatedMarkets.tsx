import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Clock, Sparkles, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/PersonAvatar";

/**
 * Detail-page "more like this" carousel.
 *
 * Each native detail page (Up/Down, H2H, Race) and the community
 * `/markets/:slug` page reuses the list query that already populates
 * the Predict page — so adding this carousel costs zero extra requests
 * on every page except community (which still has to hit the standard
 * `/api/open-markets` endpoint, which is small and cached).
 *
 * Layout decisions:
 *   - Section sits at the very bottom of the detail page, after
 *     resolution info / comments. Goal is "you finished reading,
 *     here's the next thing" not "this is in your way".
 *   - Horizontal snap-scroll on mobile keeps the cards out of the
 *     primary tap-flow but discoverable.
 *   - Each card is a single tappable Link (no nested CTAs) so the
 *     whole tile is the affordance.
 *   - We hide the section entirely when there are zero candidates
 *     after filtering self-out — better than rendering an empty
 *     "Related markets" header.
 */

type RelatedMarketsType = "updown" | "h2h" | "race" | "community";

interface RelatedMarketsProps {
  type: RelatedMarketsType;
  currentMarketId: string;
  /**
   * Optional category to bias same-category markets to the front of
   * the list. Helps the carousel feel more like "more in this
   * category" than a random sampling.
   */
  category?: string | null;
  /** Hard cap on cards shown; 6 fits one and a half screens on mobile. */
  limit?: number;
  className?: string;
}

interface NormalizedMarket {
  id: string;
  href: string;
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  avatarName?: string | null;
  category?: string | null;
  endAt?: string | null;
  totalPool?: number | null;
  typePill: string;
}

const TYPE_ENDPOINT: Record<RelatedMarketsType, string> = {
  updown: "/api/native-markets/updown",
  h2h: "/api/native-markets/h2h",
  race: "/api/native-markets/gainer",
  community: "/api/open-markets",
};

const TYPE_PILL: Record<RelatedMarketsType, string> = {
  updown: "Up / Down",
  h2h: "Head to head",
  race: "Race",
  community: "Open market",
};

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

function normalizeUpdown(m: any): NormalizedMarket {
  const personName: string = m.person?.name ?? m.personName ?? "Unknown";
  return {
    id: m.id,
    href: `/predict/updown/${m.id}`,
    title: personName,
    subtitle: "Up or down this week?",
    avatarUrl: m.person?.avatar ?? null,
    avatarName: personName,
    category: m.category ?? null,
    endAt: m.endAt ?? null,
    totalPool: typeof m.totalPool === "number" ? m.totalPool : null,
    typePill: TYPE_PILL.updown,
  };
}

function normalizeH2h(m: any): NormalizedMarket {
  const p1: string = m.person1?.name ?? m.entries?.[0]?.label ?? "Side A";
  const p2: string = m.person2?.name ?? m.entries?.[1]?.label ?? "Side B";
  return {
    id: m.id,
    href: `/predict/h2h/${m.id}`,
    title: m.title || `${p1} vs ${p2}`,
    subtitle: `${p1} vs ${p2}`,
    avatarUrl: m.person1?.avatar ?? m.entries?.[0]?.coverImageUrl ?? null,
    avatarName: p1,
    category: m.category ?? null,
    endAt: m.endAt ?? null,
    totalPool: typeof m.totalPool === "number" ? m.totalPool : null,
    typePill: TYPE_PILL.h2h,
  };
}

function normalizeRace(m: any): NormalizedMarket {
  const categoryLabel: string = m.categoryLabel ?? m.category ?? "Race";
  const leader = m.entries?.[0];
  return {
    id: m.id,
    href: `/predict/race/${m.id}`,
    title: m.title || `Category Race: ${categoryLabel}`,
    subtitle: leader?.label ? `Leading: ${leader.label}` : "Pick a candidate",
    avatarUrl: leader?.coverImageUrl ?? null,
    avatarName: leader?.label ?? categoryLabel,
    category: m.category ?? null,
    endAt: m.endAt ?? null,
    totalPool: typeof m.totalPool === "number" ? m.totalPool : null,
    typePill: TYPE_PILL.race,
  };
}

function normalizeCommunity(m: any): NormalizedMarket {
  const title: string = m.title ?? "Untitled market";
  return {
    id: m.id,
    href: `/markets/${m.slug ?? m.id}`,
    title,
    subtitle: m.teaser ?? m.summary ?? null,
    avatarUrl: m.coverImageUrl ?? m.linkedPersonAvatar ?? null,
    avatarName: title,
    category: m.category ?? null,
    endAt: m.closeAt ?? m.endAt ?? null,
    totalPool: null,
    typePill: TYPE_PILL.community,
  };
}

function normalize(type: RelatedMarketsType, m: any): NormalizedMarket {
  switch (type) {
    case "updown":
      return normalizeUpdown(m);
    case "h2h":
      return normalizeH2h(m);
    case "race":
      return normalizeRace(m);
    case "community":
      return normalizeCommunity(m);
  }
}

export function RelatedMarkets({
  type,
  currentMarketId,
  category,
  limit = 6,
  className,
}: RelatedMarketsProps) {
  const endpoint = TYPE_ENDPOINT[type];

  const { data, isLoading } = useQuery<any[]>({
    queryKey: [endpoint],
    staleTime: 30_000,
  });

  const items = useMemo<NormalizedMarket[]>(() => {
    const list = Array.isArray(data) ? data : [];
    const others = list.filter((m: any) => m && m.id && m.id !== currentMarketId);
    const normalized = others.map((m) => normalize(type, m));

    // Bias same-category markets to the top so a sports race surfaces
    // other sports races first; ties are broken by soonest endAt so the
    // carousel feels "fresh" rather than alphabetical.
    const sameCategory = category
      ? normalized.filter((m) => m.category && m.category === category)
      : [];
    const otherCategory = category
      ? normalized.filter((m) => !m.category || m.category !== category)
      : normalized;

    const byEndSoonest = (a: NormalizedMarket, b: NormalizedMarket) => {
      const aMs = a.endAt ? new Date(a.endAt).getTime() : Number.POSITIVE_INFINITY;
      const bMs = b.endAt ? new Date(b.endAt).getTime() : Number.POSITIVE_INFINITY;
      return aMs - bMs;
    };

    return [...sameCategory.sort(byEndSoonest), ...otherCategory.sort(byEndSoonest)].slice(0, limit);
  }, [data, currentMarketId, category, type, limit]);

  if (isLoading) {
    return (
      <section className={className} aria-label="Related markets" data-testid="related-markets-loading">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            More like this
          </h3>
        </div>
        <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-2 snap-x snap-mandatory scrollbar-thin">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-64 shrink-0 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className={className} aria-label="Related markets" data-testid="related-markets">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          More like this
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {items.length} more market{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {/*
        Negative horizontal margin lets the carousel bleed to the screen
        edge on mobile (so the first / last cards visually peek), while
        the inner padding keeps the cards inside the gutter on desktop.
        `snap-x snap-mandatory` makes swipes settle on a card.
      */}
      <div
        className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-2 snap-x snap-mandatory scrollbar-thin"
        data-testid="related-markets-scroller"
      >
        {items.map((m) => {
          const timeLeft = formatTimeLeft(m.endAt);
          return (
            <Link key={m.id} href={m.href} data-testid={`related-market-${m.id}`}>
              <Card className="group w-64 shrink-0 snap-start cursor-pointer hover-elevate overflow-hidden transition-colors">
                <div className="p-3 flex flex-col gap-2 h-full">
                  <div className="flex items-start gap-2.5">
                    {m.avatarUrl ? (
                      <PersonAvatar
                        name={m.avatarName ?? m.title}
                        avatar={m.avatarUrl}
                        className="h-10 w-10 shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 shrink-0 rounded-full bg-muted/50 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                        {(m.avatarName ?? m.title).slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <Badge
                        variant="secondary"
                        className="text-[9px] uppercase tracking-wider px-1.5 py-0 mb-1"
                      >
                        {m.typePill}
                      </Badge>
                      <p className="text-sm font-semibold leading-tight line-clamp-2">{m.title}</p>
                    </div>
                  </div>

                  {m.subtitle && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{m.subtitle}</p>
                  )}

                  <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground gap-2">
                    {timeLeft ? (
                      <span className="flex items-center gap-1 truncate">
                        <Clock className="h-3 w-3" />
                        {timeLeft}
                      </span>
                    ) : (
                      <span className="truncate">{m.category ?? ""}</span>
                    )}
                    {typeof m.totalPool === "number" && m.totalPool > 0 && (
                      <span className="font-mono shrink-0">
                        {m.totalPool.toLocaleString()} credits
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
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
