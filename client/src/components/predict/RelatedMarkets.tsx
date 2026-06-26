import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RelatedItemsCarousel,
  type RelatedCarouselItem,
} from "@/components/shared/RelatedItemsCarousel";
import {
  marketThumbFromCommunity,
  marketThumbFromGainer,
  marketThumbFromH2h,
  marketThumbFromUpdown,
} from "@/lib/marketThumbParticipants";
import { buildH2hSplitBar, buildUpDownSplitBar } from "@/lib/nativeMarketCarouselPercents";
import { normalizeMarketCategory } from "@shared/constants";

/**
 * Detail-page "more like this" carousel.
 *
 * Each native detail page (Up/Down, H2H, Race) and the community
 * `/markets/:slug` page reuses the list query that already populates
 * the Predict page — so adding this carousel costs zero extra requests
 * on every page except community (which still has to hit the standard
 * `/api/open-markets` endpoint, which is small and cached).
 */

type RelatedMarketsType = "updown" | "h2h" | "race" | "community";

interface RelatedMarketsProps {
  type: RelatedMarketsType;
  currentMarketId: string;
  category?: string | null;
  limit?: number;
  showAllMarkets?: boolean;
  className?: string;
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

const CARD_WIDTH: Record<RelatedMarketsType, string> = {
  h2h: "w-[21rem] max-w-[85vw]",
  race: "w-[19rem] max-w-[82vw]",
  updown: "w-[18rem] max-w-[80vw]",
  community: "w-[19rem] max-w-[82vw]",
};

function normalizeUpdown(m: any, cardWidthClass: string): RelatedCarouselItem {
  const personName: string = m.person?.name ?? m.personName ?? "Unknown";
  const thumb = marketThumbFromUpdown(m);
  return {
    id: m.id,
    href: `/predict/updown/${m.id}`,
    title: personName,
    subtitle: null,
    thumbVariant: thumb.variant,
    thumbParticipants: thumb.participants,
    category: m.category ?? null,
    secondaryCategories: Array.isArray(m.secondaryCategories) ? m.secondaryCategories : null,
    endAt: m.endAt ?? null,
    creditPool: typeof m.totalPool === "number" ? m.totalPool : null,
    typePill: TYPE_PILL.updown,
    cardWidthClass,
    centerTitle: true,
    hideTimeInFooter: true,
    splitBar: buildUpDownSplitBar(m),
  };
}

function normalizeH2h(m: any, cardWidthClass: string): RelatedCarouselItem {
  const thumb = marketThumbFromH2h(m);
  const p1 = thumb.participants[0] ?? { name: "?", avatar: null };
  const p2 = thumb.participants[1] ?? { name: "?", avatar: null };
  return {
    id: m.id,
    href: `/predict/h2h/${m.id}`,
    title: m.title || `${p1.name} vs ${p2.name}`,
    subtitle: null,
    thumbVariant: thumb.variant,
    thumbParticipants: thumb.participants,
    category: m.category ?? null,
    secondaryCategories: Array.isArray(m.secondaryCategories) ? m.secondaryCategories : null,
    endAt: m.endAt ?? null,
    creditPool: typeof m.totalPool === "number" ? m.totalPool : null,
    typePill: TYPE_PILL.h2h,
    cardWidthClass,
    centerTitle: true,
    hideTimeInFooter: true,
    splitBar: buildH2hSplitBar(m),
  };
}

function normalizeRace(m: any, cardWidthClass: string): RelatedCarouselItem {
  const categoryLabel: string = m.categoryLabel ?? m.category ?? "Race";
  const thumb = marketThumbFromGainer(m);
  const leaderName = thumb.participants[0]?.name;
  return {
    id: m.id,
    href: `/predict/race/${m.id}`,
    title: m.title || `Category Race: ${categoryLabel}`,
    subtitle: leaderName ? `Leading: ${leaderName}` : "Pick a candidate",
    thumbVariant: thumb.variant,
    thumbParticipants: thumb.participants,
    category: m.category ?? null,
    secondaryCategories: Array.isArray(m.secondaryCategories) ? m.secondaryCategories : null,
    endAt: m.endAt ?? null,
    creditPool: typeof m.totalPool === "number" ? m.totalPool : null,
    typePill: TYPE_PILL.race,
    cardWidthClass,
    centerTitle: true,
    hideTimeInFooter: true,
    subtitleInFooter: true,
  };
}

function normalizeCommunity(m: any, cardWidthClass: string): RelatedCarouselItem {
  const title: string = m.title ?? "Untitled market";
  const thumb = marketThumbFromCommunity(m);
  return {
    id: m.id,
    href: `/markets/${m.slug ?? m.id}`,
    title,
    subtitle: m.teaser ?? m.summary ?? null,
    thumbVariant: thumb.variant,
    thumbParticipants: thumb.participants,
    category: m.category ?? null,
    secondaryCategories: Array.isArray(m.secondaryCategories) ? m.secondaryCategories : null,
    endAt: m.closeAt ?? m.endAt ?? null,
    creditPool: null,
    typePill: TYPE_PILL.community,
    cardWidthClass,
    centerTitle: true,
  };
}

function normalize(type: RelatedMarketsType, m: any): RelatedCarouselItem {
  const cardWidthClass = CARD_WIDTH[type];
  switch (type) {
    case "updown":
      return normalizeUpdown(m, cardWidthClass);
    case "h2h":
      return normalizeH2h(m, cardWidthClass);
    case "race":
      return normalizeRace(m, cardWidthClass);
    case "community":
      return normalizeCommunity(m, cardWidthClass);
  }
}

export function RelatedMarkets({
  type,
  currentMarketId,
  category,
  limit = 6,
  showAllMarkets = false,
  className,
}: RelatedMarketsProps) {
  const endpoint = TYPE_ENDPOINT[type];

  const { data, isLoading } = useQuery<any[]>({
    queryKey: [endpoint],
    staleTime: 30_000,
  });

  const items = useMemo<RelatedCarouselItem[]>(() => {
    const list = Array.isArray(data) ? data : [];
    const others = list.filter((m: any) => m && m.id && m.id !== currentMarketId);
    const normalized = others.map((m) => normalize(type, m));

    const isSameCategory = (m: RelatedCarouselItem) =>
      (!!m.category && m.category === category) ||
      (Array.isArray(m.secondaryCategories) &&
        m.secondaryCategories.some((s) => normalizeMarketCategory(s) === normalizeMarketCategory(category)));
    const sameCategory = category
      ? normalized.filter(isSameCategory)
      : [];
    const otherCategory = category
      ? normalized.filter((m) => !isSameCategory(m))
      : normalized;

    const byEndSoonest = (a: RelatedCarouselItem, b: RelatedCarouselItem) => {
      const aMs = a.endAt ? new Date(a.endAt).getTime() : Number.POSITIVE_INFINITY;
      const bMs = b.endAt ? new Date(b.endAt).getTime() : Number.POSITIVE_INFINITY;
      return aMs - bMs;
    };

    const merged = [
      ...sameCategory.sort(byEndSoonest),
      ...otherCategory.sort(byEndSoonest),
    ];
    return showAllMarkets ? merged : merged.slice(0, limit);
  }, [data, currentMarketId, category, type, limit, showAllMarkets]);

  return (
    <RelatedItemsCarousel
      items={items}
      isLoading={isLoading}
      countNoun="market"
      skeletonWidthClass={CARD_WIDTH[type]}
      testIdPrefix="related-markets"
      ariaLabel="Related markets"
      className={className}
    />
  );
}
