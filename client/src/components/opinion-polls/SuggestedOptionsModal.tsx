import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ArrowBigUp, Loader2, Lightbulb } from "lucide-react";
import type { OptionSuggestion } from "@/hooks/useOptionSuggestions";

interface SuggestedOptionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pollTitle: string;
  suggestions: OptionSuggestion[];
  isLoading: boolean;
  isLoggedIn: boolean;
  votingId: string | null;
  onToggleVote: (suggestionId: string) => void;
  onRequireLogin: () => void;
}

export function SuggestedOptionsModal({
  open,
  onOpenChange,
  pollTitle,
  suggestions,
  isLoading,
  isLoggedIn,
  votingId,
  onToggleVote,
  onRequireLogin,
}: SuggestedOptionsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="modal-suggested-options">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            Suggested options
          </DialogTitle>
          <DialogDescription>
            Upvote the options you&apos;d like to see added to &ldquo;{pollTitle}&rdquo;. The most popular suggestions
            are reviewed for inclusion.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : suggestions.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-no-suggestions">
            No suggestions yet. Be the first to suggest an option.
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-3 -mr-3">
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => {
                const isVoting = votingId === s.id;
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-white/[0.02] px-3 py-2.5"
                    data-testid={`suggestion-row-${s.id}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                    <button
                      type="button"
                      onClick={() => (isLoggedIn ? onToggleVote(s.id) : onRequireLogin())}
                      disabled={isVoting}
                      aria-pressed={s.userHasVoted}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60",
                        s.userHasVoted
                          ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300"
                          : "border-border/60 bg-white/[0.04] text-foreground/80 hover:border-cyan-500/40 hover:text-cyan-600 dark:hover:text-cyan-300",
                      )}
                      data-testid={`button-vote-suggestion-${s.id}`}
                    >
                      {isVoting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArrowBigUp className={cn("h-3.5 w-3.5", s.userHasVoted && "fill-current")} />
                      )}
                      <span className="font-mono tabular-nums">{s.voteCount}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
