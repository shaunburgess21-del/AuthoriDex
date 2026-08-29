import { Link } from "wouter";
import {
  Vote as VoteIcon,
  BarChart3,
  Globe,
  User as UserIcon,
  MessagesSquare,
  Trophy,
} from "lucide-react";
import { CardImage } from "@/components/ui/card-image";
import { getCategoryStyle } from "@/components/CategoryPill";
import type { VoicesEntity } from "./types";
import { EMPTY_PROFILE_STATS } from "./types";
import { VoiceProfilePreviewStats } from "./VoiceProfilePreviewStats";
import { VoiceInductionProfilePreview } from "./VoiceInductionProfilePreview";
import { VoiceSentimentPollPreview } from "./VoiceSentimentPollPreview";
import { VoiceOpinionPollPreview } from "./VoiceOpinionPollPreview";
import { VoiceWorldMarketPreview } from "./VoiceWorldMarketPreview";
import {
  VOICES_ENTITY_PREVIEW_HEIGHT_CLASS,
  VOICES_ENTITY_PREVIEW_IMAGE_COL_CLASS,
} from "./voicesSurface";
import { cn } from "@/lib/utils";

const SURFACE_ICON: Record<VoicesEntity["refType"], typeof VoteIcon> = {
  matchup: VoteIcon,
  trending_poll: BarChart3,
  opinion_poll: BarChart3,
  open_market: Globe,
  person: UserIcon,
  timeline: MessagesSquare,
};

interface VoiceEntityPreviewProps {
  entity: VoicesEntity;
  itemId: string;
}

/**
 * Visual preview of the card a Voices comment is attached to. Matchups render
 * an A/B split with a VS badge; single-image cards (polls, world markets,
 * profiles) render an image + heading banner; image-less cards fall back to
 * the original compact chip. Always deep-links to the source card (stops
 * propagation so the tap doesn't open the reply overlay).
 */
