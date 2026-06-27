import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThumbParticipant } from "@/components/predict/MarketThumbCollage";
import {
  RelatedItemsCarousel,
  type RelatedCarouselItem,
} from "@/components/shared/RelatedItemsCarousel";
import { coalesceHttpImage } from "@/lib/displayImageUrl";
import { useSupabaseUrl } from "@/lib/imageResolver";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { normalizeMarketCategory } from "@shared/constants";
import {
  getTopOpinionOptionThumbs,
  hasMultipleOptionImages,
} from "@/lib/opinionPollThumbs";

/**
 * Vote detail-page "more like this" carousel (matchups, sentiment, opinion).
 * Reuses list queries from VotePage — no extra network on detail views.
 */

export type RelatedVoteType = "matchup" | "sentiment" | "opinion";

export interface RelatedVoteItemsProps {
  type: RelatedVoteType;
  currentSlug: string;
  category?: string | null;
  limit?: number;
  className?: string;
}

const TYPE_ENDPOINT: Record<RelatedVoteType, string> = {
  matchup: "/api/matchups",
  sentiment: "/api/trending-polls",
  opinion: "/api/opinion-polls",
};

const TYPE_PILL: Record<RelatedVoteType, string> = {
  matchup: "Matchup",
  sentiment: "Sentiment",
  opinion: "Opinion poll",
};

const CARD_WIDTH: Record<RelatedVoteType, string> = {
  matchup: "w-[21rem] max-w-[85vw]",
  sentiment: "w-[19rem] max-w-[82vw]",
  opinion: "w-[19rem] max-w-[82vw]",
};

const COUNT_NOUN: Record<RelatedVoteType, "matchup" | "poll"> = {
  matchup: "matchup",
  sentiment: "poll",
  opinion: "poll",
};

function normalizeMatchup(m: any, cardWidthClass: string): RelatedCarouselItem | null {
  const slug = m.slug?.trim();
  if (!slug) return null;

  const title = `${m.optionAText ?? "A"} vs ${m.optionBText ?? "B"}`;

  return {
    id: m.id,
    href: `/vote/matchups/${encodeURIComponent(slug)}`,
    title,
    subtitle: null,
    thumbVariant: "split",
    thumbParticipants: [
      {
        name: m.optionAText ?? "A",
        avatar: coalesceHttpImage(m.optionAImage),
        avatarFallback: coalesceHttpImage(m.optionAFallbackImage),
      },
      {
        name: m.optionBText ?? "B",
        avatar: coalesceHttpImage(m.optionBImage),
        avatarFallback: coalesceHttpImage(m.optionBFallbackImage),
      },
    ],
    category: m.category ?? null,
    secondaryCategories: Array.isArray(m.secondaryCategories) ? m.secondaryCategories : null,
    voteCount: typeof m.totalVotes === "number" ? m.totalVotes : null,
    typePill: TYPE_PILL.matchup,
    cardWidthClass,
  };
}

function sentimentPollConventionUrl(
  slug: string,
  supabaseUrl: string | null,
): string | null {
  if (!supabaseUrl?.trim() || !slug.trim()) return null;
  return getDisplayImageUrl(
    `${supabaseUrl.trim()}/storage/v1/object/public/sentiment-polls/${slug}/1.webp`,
    { width: 700 },
  );
}

function normalizeSentiment(
  m: any,
  cardWidthClass: string,
  supabaseUrl: string | null,
): RelatedCarouselItem | null {
  const slug = m.slug?.trim();
  if (!slug) return null;

  const headline = m.headline?.trim() || "Untitled poll";

  return {
    id: m.id,
    href: `/polls/${encodeURIComponent(slug)}`,
    title: headline,
    subtitle: null,
    thumbVariant: "single",
    thumbParticipants: [
      {
        name: m.personName ?? headline,
        avatar: coalesceHttpImage(m.personAvatar),
        avatarFallback: coalesceHttpImage(
          m.imageUrl,
          sentimentPollConventionUrl(slug, supabaseUrl),
        ),
      },
    ],
    category: m.category ?? null,
    secondaryCategories: Array.isArray(m.secondaryCategories) ? m.secondaryCategories : null,
    voteCount: typeof m.totalVotes === "number" ? m.totalVotes : null,
    typePill: TYPE_PILL.sentiment,
    cardWidthClass,
  };
}

