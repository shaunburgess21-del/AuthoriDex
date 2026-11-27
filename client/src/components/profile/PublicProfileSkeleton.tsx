import { SiteHeader } from "@/components/SiteHeader";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Public member profile (`/u/:username`) loading shell. */
export function PublicProfileSkeleton() {
  return (
    <div className="pb-20 md:pb-0" data-testid="public-profile-skeleton" aria-busy="true">
      <span className="sr-only">Loading</span>
      <SiteHeader backButton="always" />
      <div className="container mx-auto max-w-3xl space-y-4 px-2 py-6 sm:px-4">
        <div className="flex items-center rounded-lg bg-muted/50 p-0.5">
          <Skeleton className="h-11 flex-1 rounded-md" />
          <Skeleton className="h-11 flex-1 rounded-md" />
          <Skeleton className="h-11 flex-1 rounded-md" />
        </div>
        <Card className="p-6">
          <div className="mb-6 flex items-start gap-4">
            <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
          <Skeleton className="mb-6 h-4 w-48" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        </Card>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Signed-in account page (`/profile`) loading shell. */
export function AccountProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background" data-testid="account-profile-skeleton" aria-busy="true">
      <span className="sr-only">Loading</span>
      <SiteHeader backButton="always" />
      <div className="container mx-auto max-w-6xl px-2 py-8 sm:px-4">
        <Card className="mb-6">
          <div className="flex flex-col items-start gap-6 p-6 md:flex-row">
            <Skeleton className="h-24 w-24 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="mb-2 h-8 w-56 max-w-full" />
              <Skeleton className="mb-4 h-4 w-48" />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </Card>
        <div className="mb-6 flex w-fit gap-1 rounded-lg bg-muted/50 p-1">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}
