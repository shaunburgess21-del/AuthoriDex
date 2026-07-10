import { Card } from "@/components/ui/card";
import { Check, Vote as VoteIcon } from "lucide-react";
import { SENTIMENT_POLL_SUPPORT_BUTTON_CLASS } from "@/lib/sentimentPollVoteDisplay";
import { cn } from "@/lib/utils";

/**
 * Vote-to-induct CTA shown on dormant induction-candidate profiles.
 * Votes land in the same induction_votes table as the queue card.
 * Stays on the current tab — no navigation on vote.
 */
export function InductionVoteCta({
  personName,
  seedVotes,
  hasVoted,
  canVote,
  onVote,
  testId,
  className,
  description,
  /** Predict-tab empty state: hide headline; parent supplies context copy above. */
  compact = false,
}: {
  personName: string;
  seedVotes: number;
  hasVoted: boolean;
  canVote: boolean;
  onVote: () => void;
  testId: string;
  className?: string;
  /** Optional override for the body copy under the headline. */
  description?: string;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        "p-4 sm:p-5 flex flex-col items-center justify-center text-center gap-3 border-cyan-500/30 dark:border-cyan-500/20 bg-cyan-500/5 dark:bg-cyan-500/[0.04]",
        className,
      )}
      data-testid={testId}
    >
      {!compact && (
        <p className="text-base font-semibold leading-snug">
          Want to see {personName} join the leaderboard?
        </p>
      )}
      {!compact && (
        <p className="text-xs text-muted-foreground max-w-md">
          {description ??
            `Trend scores and native prediction markets unlock once the community votes ${personName} onto the main leaderboard. World Markets may still feature them before that.`}
        </p>
      )}
      {hasVoted ? (
        <button
          type="button"
          disabled
          className={cn(
            SENTIMENT_POLL_SUPPORT_BUTTON_CLASS,
            "disabled:opacity-100 disabled:cursor-default max-w-xs",
          )}
          data-testid={`${testId}-voted`}
        >
          <Check className="h-4 w-4 shrink-0" />
          <span>Voted to Induct</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onVote}
          disabled={!canVote}
          className="group w-full max-w-xs flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-muted/40 border border-border text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white text-sm font-medium transition-all duration-300 hover:border-cyan-500/80 hover:bg-cyan-500/25 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/20 hover:text-cyan-600 dark:hover:text-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`${testId}-button`}
        >
          <VoteIcon className="h-4 w-4 shrink-0" />
          <span>Vote to Induct</span>
        </button>
      )}
      <span className="text-xs text-muted-foreground">
        {seedVotes.toLocaleString("en-US")} induction {seedVotes === 1 ? "vote" : "votes"}
      </span>
    </Card>
  );
}
