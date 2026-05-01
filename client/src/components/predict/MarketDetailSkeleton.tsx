import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading skeleton for every market-detail page.
 *
 * Native weekly pages (UpDown / H2H / Race) used to render multi-block
 * skeletons here, while community/jackpot detail rendered a lone
 * spinner. The skeletons match real content layout so users don't see
 * a layout shift when data lands; the spinner left a blank screen.
 *
 * `variant` lets each page tune the count/heights of the placeholder
 * blocks to whatever sits on that page. Defaults match the smallest
 * reasonable shell.
 */
export function MarketDetailSkeleton({
  variant = "compact",
  className,
}: {
  variant?: "compact" | "weekly";
  className?: string;
}) {
  return (
    <div className={`min-h-screen bg-background ${className || ""}`}>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
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
