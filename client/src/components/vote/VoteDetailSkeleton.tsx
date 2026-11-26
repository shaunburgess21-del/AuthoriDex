import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { VoteDetailNavCluster } from "@/components/vote/VoteDetailNavCluster";
import { voteDetailSectionCardClass } from "@/lib/vote-detail-ui";
import { pathnameOnly } from "@/lib/primaryNav";
import type { VoteListNavType } from "@/lib/voteListNavigation";

export type VoteDetailSkeletonVariant = "matchup" | "sentiment" | "opinion";

const LIST_TYPE: Record<VoteDetailSkeletonVariant, VoteListNavType> = {
  matchup: "matchup",
  sentiment: "sentiment",
  opinion: "opinion",
};

function slugFromLocation(location: string): string | undefined {
  const path = pathnameOnly(location);
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Sticky chrome shared by matchup, sentiment, and opinion detail pages.
 * The loading skeleton uses the same header so the bar does not jump
 * when the card data arrives.
 */
export function VoteDetailHeader({
  onBack,
  listType,
  slug,
}: {
  onBack: () => void;
  listType: VoteListNavType;
  slug?: string;
}) {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="max-w-3xl mx-auto px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-3 min-w-0 justify-self-start">
          <Link href="/" data-testid="link-logo-home">
            <VoxDexLogo size={28} />
          </Link>
          {/* Icon-only on mobile so the prev-card chevron next to it
              has visible breathing room. Label returns at sm:. */}
          <Button
            variant="ghost"
            size="sm"
            className="px-2 sm:px-3"
            onClick={onBack}
            data-testid="button-back"
            aria-label="Back to Vote"
          >
            <ArrowLeft className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Vote</span>
          </Button>
        </div>
        <div className="flex justify-center min-w-0 col-start-2">
          <VoteDetailNavCluster listType={listType} slug={slug} />
        </div>
        <div className="justify-self-end col-start-3">
          <HeaderUserActions />
        </div>
      </div>
    </header>
  );
}

function TitleBlock({ withThumb }: { withThumb: boolean }) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      {withThumb ? (
        <div className="mb-4 flex items-start gap-4">
          <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-4/5 max-w-md sm:h-9" />
            <Skeleton className="h-4 w-2/3 max-w-sm" />
          </div>
        </div>
      ) : (
        <div className="mb-3 space-y-2">
          <Skeleton className="h-8 w-4/5 max-w-md sm:h-9" />
          <Skeleton className="h-4 w-1/2 max-w-xs" />
        </div>
      )}
      <div className="flex items-center gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="ml-auto h-8 w-16" />
      </div>
    </div>
  );
}

function ResultBars({ count }: { count: number }) {
  return (
    <Card className={voteDetailSectionCardClass("mb-6 p-5")}>
      <Skeleton className="mb-4 h-6 w-24" />
      <div className="flex flex-col gap-3.5">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-10" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatsRow() {
  return (
    <div className="mb-6 grid grid-cols-3 gap-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i} className="p-3">
          <Skeleton className="mx-auto mb-2 h-4 w-4" />
          <Skeleton className="mx-auto mb-1 h-6 w-12" />
          <Skeleton className="mx-auto h-3 w-16" />
        </Card>
      ))}
    </div>
  );
}

function MatchupVoteModule() {
  return (
    <div className={voteDetailSectionCardClass("-mx-4 mb-6 overflow-hidden sm:mx-0")}>
      <div className="p-5">
        <Skeleton className="mb-4 h-6 w-40" />
        <div className="relative -mx-5 mb-4 flex items-stretch">
          {[0, 1].map((side) => (
            <div key={side} className="flex flex-1 flex-col overflow-hidden border border-border/40">
              <div className="relative min-h-[222px] md:aspect-[100/111] md:min-h-0">
                <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
              </div>
              <div className="border-t border-border/30 px-3 py-3">
                <Skeleton className="mx-auto h-4 w-16" />
              </div>
            </div>
          ))}
          <div className="pointer-events-none absolute left-1/2 top-[calc(50%-18px)] z-10 -translate-x-1/2 -translate-y-1/2">
            <Skeleton className="h-14 w-14 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SentimentVoteModule() {
  return (
    <Card className={voteDetailSectionCardClass("mb-6 p-5")}>
      <Skeleton className="mb-4 h-6 w-36" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full rounded-md md:h-10" />
        <Skeleton className="h-12 w-full rounded-md md:h-10" />
        <Skeleton className="h-12 w-full rounded-md md:h-10" />
      </div>
    </Card>
  );
}

function OpinionVoteModule() {
  return (
    <Card className={voteDetailSectionCardClass("mb-6 p-5 sm:p-6")}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-8 w-40 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex min-h-14 items-stretch overflow-hidden rounded-lg border border-border/50"
          >
            <Skeleton className="h-auto w-14 shrink-0 rounded-none" />
            <div className="flex flex-1 items-center px-3">
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Layout-matched loading state for vote detail pages. Reserves the same
 * header, title, and vote module the loaded page uses so content can
 * replace the placeholders without a blank flash or a header jump.
 */
export function VoteDetailSkeleton({
  variant,
  onBack,
  slug,
}: {
  variant: VoteDetailSkeletonVariant;
  onBack?: () => void;
  slug?: string;
}) {
  const [location, setLocation] = useLocation();
  const listType = LIST_TYPE[variant];
  const resolvedSlug = slug ?? slugFromLocation(location);

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    setLocation("/vote");
  };

  return (
    <div
      className="min-h-screen bg-background"
      data-testid={`vote-detail-skeleton-${variant}`}
      aria-busy="true"
    >
      <span className="sr-only">Loading</span>
      <VoteDetailHeader onBack={handleBack} listType={listType} slug={resolvedSlug} />
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pb-6">
        <TitleBlock withThumb={variant !== "matchup"} />
        {variant === "matchup" ? <MatchupVoteModule /> : null}
        {variant === "sentiment" ? <SentimentVoteModule /> : null}
        {variant === "opinion" ? <OpinionVoteModule /> : null}
        {variant === "opinion" ? (
          <Card className={voteDetailSectionCardClass("mb-6 p-5 sm:p-6")}>
            <Skeleton className="mb-2 h-6 w-44" />
            <Skeleton className="mb-4 h-4 w-full" />
            <Skeleton className="mb-4 h-10 w-full rounded-md" />
            <Skeleton className="h-4 w-40" />
          </Card>
        ) : null}
        <ResultBars count={variant === "sentiment" ? 3 : variant === "opinion" ? 4 : 2} />
        <StatsRow />
      </div>
    </div>
  );
}
