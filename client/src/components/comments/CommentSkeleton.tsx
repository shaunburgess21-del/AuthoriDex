import { Skeleton } from "@/components/ui/skeleton";

interface CommentSkeletonProps {
  /** Number of placeholder rows to render. */
  rows?: number;
}

/** Lightweight loading placeholder that mirrors the CommentRow layout to
 * minimise layout shift while comments load. */
export function CommentSkeleton({ rows = 3 }: CommentSkeletonProps) {
  return (
    <div className="divide-y divide-border/10" aria-hidden="true" data-testid="comment-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 py-0.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