export function VoiceEntityPreview({ entity, itemId }: VoiceEntityPreviewProps) {
  const isMatchup = entity.refType === "matchup";
  const hasMatchupMedia =
    isMatchup && entity.media && (entity.media.optionAImage || entity.media.optionBImage);
  const isBannerType =
    entity.refType === "trending_poll" ||
    entity.refType === "opinion_poll" ||
    entity.refType === "open_market" ||
    entity.refType === "person";
  const hasBannerImage = isBannerType && Boolean(entity.imageUrl);

  if (hasMatchupMedia && entity.media) {
    const { optionAImage, optionAText, optionBImage, optionBText } = entity.media;
    return (
      <Link
        href={entity.href}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "group/preview relative mt-2.5 block overflow-hidden rounded-lg border border-white/[0.08] transition-colors hover:border-amber-500/40",
          VOICES_ENTITY_PREVIEW_HEIGHT_CLASS,
        )}
        data-testid={`voice-card-entity-${itemId}`}
      >
        <div className="flex h-full">
          <div className="relative w-1/2 overflow-hidden">
            <CardImage src={optionAImage ?? ""} alt={optionAText} width={320} />
            <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center">
              <span className="block truncate text-xs font-semibold text-white">
                {optionAText}
              </span>
            </div>
          </div>
          <div className="relative w-1/2 overflow-hidden border-l border-white/[0.08]">
            <CardImage src={optionBImage ?? ""} alt={optionBText} width={320} />
            <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center">
              <span className="block truncate text-xs font-semibold text-white">
                {optionBText}
              </span>
            </div>
          </div>
        </div>
        {/* VS badge over the center seam */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-500 bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg">
            <span className="text-[11px] font-bold text-white">VS</span>
          </div>
        </div>
        {entity.subtitle && (
          <span className="absolute left-1.5 top-1.5 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
            {entity.subtitle}
          </span>
        )}
      </Link>
    );
  }

  if (hasBannerImage && entity.imageUrl) {
    const isProfile = entity.refType === "person";
    const isSentimentPoll = entity.refType === "trending_poll";
    const isOpinionPoll = entity.refType === "opinion_poll";
    const isOpenMarket = entity.refType === "open_market";
    const categoryStyle =
      isProfile && entity.category ? getCategoryStyle(entity.category) : null;
    const categoryRank = entity.profileStats?.categoryRank;

    return (
      <Link
        href={entity.href}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "group/preview mt-2.5 flex overflow-hidden rounded-lg border border-white/[0.08] bg-muted/60 transition-colors hover:border-amber-500/40 dark:bg-[#090B11]",
          VOICES_ENTITY_PREVIEW_HEIGHT_CLASS,
        )}
        data-testid={`voice-card-entity-${itemId}`}
      >
        {/* Left column: section label + image filling remaining height */}
        <div className={cn("flex shrink-0 flex-col", VOICES_ENTITY_PREVIEW_IMAGE_COL_CLASS)}>
          {entity.subtitle && (
            <div className="flex h-8 shrink-0 items-center justify-center border-b border-r border-white/[0.08] bg-black/40 px-1">
              <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
                {entity.subtitle}
              </span>
            </div>
          )}
          <div className="relative min-h-0 w-full flex-1 overflow-hidden">
            <CardImage
              src={entity.imageUrl}
              alt={entity.title}
              width={288}
              fallbackSrc={entity.fallbackImageUrl}
            />
          </div>
        </div>
        {isProfile ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2.5 py-2 sm:px-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="line-clamp-1 shrink text-sm font-medium leading-snug text-foreground transition-colors group-hover/preview:text-amber-600 dark:group-hover/preview:text-amber-400">
                {entity.title}
              </span>
              {entity.category && (
                <>
                  <span className="shrink-0 text-sm text-muted-foreground/60">·</span>
                  <span className="line-clamp-1 shrink text-sm text-muted-foreground">
                    {entity.category}
                  </span>
                  {categoryRank != null && categoryRank > 0 && categoryStyle && (
                    <span
                      className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${categoryStyle.bg} border ${categoryStyle.border} ${categoryStyle.text}`}
                    >
                      <Trophy className="h-3 w-3" />
                      #{categoryRank}
                    </span>
                  )}
                </>
              )}
            </div>
            {entity.inductionPreview ? (
              <VoiceInductionProfilePreview preview={entity.inductionPreview} />
            ) : (
              <VoiceProfilePreviewStats stats={entity.profileStats ?? EMPTY_PROFILE_STATS} />
            )}
          </div>
        ) : isSentimentPoll ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2.5 py-2 sm:px-3">
            <span className="shrink-0 line-clamp-1 text-sm font-medium leading-snug text-foreground transition-colors group-hover/preview:text-amber-600 dark:group-hover/preview:text-amber-400">
              {entity.title}
            </span>
            {entity.excerpt && (
              <p className="mt-0.5 shrink-0 line-clamp-2 text-xs leading-snug text-muted-foreground sm:line-clamp-3">
                {entity.excerpt}
              </p>
            )}
            {entity.sentimentResults ? (
              <VoiceSentimentPollPreview results={entity.sentimentResults} />
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </div>
        ) : isOpinionPoll ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2.5 py-2 sm:px-3">
            <span className="shrink-0 line-clamp-1 text-sm font-medium leading-snug text-foreground transition-colors group-hover/preview:text-amber-600 dark:group-hover/preview:text-amber-400">
              {entity.title}
            </span>
            {entity.excerpt && (
              <p className="mt-0.5 shrink-0 line-clamp-2 text-xs leading-snug text-muted-foreground">
                {entity.excerpt}
              </p>
            )}
            {entity.opinionPreview ? (
              <VoiceOpinionPollPreview preview={entity.opinionPreview} />
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </div>
        ) : isOpenMarket ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2.5 py-2 sm:px-3">
            <span className="shrink-0 line-clamp-1 text-sm font-medium leading-snug text-foreground transition-colors group-hover/preview:text-amber-600 dark:group-hover/preview:text-amber-400">
              {entity.title}
            </span>
            {entity.worldMarketPreview ? (
              <VoiceWorldMarketPreview preview={entity.worldMarketPreview} />
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col justify-start gap-1 px-2.5 py-2 sm:px-3">
            <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors group-hover/preview:text-amber-600 dark:group-hover/preview:text-amber-400">
              {entity.title}
            </span>
          </div>
        )}
      </Link>
    );
  }

  // Fallback: original compact chip (timeline mirrors, image-less cards).
  const SurfaceIcon = SURFACE_ICON[entity.refType] ?? MessagesSquare;
  return (
    <Link
      href={entity.href}
      onClick={(e) => e.stopPropagation()}
      className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.06] px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-amber-500/40 hover:bg-white/[0.08] hover:text-foreground dark:bg-white/[0.06]"
      data-testid={`voice-card-entity-${itemId}`}
    >
      {entity.imageUrl ? (
        <img
          src={entity.imageUrl}
          alt=""
          className="h-4 w-4 rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <SurfaceIcon className="h-3.5 w-3.5 shrink-0" />
      )}
      {entity.subtitle && (
        <span className="shrink-0 font-medium text-foreground/70">{entity.subtitle}</span>
      )}
      <span className="truncate">{entity.title}</span>
    </Link>
  );
}
