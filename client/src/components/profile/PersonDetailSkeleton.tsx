import { SiteHeader } from "@/components/SiteHeader";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Celebrity profile (`/person`, `/celebrity`) loading shell. */
export function PersonDetailSkeleton() {
  return (
    <div
      className="min-h-screen overflow-x-clip pb-20 md:pb-0"
      data-testid="person-detail-skeleton"
      aria-busy="true"
    >
      <span className="sr-only">Loading</span>
      <SiteHeader backButton="always" />
      <div className="container mx-auto max-w-6xl px-2 pt-4 sm:px-4 md:pt-12">
        <div className="mb-8 flex gap-6">
          <Skeleton className="h-32 w-32 shrink-0 rounded-full sm:h-48 sm:w-48" />
          <div className="flex min-h-[5rem] flex-1 flex-col justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-9 w-56 max-w-full md:h-10" />
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md sm:w-28" />
            </div>
          </div>
        </div>
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="p-4 text-center">
              <Skeleton className="mx-auto mb-2 h-4 w-20" />
              <Skeleton className="mx-auto h-8 w-16" />
            </Card>
          ))}
        </div>
      </div>
      <div className="sticky top-14 z-10 w-full border-b border-border/50 bg-background py-2 shadow-sm">
        <div className="container mx-auto max-w-6xl px-2 sm:px-4">
          <div className="flex w-full items-center overflow-hidden rounded-lg bg-muted/50 p-0.5">
            <Skeleton className="h-11 flex-1 rounded-md" />
            <Skeleton className="h-11 flex-1 rounded-md" />
            <Skeleton className="h-11 flex-1 rounded-md" />
          </div>
        </div>
      </div>
      <div className="container mx-auto max-w-6xl space-y-4 px-2 pb-12 pt-4 sm:px-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
