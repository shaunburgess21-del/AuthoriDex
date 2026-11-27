import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/SiteHeader";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { predictDetailSectionCardClass } from "@/lib/predict-detail-ui";
import { cn } from "@/lib/utils";

type NativeLayout = "updown" | "h2h" | "race";

function nativeLayoutFromPath(path: string): NativeLayout {
  if (path.includes("/h2h/")) return "h2h";
  if (path.includes("/race/")) return "race";
  return "updown";
}

function OutcomeRow() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 p-2">
      <Skeleton className="h-4 w-[26%] shrink-0" />
      <Skeleton className="h-5 min-w-0 flex-1 rounded-md" />
      <Skeleton className="h-4 w-10 shrink-0" />
      <Skeleton className="hidden h-3 w-12 shrink-0 sm:block" />
      <Skeleton className="h-8 w-14 shrink-0 rounded-md" />
    </div>
  );
}

/**
 * World-market detail body: badge row, logo + title, then the price
 * panel's outcome rows. Heights follow the loaded page (`pt-6`, 80px
 * logo, list rows) so the panel does not jump when entries arrive.
 */
function CommunityMarketBody() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pb-6">
      <div className="mb-6">
        <div className="mb-3 flex flex-wrap gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="mb-4 flex items-start gap-4">
          <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-4/5 max-w-lg sm:h-9" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4 sm:h-5" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="ml-auto h-8 w-16" />
        </div>
        <CycleStripSkeleton tall className="mt-4" />
      </div>
      <Card className={predictDetailSectionCardClass("p-4")} data-testid="market-price-panel-skeleton">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-4 w-28" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-10 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <OutcomeRow key={i} />
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * Full MarketCycleStrip (p-3, two text-xs rows, border). A 16px line
 * left the card short by the measured jump: world markets 90px at 390
 * and 59px at 1280, native pages 42px and 33px. The box is that jump
 * plus the 16px line it replaces.
 */
function CycleStripSkeleton({
  tall = false,
  className,
}: {
  tall?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center gap-1.5 rounded-lg border border-border/40 bg-muted/30 px-3",
        tall
          ? "min-h-[106px] md:min-h-[75px]"
          : "min-h-[58px] md:min-h-[49px]",
        className,
      )}
      data-testid="cycle-strip-skeleton"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
        <Skeleton className="h-4 w-4/5 max-w-md" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
        <Skeleton className="h-4 w-3/5 max-w-sm" />
      </div>
    </div>
  );
}

function H2HBody() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
      <CycleStripSkeleton />
      <Card className="p-4 md:p-5">
        <Skeleton className="mb-4 h-5 w-24 rounded-full" />
        <div className="relative flex gap-[7px]">
          <Skeleton className="aspect-[4/5] min-w-0 flex-1 rounded-lg" />
          <Skeleton className="aspect-[4/5] min-w-0 flex-1 rounded-lg" />
          <Skeleton className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full" />
        </div>
        <div className="mt-4 flex justify-between gap-4 px-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </Card>
    </div>
  );
}

function UpDownBody() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
      <CycleStripSkeleton />
      <Card className="p-4 md:p-5">
        <div className="mb-4 flex items-center gap-4">
          <Skeleton className="h-20 w-20 shrink-0 rounded-full md:h-24 md:w-24" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
        <div className="mb-4 grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-1 text-center">
              <Skeleton className="mx-auto h-5 w-12" />
              <Skeleton className="mx-auto h-3 w-14" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10 rounded-md" />
          <Skeleton className="h-10 rounded-md" />
        </div>
      </Card>
    </div>
  );
}

function RaceBody() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
      <CycleStripSkeleton />
      <Card className="p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="mb-4 h-3 w-64 max-w-full" />
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border/40 p-2">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ml-auto h-4 w-12" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * Content skeleton for market detail pages.
 *
 * `compact` matches a world market (logo, title, outcome rows, price
 * panel). `weekly` matches a native page; pass `layout` when the URL
 * is not available yet.
 */
export function MarketDetailSkeleton({
  variant = "compact",
  className,
  embedded = false,
  layout = "updown",
}: {
  variant?: "compact" | "weekly";
  className?: string;
  embedded?: boolean;
  layout?: NativeLayout;
}) {
  return (
    <div className={cn(!embedded && variant === "weekly" && "min-h-screen bg-background", className)}>
      {variant === "weekly" ? (
        layout === "h2h" ? <H2HBody /> : layout === "race" ? <RaceBody /> : <UpDownBody />
      ) : (
        <CommunityMarketBody />
      )}
    </div>
  );
}

/** World / jackpot market detail: app nav plus the market-shaped skeleton. */
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
 * compact sticky bar, not SiteHeader, so the skeleton uses that bar
 * and a body that matches the route.
 */
export function NativeMarketDetailSkeleton({
  onBack,
  layout,
}: {
  onBack?: () => void;
  layout?: NativeLayout;
}) {
  const [location, setLocation] = useLocation();
  const resolved = layout ?? nativeLayoutFromPath(location);
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
      <MarketDetailSkeleton variant="weekly" embedded layout={resolved} />
    </div>
  );
}
