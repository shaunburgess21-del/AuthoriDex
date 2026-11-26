import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/SiteHeader";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { cn } from "@/lib/utils";

/**
 * Shared content skeleton for market detail pages.
 *
 * `variant` tunes the placeholder blocks to the page. `embedded` drops
 * the full-viewport shell when a sticky header already frames the page
 * (native Up/Down, H2H, and category race).
 */
export function MarketDetailSkeleton({
  variant = "compact",
  className,
  embedded = false,
}: {
  variant?: "compact" | "weekly";
  className?: string;
  embedded?: boolean;
}) {
  return (
    <div className={cn(!embedded && "min-h-screen bg-background", className)}>
      <div className={cn("max-w-3xl mx-auto space-y-4 px-4", embedded ? "pb-8 pt-4" : "py-8")}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        {variant === "weekly" && (
          <>
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </>
        )}
      </div>
    </div>
  );
}

/** World / jackpot market detail: app nav plus the content skeleton. */
export function CommunityMarketDetailSkeleton() {
  return (
    <div className="min-h-screen pb-20 md:pb-0" data-testid="market-detail-skeleton" aria-busy="true">
      <span className="sr-only">Loading</span>
      <SiteHeader active="predict" logoVariant="predict" backButton="always" />
      <MarketDetailSkeleton />
    </div>
  );
}

/**
 * Native weekly detail (Up/Down, H2H, race). The loaded page uses a
 * compact sticky bar, not SiteHeader, so the skeleton uses that bar.
 */
export function NativeMarketDetailSkeleton({ onBack }: { onBack?: () => void }) {
  const [, setLocation] = useLocation();
  return (
    <div
      className="min-h-screen bg-background pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-24"
      data-testid="native-market-detail-skeleton"
      aria-busy="true"
    >
      <span className="sr-only">Loading</span>
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={onBack ?? (() => setLocation("/predict"))}
            className="rounded-lg p-1.5 transition-colors hover:bg-muted"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Skeleton className="h-4 w-40" />
          <div className="ml-auto">
            <HeaderUserActions />
          </div>
        </div>
      </header>
      <MarketDetailSkeleton variant="weekly" embedded />
    </div>
  );
}
