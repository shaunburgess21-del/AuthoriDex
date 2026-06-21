import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lightbulb, Plus, ListChecks } from "lucide-react";
import { OPINION_POLL_OPTION_SUGGESTION_MAX_LEN } from "@shared/constants";
import { voteDetailSectionCardClass } from "@/lib/vote-detail-ui";
import { useOptionSuggestions, parseSuggestionError } from "@/hooks/useOptionSuggestions";
import { SuggestedOptionsModal } from "./SuggestedOptionsModal";

interface SuggestOptionCardProps {
  slug: string;
  pollTitle: string;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
}

export function SuggestOptionCard({ slug, pollTitle, isLoggedIn, onRequireLogin }: SuggestOptionCardProps) {
  const [name, setName] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const { suggestions, isLoading, submit, toggleVote } = useOptionSuggestions(slug);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || submit.isPending) return;
    submit.mutate(trimmed, {
      onSuccess: () => {
        setName("");
        toast("Suggestion submitted", { description: "It will appear once reviewed by our team." });
      },
      onError: (err) => {
        toast.error("Could not submit", { description: parseSuggestionError(err) });
      },
    });
  };

  const handleToggleVote = (suggestionId: string) => {
    toggleVote.mutate(suggestionId, {
      onError: (err) => {
        toast.error("Could not vote", { description: parseSuggestionError(err) });
      },
    });
  };

  const votingId = toggleVote.isPending ? (toggleVote.variables ?? null) : null;

  return (
    <Card className={voteDetailSectionCardClass("p-5 sm:p-6 mb-6")} data-testid="section-suggest-option">
      <h2 className="text-lg font-serif font-bold mb-1 flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
        Missing an option?
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Suggest an option to add to this poll. The community upvotes suggestions and our team reviews the most popular
        ones for inclusion.
      </p>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => {
            if (!isLoggedIn) onRequireLogin();
          }}
          maxLength={OPINION_POLL_OPTION_SUGGESTION_MAX_LEN}
          placeholder="Suggest an option..."
          className="flex-1"
          data-testid="input-suggest-option"
        />
        <Button
          type="submit"
          disabled={submit.isPending || (isLoggedIn && !name.trim())}
          className="shrink-0 bg-cyan-600 hover:bg-cyan-700"
          data-testid="button-submit-suggestion"
        >
          <Plus className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Suggest</span>
        </Button>
      </form>

      <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {suggestions.length > 0
            ? `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} so far`
            : "No suggestions yet"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700"
          onClick={() => setModalOpen(true)}
          data-testid="button-view-suggestions"
        >
          <ListChecks className="h-4 w-4 mr-1.5" />
          View all suggested options
        </Button>
      </div>

      <SuggestedOptionsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        pollTitle={pollTitle}
        suggestions={suggestions}
        isLoading={isLoading}
        isLoggedIn={isLoggedIn}
        votingId={votingId}
        onToggleVote={handleToggleVote}
        onRequireLogin={onRequireLogin}
      />
    </Card>
  );
}
