import { MessageSquare } from "lucide-react";

export interface DiscussionButtonProps {
  count?: number;
  onClick: () => void;
  testId?: string;
}

/**
 * Footer-link styled trigger that opens the full-screen discussion overlay.
 * Replaces "Remove vote" in the post-vote footer left slot on main/View-all
 * cards. Shows a live comment count when greater than zero.
 */
export function DiscussionButton({ count, onClick, testId }: DiscussionButtonProps) {
  const showCount = typeof count === "number" && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors underline-offset-4 hover:underline truncate"
      data-testid={testId}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Discussion</span>
      {showCount ? <span className="tabular-nums">{count}</span> : null}
    </button>
  );
}
