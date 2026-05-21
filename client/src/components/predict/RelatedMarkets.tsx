import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThumbParticipant } from "@/components/predict/MarketThumbCollage";
import {
  RelatedItemsCarousel,
  type RelatedCarouselItem,
} from "@/components/shared/RelatedItemsCarousel";
import { getTopRaceEntries } from "@/lib/nativeRaceLeaders";
import { buildH2hSplitBar, buildUpDownSplitBar } from "@/lib/nativeMarketCarouselPercents";

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

function h2hEntryParticipant(entry: any): ThumbParticipant {
  const person = entry?.person;
  return {
    name: person?.name ?? entry?.label ?? "?",
    avatar: person?.avatar?.trim() ? person.avatar : null,
  };
}

function normalizeUpdown(m: any, cardWidthClass: string): RelatedCarouselItem {
  const personName: string = m.person?.name ?? m.personName ?? "Unknown";
  return {
    id: m.id,
    href: `/predict/updown/${m.id}`,
    title: personName,
    subtitle: null,
    thumbVariant: "single",
    thumbParticipants: [
      {
        name: personName,
        avatar: m.person?.avatar?.trim() ? m.person.avatar : null,
      },
    ],
    category: m.category ?? null,
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
  const entries = m.entries || [];
  const p1 = h2hEntryParticipant(entries[0]);
  const p2 = h2hEntryParticipant(entries[1]);
  return {
    id: m.id,
    href: `/predict/h2h/${m.id}`,
    title: m.title || `${p1.name} vs ${p2.name}`,
    subtitle: null,
    thumbVariant: "split",
    thumbParticipants: [p1, p2],
    category: m.category ?? null,
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
  const topEntries = getTopRaceEntries(m.entries, m.metadata, 4);
  const leaderName = topEntries[0]?.name;
  return {
    id: m.id,
    href: `/predict/race/${m.id}`,
    title: m.title || `Category Race: ${categoryLabel}`,
    subtitle: leaderName ? `Leading: ${leaderName}` : "Pick a candidate",
    thumbVariant: topEntries.length > 1 ? "grid" : "single",
    thumbParticipants:
      topEntries.length > 0
        ? topEntries
        : [{ name: categoryLabel, avatar: null }],
    category: m.category ?? null,
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
  const avatar = m.coverImageUrl ?? m.linkedPersonAvatar ?? null;
  return {
    id: m.id,
    href: `/markets/${m.slug ?? m.id}`,
    title,
    subtitle: m.teaser ?? m.summary ?? null,
    thumbVariant: "single",
    thumbParticipants: [
      {
        name: title,
        avatar: avatar?.trim() ? avatar : null,
      },
    ],
    category: m.category ?? null,
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

    const sameCategory = category
      ? normalized.filter((m) => m.category && m.category === category)
      : [];
    const otherCategory = category
      ? normalized.filter((m) => !m.category || m.category !== category)
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
