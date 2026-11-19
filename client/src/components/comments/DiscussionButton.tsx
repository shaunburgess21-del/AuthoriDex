import { MessageSquare, Users } from "lucide-react";

export interface DiscussionButtonProps {
  count?: number;
  onClick: () => void;
  testId?: string;
}

/**
 * Speech-bubble trigger for a card's discussion overlay. Count is hidden at
 * zero so an empty thread still shows the icon.
 */
export function DiscussionButton({ count, onClick, testId }: DiscussionButtonProps) {
  const showCount = typeof count === "number" && count > 0;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={showCount ? `Discussion, ${count} comments` : "Discussion"}
      className="inline-flex shrink-0 items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 transition-colors underline-offset-4 hover:underline"
      data-testid={testId}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
      {showCount ? <span className="tabular-nums">{count}</span> : null}
    </button>
  );
}

/** Numeric vote total shown on a card only after the viewer has voted. */
export function CardVoteCount({ count, testId }: { count: number; testId?: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground" data-testid={testId}>
      <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
      <span className="tabular-nums">{count.toLocaleString("en-US")} votes</span>
    </div>
  );
}
