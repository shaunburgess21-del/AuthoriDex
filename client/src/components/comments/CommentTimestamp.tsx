import { formatCommentAge, formatUtcTimestampTitle } from "@/lib/formatDate";
import { cn } from "@/lib/utils";

/** Relative comment age, with the exact UTC instant on hover. */
export function CommentTimestamp({
  at,
  className,
}: {
  at: string | Date | null | undefined;
  className?: string;
}) {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time
      dateTime={date.toISOString()}
      title={formatUtcTimestampTitle(at)}
      className={cn("text-xs text-muted-foreground", className)}
    >
      {formatCommentAge(at)}
    </time>
  );
}
