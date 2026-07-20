import { Skeleton } from "@/components/ui/skeleton";

export function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-20 w-full rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="h-8 flex-1 rounded-md" />
            <Skeleton className="h-8 flex-1 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MatchupCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card overflow-hidden">
          <div className="flex">
            <Skeleton className="h-56 flex-1" />
            <Skeleton className="h-56 flex-1" />
          </div>
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-2/3 mx-auto" />
            <Skeleton className="h-3 w-1/3 mx-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LeaderboardRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="pt-2 sm:pt-3 space-y-1.5">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="lb-row-card lb-row-neutral flex items-center gap-3 py-4 px-3 rounded-xl"
        >
          <Skeleton className="h-12 w-[4.5rem] rounded-lg shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4 lg:hidden" />
          </div>
          <Skeleton className="h-7 w-16 shrink-0" />
          <Skeleton className="hidden md:block h-8 w-[4.5rem] shrink-0" />
          <Skeleton className="hidden md:block h-7 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function SectionLoadingSkeleton() {
  return (
    <div className="py-4">
      <CardGridSkeleton count={3} />
    </div>
  );
}