function normalizeOpinion(m: any, cardWidthClass: string): RelatedCarouselItem | null {
  const slug = m.slug?.trim();
  if (!slug) return null;

  const title = m.title?.trim() || "Untitled poll";
  const optionThumbs = getTopOpinionOptionThumbs(m.options, 4);
  const leader = optionThumbs[0];
  const pollImage = coalesceHttpImage(m.imageUrl);
  const firstOptionImage = optionThumbs.find((o) => o.avatar)?.avatar ?? null;

  let thumbVariant: "single" | "grid" = "single";
  let thumbParticipants: ThumbParticipant[];

  if (hasMultipleOptionImages(optionThumbs)) {
    thumbVariant = "grid";
    thumbParticipants = optionThumbs;
  } else {
    const singleImage = pollImage ?? firstOptionImage;
    const singleName = singleImage && leader?.avatar === singleImage
      ? leader.name
      : title;
    thumbParticipants = [{ name: singleName, avatar: singleImage }];
  }

  const desc = m.description?.trim();
  let subtitle: string | null = null;
  if (leader?.name) {
    subtitle = `Leading: ${leader.name}`;
  } else if (desc && desc.toLowerCase() !== title.toLowerCase()) {
    subtitle = desc.length > 120 ? `${desc.slice(0, 117)}...` : desc;
  }

  return {
    id: m.id,
    href: `/vote/opinion-polls/${encodeURIComponent(slug)}`,
    title,
    subtitle,
    thumbVariant,
    thumbParticipants,
    category: m.category ?? null,
    secondaryCategories: Array.isArray(m.secondaryCategories) ? m.secondaryCategories : null,
    voteCount: typeof m.totalVotes === "number" ? m.totalVotes : null,
    typePill: TYPE_PILL.opinion,
    cardWidthClass,
    subtitleInFooter: true,
  };
}

function normalize(
  type: RelatedVoteType,
  m: any,
  supabaseUrl: string | null,
): RelatedCarouselItem | null {
  const cardWidthClass = CARD_WIDTH[type];
  switch (type) {
    case "matchup":
      return normalizeMatchup(m, cardWidthClass);
    case "sentiment":
      return normalizeSentiment(m, cardWidthClass, supabaseUrl);
    case "opinion":
      return normalizeOpinion(m, cardWidthClass);
  }
}

function itemSlug(m: any): string {
  return (m.slug ?? "").trim().toLowerCase();
}

export function RelatedVoteItems({
  type,
  currentSlug,
  category,
  limit = 6,
  className,
}: RelatedVoteItemsProps) {
  const endpoint = TYPE_ENDPOINT[type];
  const normalizedCurrentSlug = currentSlug.trim().toLowerCase();
  const supabaseUrl = useSupabaseUrl();

  const { data, isLoading } = useQuery<any[]>({
    queryKey: [endpoint],
    staleTime: 30_000,
  });

  const items = useMemo<RelatedCarouselItem[]>(() => {
    const list = Array.isArray(data) ? data : [];
    const others = list.filter(
      (m: any) => m && m.id && itemSlug(m) && itemSlug(m) !== normalizedCurrentSlug,
    );

    const normalized = others
      .map((m) => normalize(type, m, supabaseUrl))
      .filter((item): item is RelatedCarouselItem => item !== null);

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

    const byVotes = (a: RelatedCarouselItem, b: RelatedCarouselItem) =>
      (b.voteCount ?? 0) - (a.voteCount ?? 0);

    const merged = [
      ...sameCategory.sort(byVotes),
      ...otherCategory.sort(byVotes),
    ];
    return merged.slice(0, limit);
  }, [data, normalizedCurrentSlug, category, type, limit, supabaseUrl]);

  return (
    <RelatedItemsCarousel
      items={items}
      isLoading={isLoading}
      countNoun={COUNT_NOUN[type]}
      skeletonWidthClass={CARD_WIDTH[type]}
      testIdPrefix={`related-vote-${type}`}
      ariaLabel={`Related ${type === "matchup" ? "matchups" : "polls"}`}
      className={className}
      sparklesClassName="text-cyan-700 dark:text-cyan-500"
    />
  );
}
