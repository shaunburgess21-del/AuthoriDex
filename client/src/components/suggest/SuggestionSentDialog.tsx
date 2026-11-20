import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SuggestionSentDialogProps {
  open: boolean;
  /** XP actually awarded for this submission. 0 hides the line. */
  xp?: number;
  onOpenChange: (open: boolean) => void;
}

/**
 * Stays on screen after a Suggest drawer closes. A toast alone was easy
 * to miss — the drawer shut and nothing confirmed the send.
 */
export function SuggestionSentDialog({
  open,
  xp = 0,
  onOpenChange,
}: SuggestionSentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="dialog-suggestion-sent">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 sm:mx-0">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <DialogTitle>Suggestion sent</DialogTitle>
          <DialogDescription>
            We&apos;ll review it shortly.
            {xp > 0 ? ` You earned ${xp} XP.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            data-testid="button-suggestion-sent-done"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function awardedSuggestionXp(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const xp = (data as { xp?: { xpAwarded?: unknown } }).xp?.xpAwarded;
  const n = typeof xp === "number" ? xp : Number(xp);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
